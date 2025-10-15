import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SitesConfig, SiteInfo, Config, SiteInfoFile } from '../api/types';

const CONFIG_COMMENT = '// vscode設定に記入した場合は同期ボタンでconfig.jsonに反映してください';

/**
 * Site Manager
 * Manages multiple Owlanter sites and configuration
 */
export class SiteManager {
  private workspaceRoot: string;
  private configDir: string;
  private sitesFile: string;
  private configFile: string;
  private sitesRootDir: string;
  private siteFolderCache: Map<number, string>;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.configDir = path.join(workspaceRoot, '_config');
    this.sitesRootDir = path.join(this.configDir, 'SITES');
    this.sitesFile = path.join(this.configDir, 'site.json');
    this.configFile = path.join(this.configDir, 'config.json');
    this.siteFolderCache = new Map<number, string>();
  }

  /**
   * Get all sites configuration
   */
  async getSites(): Promise<SitesConfig> {
    try {
      const content = await fs.readFile(this.sitesFile, 'utf8');
      const config: SitesConfig = JSON.parse(content);
      const mutated = await this.ensureSiteFolderMetadata(config);

      if (mutated) {
        await this.writeSitesFile(config);
      } else {
        this.updateSiteFolderCache(config);
      }

      return config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create initial config
        const initialConfig: SitesConfig = {
          sites: [],
          'current-site': 0,
          'default-site': 0,
        };
        await this.writeSitesFile(initialConfig);
        return initialConfig;
      }
      throw new Error(`Failed to load site.json: ${error.message}`);
    }
  }

  /**
   * Save sites configuration
   */
  async saveSites(config: SitesConfig): Promise<void> {
    try {
      await this.ensureSiteFolderMetadata(config);
      await this.writeSitesFile(config);
    } catch (error: any) {
      throw new Error(`Failed to save site.json: ${error.message}`);
    }
  }

  /**
   * Get current active site
   */
  async getCurrentSite(): Promise<SiteInfo | null> {
    const config = await this.getSites();
    if (config['current-site'] === 0) {
      return null;
    }
    const currentSite = config.sites.find(s => s['site-id'] === config['current-site']);
    return currentSite || null;
  }

  /**
   * Get site by ID
   */
  async getSiteById(siteId: number): Promise<SiteInfo | null> {
    const config = await this.getSites();
    return config.sites.find(s => s['site-id'] === siteId) || null;
  }

  /**
   * Select a site as current
   */
  async selectSite(siteId: number): Promise<void> {
    const config = await this.getSites();
    const site = config.sites.find(s => s['site-id'] === siteId);

    if (!site) {
      throw new Error(`Site ID ${siteId} not found`);
    }

    // Set all sites to inactive
    config.sites.forEach(s => s.active = false);

    // Set selected site to active
    site.active = true;
    config['current-site'] = siteId;

    await this.saveSites(config);
    vscode.window.showInformationMessage(`Switched to site: ${site['site-name']} (ID: ${siteId})`);
  }

  /**
   * Add a new site
   */
  async addSite(
    siteId: number,
    siteName: string,
    description: string,
    environment: 'production' | 'staging' | 'development'
  ): Promise<void> {
    const config = await this.getSites();

    // Check if site already exists
    if (config.sites.some(s => s['site-id'] === siteId)) {
      throw new Error(`Site ID ${siteId} already exists`);
    }

    const newSite: SiteInfo = {
      'site-id': siteId,
      'site-name': siteName,
      'folder-name': this.createSiteFolderName(siteId, siteName),
      description,
      environment,
      'last-sync': new Date().toISOString(),
      active: false,
      color: environment === 'production' ? 'red' : environment === 'staging' ? 'yellow' : 'blue',
    };

    config.sites.push(newSite);

    // If this is the first site, set it as default and current
    if (config.sites.length === 1) {
      config['current-site'] = siteId;
      config['default-site'] = siteId;
      newSite.active = true;
    }

    await this.saveSites(config);

    // Create site directory structure
    const siteDir = this.getSiteDir(siteId);
    await fs.mkdir(path.join(siteDir, 'server-script'), { recursive: true });
    await fs.mkdir(path.join(siteDir, 'client-script'), { recursive: true });

    // Create initial site-info.json
    const siteInfo = this.createDefaultSiteInfo(newSite);
    await this.saveSiteInfo(siteId, siteInfo);

    vscode.window.showInformationMessage(`Site added: ${siteName} (ID: ${siteId})`);
  }

  /**
   * Remove a site
   */
  async removeSite(siteId: number): Promise<void> {
    const config = await this.getSites();
    const siteIndex = config.sites.findIndex(s => s['site-id'] === siteId);

    if (siteIndex === -1) {
      throw new Error(`Site ID ${siteId} not found`);
    }

    const site = config.sites[siteIndex];
    const siteFolderName = site['folder-name'] ?? this.createSiteFolderName(site['site-id'], site['site-name']);

    // Confirm deletion
    const answer = await vscode.window.showWarningMessage(
      `Are you sure you want to remove site "${site['site-name']}" (ID: ${siteId})?`,
      { modal: true },
      'Yes',
      'No'
    );

    if (answer !== 'Yes') {
      return;
    }

    const removedWasCurrent = config['current-site'] === siteId;
    const removedWasDefault = config['default-site'] === siteId;

    config.sites.splice(siteIndex, 1);

    if (config.sites.length === 0) {
      config['current-site'] = 0;
      config['default-site'] = 0;
    } else {
      if (removedWasCurrent) {
        config['current-site'] = config.sites[0]['site-id'];
      }

      if (removedWasDefault) {
        config['default-site'] = config.sites[0]['site-id'];
      }

      config.sites.forEach(s => {
        s.active = s['site-id'] === config['current-site'];
      });
    }

    await this.saveSites(config);

    // Remove site directory on disk
    const siteDir = path.join(this.sitesRootDir, siteFolderName);
    try {
      await fs.rm(siteDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to remove site directory ${siteDir}:`, error);
    }

    vscode.window.showInformationMessage(`Site removed: ${site['site-name']}`);
  }

  /**
   * Update last sync time
   */
  async updateLastSync(siteId: number): Promise<void> {
    const config = await this.getSites();
    const site = config.sites.find(s => s['site-id'] === siteId);

    if (site) {
      site['last-sync'] = new Date().toISOString();
      await this.saveSites(config);
    }
  }

  /**
   * Get global configuration
  */
  async getConfig(): Promise<Config> {
    try {
      const content = await fs.readFile(this.configFile, 'utf8');
      const sanitized = content
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('//'))
        .join('\n')
        .trim();

      if (!sanitized) {
        throw new Error('config.json is empty');
      }

      const parsed = JSON.parse(sanitized) as Config;
      const mutableParsed = parsed as unknown as Record<string, unknown>;
      const domain = (parsed['owlanter-domain'] ?? parsed['pleasanter-domain'] ?? '').trim();
      const apiKey = (parsed['owlanter-api'] ?? parsed['pleasanter-api'] ?? '').trim();

      if (domain) {
        mutableParsed['owlanter-domain'] = domain;
      }
      if (apiKey) {
        mutableParsed['owlanter-api'] = apiKey;
      }

      delete mutableParsed['pleasanter-domain'];
      delete mutableParsed['pleasanter-api'];

      return parsed;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          'config.json not found. Please create it in _config/ directory.'
        );
      }
      throw new Error(`Failed to load config.json: ${error.message}`);
    }
  }

  /**
   * Save global configuration
   */
  async saveConfig(config: Config): Promise<void> {
    try {
      const domain = (config['owlanter-domain'] ?? config['pleasanter-domain'] ?? '').trim();
      const apiKey = (config['owlanter-api'] ?? config['pleasanter-api'] ?? '').trim();

      const mutableConfig = config as unknown as Record<string, unknown>;
      mutableConfig['owlanter-domain'] = domain;
      mutableConfig['owlanter-api'] = apiKey;
      delete mutableConfig['pleasanter-domain'];
      delete mutableConfig['pleasanter-api'];

      await fs.mkdir(this.configDir, { recursive: true });
      const serialized = JSON.stringify(config, null, 2);
      const output = `${CONFIG_COMMENT}\n${serialized}\n`;
      await fs.writeFile(this.configFile, output, 'utf8');
    } catch (error: any) {
      throw new Error(`Failed to save config.json: ${error.message}`);
    }
  }

  /**
   * Check whether configuration file exists
   */
  async configExists(): Promise<boolean> {
    try {
      await fs.stat(this.configFile);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw new Error(`Failed to access config.json: ${error.message}`);
    }
  }

  /**
   * Initialize configuration with default values
   */
  async initializeConfig(force = false): Promise<Config> {
    const exists = await this.configExists();
    if (exists && !force) {
      return this.getConfig();
    }

    const defaultConfig: Config = {
      'owlanter-domain': '',
      'owlanter-api': '',
      settings: {
        'auto-backup': true,
        'backup-count': 5,
        'confirmation-required': {
          production: true,
          staging: false,
          development: false,
        },
        'default-delay': 1.5,
        'max-retries': 3,
      },
    };

    await this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  getSiteInfoPath(siteId: number): string {
    return path.join(this.getSiteDir(siteId), 'site-info.json');
  }

  async readSiteInfo(siteId: number): Promise<SiteInfoFile> {
    const site = await this.getSiteById(siteId);
    if (!site) {
      throw new Error(`Site ID ${siteId} not found`);
    }

    const infoPath = this.getSiteInfoPath(siteId);

    try {
      const content = await fs.readFile(infoPath, 'utf8');
      const parsed = JSON.parse(content) as SiteInfoFile;
      return this.normalizeSiteInfo(site, parsed);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const defaultInfo = this.createDefaultSiteInfo(site);
        await this.saveSiteInfo(siteId, defaultInfo);
        return defaultInfo;
      }
      throw new Error(`Failed to load site-info.json: ${error.message}`);
    }
  }

  async saveSiteInfo(siteId: number, info: SiteInfoFile): Promise<void> {
    const site = await this.getSiteById(siteId);
    if (!site) {
      throw new Error(`Site ID ${siteId} not found`);
    }

    const normalized = this.normalizeSiteInfo(site, info);
    await fs.mkdir(this.getSiteDir(siteId), { recursive: true });
    await fs.writeFile(this.getSiteInfoPath(siteId), JSON.stringify(normalized, null, 2), 'utf8');
  }

  async updateSiteInfo(siteId: number, updater: (info: SiteInfoFile) => void): Promise<SiteInfoFile> {
    const info = await this.readSiteInfo(siteId);
    updater(info);
    await this.saveSiteInfo(siteId, info);
    return info;
  }

  private async ensureSiteFolderMetadata(config: SitesConfig): Promise<boolean> {
    let mutated = false;

    for (const site of config.sites) {
      const expected = this.createSiteFolderName(site['site-id'], site['site-name']);
      const current = site['folder-name'];

      if (current !== expected) {
        if (current && typeof current === 'string') {
          const renamed = await this.renameSiteDirectory(current, expected);
          if (!renamed) {
            continue;
          }
        }
        site['folder-name'] = expected;
        mutated = true;
      }
    }

    return mutated;
  }

  private updateSiteFolderCache(config: SitesConfig): void {
    this.siteFolderCache.clear();
    for (const site of config.sites) {
      const folderName = site['folder-name'] ?? this.createSiteFolderName(site['site-id'], site['site-name']);
      this.siteFolderCache.set(site['site-id'], folderName);
    }
  }

  private async writeSitesFile(config: SitesConfig): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.mkdir(this.sitesRootDir, { recursive: true });
    await fs.writeFile(this.sitesFile, JSON.stringify(config, null, 2), 'utf8');
    this.updateSiteFolderCache(config);
  }

  private createSiteFolderName(siteId: number, siteName: string): string {
    const trimmed = (siteName ?? '').trim();
    const sanitized = trimmed
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/\.+$/g, '')
      .trim();
    const limited = sanitized.slice(0, 80).trim();
    const safeName = limited.length > 0 ? limited : `site_${siteId}`;
    return `${siteId}_${safeName}`;
  }

  private async renameSiteDirectory(oldName: string, newName: string): Promise<boolean> {
    if (!oldName || oldName === newName) {
      return true;
    }

    const oldPath = path.join(this.sitesRootDir, oldName);
    const newPath = path.join(this.sitesRootDir, newName);

    try {
      await fs.access(oldPath);
    } catch {
      return true;
    }

    if (oldPath === newPath) {
      return true;
    }

    try {
      await fs.access(newPath);
      console.warn(`Target site directory already exists: ${newPath}. Skipping rename.`);
      return false;
    } catch {
      // Target does not exist, proceed with rename.
    }

    try {
      await fs.mkdir(this.sitesRootDir, { recursive: true });
      await fs.rename(oldPath, newPath);
      return true;
    } catch (error) {
      console.warn(`Failed to rename site directory from ${oldName} to ${newName}:`, error);
      return false;
    }
  }

  private createDefaultSiteInfo(site: SiteInfo): SiteInfoFile {
    const now = new Date().toISOString();
    const folderName = site['folder-name'] ?? this.createSiteFolderName(site['site-id'], site['site-name']);
    return {
      'site-id': site['site-id'],
      'site-name': site['site-name'],
      title: site['site-name'],
      'reference-type': '',
      'tenant-id': 0,
      environment: site.environment,
      'created-at': now,
      'last-pulled': '',
      'last-pushed': '',
      version: 1,
      'scripts-count': {
        'server-scripts': 0,
        'client-scripts': 0,
      },
      'active-scripts': {
        server: [],
        client: [],
      },
      'folder-name': folderName,
    };
  }

  private normalizeSiteInfo(site: SiteInfo, info: SiteInfoFile): SiteInfoFile {
    info['site-id'] = site['site-id'];
    info['site-name'] = site['site-name'];
    info.environment = site.environment;
    info['folder-name'] = site['folder-name'] ?? this.createSiteFolderName(site['site-id'], site['site-name']);
    info.title = info.title || site['site-name'];
    info['reference-type'] = info['reference-type'] ?? '';
    info['tenant-id'] = info['tenant-id'] ?? 0;
    info.version = info.version ?? 1;
    info['created-at'] = info['created-at'] ?? new Date().toISOString();
    info['last-pulled'] = info['last-pulled'] ?? '';
    info['last-pushed'] = info['last-pushed'] ?? '';
    info['scripts-count'] = info['scripts-count'] ?? { 'server-scripts': 0, 'client-scripts': 0 };

    if (!info['active-scripts']) {
      info['active-scripts'] = { server: [], client: [] };
    } else {
      info['active-scripts'].server = Array.isArray(info['active-scripts'].server)
        ? info['active-scripts'].server
        : [];
      info['active-scripts'].client = Array.isArray(info['active-scripts'].client)
        ? info['active-scripts'].client
        : [];
    }

    return info;
  }

  /**
   * Check if confirmation is required for the environment
   */
  async isConfirmationRequired(environment: string): Promise<boolean> {
    try {
      const config = await this.getConfig();
      const envKey = environment as keyof typeof config.settings['confirmation-required'];
      return config.settings['confirmation-required'][envKey] ?? false;
    } catch {
      // Default to requiring confirmation if config can't be loaded
      return true;
    }
  }

  /**
   * Get site directory path
   */
  getSiteDir(siteId: number): string {
    const folderName = this.siteFolderCache.get(siteId) ?? siteId.toString();
    return path.join(this.sitesRootDir, folderName);
  }

  /**
   * Get server script directory path
   */
  getServerScriptDir(siteId: number): string {
    return path.join(this.getSiteDir(siteId), 'server-script');
  }

  /**
   * Get client script directory path
   */
  getClientScriptDir(siteId: number): string {
    return path.join(this.getSiteDir(siteId), 'client-script');
  }
}
