import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SitesConfig, SiteInfo, Config, SiteInfoFile } from '../api/types';

const CONFIG_COMMENT = '// vscode設定に記述した場合は同期ボタンでconfig.jsonに反映してください';
const SITES_STATE_KEY = 'owlanter.sitesConfig';
const CONFIG_DOMAIN_KEY = 'owlanter.domain';
const CONFIG_SETTINGS_KEY = 'owlanter.configSettings';
const CONFIG_API_SECRET_KEY = 'owlanter.apiKey';

export class MissingWorkspaceDirectoryError extends Error {
  constructor(
    public readonly directory: string,
    public readonly relativePath: string,
    public readonly action: string
  ) {
    super(
      `Required workspace folder is missing: ${relativePath || directory}. Please create it manually before ${action}.`
    );
  }
}

/**
 * Site Manager
 * Manages multiple Owlanter sites and configuration
 */
export class SiteManager {
  private context: vscode.ExtensionContext;
  private workspaceRoot: string;
  private configDir: string;
  private sitesFile: string;
  private configFile: string;
  private sitesRootDir: string;
  private siteFolderCache: Map<number, string>;

  constructor(context: vscode.ExtensionContext, workspaceRoot: string) {
    this.context = context;
    this.workspaceRoot = workspaceRoot;
    this.configDir = path.join(workspaceRoot, '_config');
    this.sitesRootDir = path.join(this.configDir, 'SITES');
    this.sitesFile = path.join(this.configDir, 'site.json');
    this.configFile = path.join(this.configDir, 'config.json');
    this.siteFolderCache = new Map<number, string>();
  }

  private toWorkspaceRelative(target: string): string {
    const relative = path.relative(this.workspaceRoot, target);
    return relative.startsWith('..') ? target : relative || '.';
  }

  private async directoryExists(dir: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async ensureDirectoryForAction(dir: string, action: string): Promise<void> {
    const exists = await this.directoryExists(dir);
    if (!exists) {
      throw new MissingWorkspaceDirectoryError(dir, this.toWorkspaceRelative(dir), action);
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async ensureConfigStructure(action: string): Promise<void> {
    await this.ensureDirectoryForAction(this.configDir, action);
    await this.ensureDirectoryForAction(this.sitesRootDir, action);
  }

  async ensureSiteWorkspace(
    siteId: number,
    action: string,
    options: { includeScriptDirs?: boolean } = {}
  ): Promise<void> {
    const includeScriptDirs = options.includeScriptDirs ?? true;
    await this.ensureConfigStructure(action);

    const config = await this.getSites();
    const site = config.sites.find(s => s['site-id'] === siteId);
    if (!site) {
      throw new Error(`Site ID ${siteId} not found`);
    }

    const folderName = site['folder-name'] ?? this.createSiteFolderName(site['site-id'], site['site-name']);
    const siteDir = path.join(this.sitesRootDir, folderName);
    await this.ensureDirectoryForAction(siteDir, action);

    if (includeScriptDirs) {
      await this.ensureDirectoryForAction(path.join(siteDir, 'server-script'), action);
      await this.ensureDirectoryForAction(path.join(siteDir, 'client-script'), action);
    }
  }

  async initializeWorkspace(): Promise<{
    createdDirectories: string[];
    createdFiles: string[];
  }> {
    const createdDirectories: string[] = [];
    const createdFiles: string[] = [];

    const ensureDir = async (dir: string) => {
      if (!(await this.directoryExists(dir))) {
        await fs.mkdir(dir, { recursive: true });
        createdDirectories.push(this.toWorkspaceRelative(dir));
      }
    };

    await ensureDir(this.configDir);
    await ensureDir(this.sitesRootDir);

    let sitesConfig: SitesConfig;
    try {
      sitesConfig = await this.getSites();
    } catch (error: any) {
      throw new Error(`Failed to load site configuration: ${error.message ?? error}`);
    }

    const mutated = await this.ensureSiteFolderMetadata(sitesConfig);
    if (mutated) {
      await this.persistSites(sitesConfig);
    } else {
      this.updateSiteFolderCache(sitesConfig);
    }

    for (const site of sitesConfig.sites) {
      const folderName = site['folder-name'] ?? this.createSiteFolderName(site['site-id'], site['site-name']);
      const siteDir = path.join(this.sitesRootDir, folderName);
      await ensureDir(siteDir);
      await ensureDir(path.join(siteDir, 'server-script'));
      await ensureDir(path.join(siteDir, 'client-script'));

      const infoPath = this.getSiteInfoPath(site['site-id']);
      const hasInfo = await this.fileExists(infoPath);
      if (!hasInfo) {
        const info = this.createDefaultSiteInfo(site);
        await fs.writeFile(infoPath, JSON.stringify(info, null, 2), 'utf8');
        createdFiles.push(this.toWorkspaceRelative(infoPath));
      }
    }

    const hasConfigFile = await this.fileExists(this.configFile);
    if (!hasConfigFile) {
      const config = await this.initializeConfig(true);
      if (config) {
        createdFiles.push(this.toWorkspaceRelative(this.configFile));
      }
    }

    return { createdDirectories, createdFiles };
  }

  /**
   * Get all sites configuration
   */
  async getSites(): Promise<SitesConfig> {
    const stored = this.context.workspaceState.get<SitesConfig>(SITES_STATE_KEY);
    if (stored) {
      const config: SitesConfig = JSON.parse(JSON.stringify(stored));
      const mutated = await this.ensureSiteFolderMetadata(config);
      if (mutated) {
        await this.persistSites(config);
      } else {
        this.updateSiteFolderCache(config);
      }
      return config;
    }

    try {
      const content = await fs.readFile(this.sitesFile, 'utf8');
      const config: SitesConfig = JSON.parse(content);
      const mutated = await this.ensureSiteFolderMetadata(config);

      if (mutated) {
        await this.persistSites(config);
      } else {
        this.updateSiteFolderCache(config);
        await this.context.workspaceState.update(SITES_STATE_KEY, config);
      }

      return config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const initialConfig: SitesConfig = {
          sites: [],
          'current-site': 0,
          'default-site': 0,
        };
        await this.persistSites(initialConfig);
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
      await this.persistSites(config);
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

    const siteDir = this.getSiteDir(siteId);
    const missingPaths: string[] = [];
    const requiredPaths = [
      siteDir,
      path.join(siteDir, 'server-script'),
      path.join(siteDir, 'client-script'),
    ];

    for (const candidate of requiredPaths) {
      if (!(await this.directoryExists(candidate))) {
        missingPaths.push(this.toWorkspaceRelative(candidate));
      }
    }

    if (missingPaths.length === 0) {
      try {
        const siteInfo = this.createDefaultSiteInfo(newSite);
        await this.saveSiteInfo(siteId, siteInfo);
      } catch (error) {
        if (error instanceof MissingWorkspaceDirectoryError) {
          vscode.window.showWarningMessage(error.message);
        } else {
          throw error;
        }
      }
    } else {
      vscode.window.showWarningMessage(
        [
          `Site added: ${siteName} (ID: ${siteId}).`,
          'Create the following folders manually before running pull/push:',
          ...missingPaths.map(item => `- ${item}`),
        ].join('\n')
      );
    }

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
    const storedSettings = this.context.workspaceState.get<Config['settings']>(CONFIG_SETTINGS_KEY);
    const storedDomain = this.context.globalState.get<string>(CONFIG_DOMAIN_KEY) ?? '';
    const storedApi = await this.context.secrets.get(CONFIG_API_SECRET_KEY);

    if (storedSettings) {
      return {
        'owlanter-domain': storedDomain,
        'owlanter-api': storedApi ?? '',
        settings: storedSettings,
      };
    }

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

      await this.persistConfig(parsed);
      return parsed;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const defaultConfig = await this.initializeConfig(true);
        return defaultConfig;
      }
      throw new Error(`Failed to load config.json: ${error.message}`);
    }
  }

  /**
   * Save global configuration
   */
  async saveConfig(config: Config): Promise<void> {
    try {
      await this.persistConfig(config);
    } catch (error: any) {
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  /**
   * Check whether configuration file exists
   */
  async configExists(): Promise<boolean> {
    const storedSettings = this.context.workspaceState.get<Config['settings']>(CONFIG_SETTINGS_KEY);
    const storedDomain = this.context.globalState.get<string>(CONFIG_DOMAIN_KEY);
    const storedApi = await this.context.secrets.get(CONFIG_API_SECRET_KEY);
    if (storedSettings || storedDomain || storedApi) {
      return true;
    }

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

    await this.persistConfig(defaultConfig);
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
    await this.ensureDirectoryForAction(this.getSiteDir(siteId), 'saving site-info.json');
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
    await this.ensureConfigStructure('saving site.json');
    await fs.writeFile(this.sitesFile, JSON.stringify(config, null, 2), 'utf8');
    this.updateSiteFolderCache(config);
  }

  private async persistSites(config: SitesConfig): Promise<void> {
    await this.context.workspaceState.update(SITES_STATE_KEY, config);
    try {
      await this.writeSitesFile(config);
    } catch (error) {
      if (error instanceof MissingWorkspaceDirectoryError) {
        vscode.window.showWarningMessage(error.message);
      } else {
        throw error;
      }
    }
  }

  private async persistConfig(config: Config): Promise<void> {
    const normalized: Config = JSON.parse(JSON.stringify(config));
    const domain = (normalized['owlanter-domain'] ?? normalized['pleasanter-domain'] ?? '').trim();
    const apiKey = (normalized['owlanter-api'] ?? normalized['pleasanter-api'] ?? '').trim();

    normalized['owlanter-domain'] = domain;
    normalized['owlanter-api'] = apiKey;
    const mutableNormalized = normalized as unknown as Record<string, unknown>;
    delete mutableNormalized['pleasanter-domain'];
    delete mutableNormalized['pleasanter-api'];

    await this.context.globalState.update(CONFIG_DOMAIN_KEY, domain);
    if (apiKey) {
      await this.context.secrets.store(CONFIG_API_SECRET_KEY, apiKey);
    } else {
      await this.context.secrets.delete(CONFIG_API_SECRET_KEY);
    }
    await this.context.workspaceState.update(CONFIG_SETTINGS_KEY, normalized.settings);

    const serialized = JSON.stringify(normalized, null, 2);
    const output = `${CONFIG_COMMENT}\n${serialized}\n`;
    try {
      await this.ensureDirectoryForAction(this.configDir, 'saving config.json');
      await fs.writeFile(this.configFile, output, 'utf8');
    } catch (error) {
      if (error instanceof MissingWorkspaceDirectoryError) {
        vscode.window.showWarningMessage(error.message);
      } else {
        throw error;
      }
    }
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

    if (!(await this.directoryExists(this.sitesRootDir))) {
      return false;
    }

    try {
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
