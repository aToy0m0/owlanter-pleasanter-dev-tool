import * as vscode from 'vscode';
import { SiteManager } from '../core/site-manager';
import { SiteInfo } from '../api/types';

/**
 * TreeDataProvider for Owlanter Sites view
 */
export class OwlanterSitesProvider implements vscode.TreeDataProvider<SiteTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SiteTreeItem | undefined | void> = new vscode.EventEmitter<SiteTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SiteTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly siteManager: SiteManager
  ) {}

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item representation
   */
  getTreeItem(element: SiteTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for tree view
   */
  async getChildren(element?: SiteTreeItem): Promise<SiteTreeItem[]> {
    if (!element) {
      // Root level: return all sites
      try {
        const sitesConfig = await this.siteManager.getSites();

        if (!sitesConfig.sites || sitesConfig.sites.length === 0) {
          return [];
        }

        return sitesConfig.sites.map(site => {
          const isCurrent = site['site-id'] === sitesConfig['current-site'];
          const isDefault = site['site-id'] === sitesConfig['default-site'];

          return new SiteTreeItem(
            this.context.extensionUri,
            site,
            isCurrent,
            isDefault,
            vscode.TreeItemCollapsibleState.None
          );
        });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to load sites: ${error.message}`);
        return [];
      }
    }

    // Sites don't have children in this implementation
    return [];
  }
}

/**
 * Tree item representing a Owlanter site
 */
export class SiteTreeItem extends vscode.TreeItem {
  constructor(
    extensionRoot: vscode.Uri,
    public readonly siteInfo: SiteInfo,
    public readonly isCurrent: boolean,
    public readonly isDefault: boolean,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(siteInfo['site-name'], collapsibleState);

    // Set tooltip with detailed information
    this.tooltip = [
      `Site ID: ${siteInfo['site-id']}`,
      `Name: ${siteInfo['site-name']}`,
      `Description: ${siteInfo.description || 'N/A'}`,
      `Environment: ${siteInfo.environment}`,
      isCurrent ? '✓ Current Site' : '',
      isDefault ? '★ Default Site' : ''
    ].filter(Boolean).join('\n');

    // Set description (shown next to label)
    const badges: string[] = [];
    if (isCurrent) badges.push('✓');
    if (isDefault) badges.push('★');
    this.description = badges.length > 0
      ? `${badges.join(' ')} - ${siteInfo.environment}`
      : siteInfo.environment;

    // Set icon based on environment
    this.iconPath = this.getIconForEnvironment(siteInfo.environment);

    // Set context value for when clause in package.json
    this.contextValue = 'owlanterSite';

    // Add command to select site when clicked
    this.command = {
      command: 'owlanter.siteSelect',
      title: 'Select Site',
      arguments: [siteInfo['site-id']]
    };
  }

  /**
   * Get appropriate icon for environment
   */
  private getIconForEnvironment(environment: string): vscode.ThemeIcon {
    switch (environment.toLowerCase()) {
      case 'production':
        return new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.red'));
      case 'staging':
        return new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.yellow'));
      case 'development':
        return new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'));
      default:
        return new vscode.ThemeIcon('server');
    }
  }
}
