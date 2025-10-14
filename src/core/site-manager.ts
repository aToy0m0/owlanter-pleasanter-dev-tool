import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SitesConfig, SiteInfo, Config } from '../api/types';

/**
 * Site Manager
 * Manages multiple Pleasanter sites and configuration
 */
export class SiteManager {
  private workspaceRoot: string;
  private configDir: string;
  private sitesFile: string;
  private configFile: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.configDir = path.join(workspaceRoot, '01_api', '00_config');
    this.sitesFile = path.join(this.configDir, 'sites.json');
    this.configFile = path.join(this.configDir, 'config.json');
  }

  /**
   * Get all sites configuration
   */
  async getSites(): Promise<SitesConfig> {
    try {
      const content = await fs.readFile(this.sitesFile, 'utf8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create initial config
        const initialConfig: SitesConfig = {
          sites: [],
          'current-site': 0,
          'default-site': 0,
        };
        await this.saveSites(initialConfig);
        return initialConfig;
      }
      throw new Error(`Failed to load sites.json: ${error.message}`);
    }
  }

  /**
   * Save sites configuration
   */
  async saveSites(config: SitesConfig): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      await fs.writeFile(this.sitesFile, JSON.stringify(config, null, 2), 'utf8');
    } catch (error: any) {
      throw new Error(`Failed to save sites.json: ${error.message}`);
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
    const siteDir = path.join(this.workspaceRoot, '01_api', 'SITE', siteId.toString());
    await fs.mkdir(path.join(siteDir, 'server-script'), { recursive: true });
    await fs.mkdir(path.join(siteDir, 'client-script'), { recursive: true });

    // Create initial site-info.json
    const siteInfo = {
      'site-id': siteId,
      'site-name': siteName,
      title: siteName,
      'reference-type': '',
      'tenant-id': 0,
      environment,
      'created-at': new Date().toISOString(),
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
    };

    await fs.writeFile(
      path.join(siteDir, 'site-info.json'),
      JSON.stringify(siteInfo, null, 2),
      'utf8'
    );

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

    config.sites.splice(siteIndex, 1);

    // If removed site was current, reset current-site
    if (config['current-site'] === siteId) {
      if (config.sites.length > 0) {
        config['current-site'] = config.sites[0]['site-id'];
        config.sites[0].active = true;
      } else {
        config['current-site'] = 0;
        config['default-site'] = 0;
      }
    }

    await this.saveSites(config);
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
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          'config.json not found. Please create it in 01_api/00_config/ directory.'
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
      await fs.mkdir(this.configDir, { recursive: true });
      await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf8');
    } catch (error: any) {
      throw new Error(`Failed to save config.json: ${error.message}`);
    }
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
    return path.join(this.workspaceRoot, '01_api', 'SITE', siteId.toString());
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
