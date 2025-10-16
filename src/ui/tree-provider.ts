import * as vscode from "vscode";
import { SiteManager } from "../core/site-manager";
import { SiteInfo } from "../api/types";
import { ScriptSynchronizer } from "../core/script-sync";

type OwlanterTreeItem = SiteTreeItem | ScriptTreeItem;

export class OwlanterSitesProvider implements vscode.TreeDataProvider<OwlanterTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OwlanterTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly siteManager: SiteManager,
    private readonly scriptSynchronizer: ScriptSynchronizer
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OwlanterTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OwlanterTreeItem): Promise<OwlanterTreeItem[]> {
    if (!element) {
      try {
        const sitesConfig = await this.siteManager.getSites();

        if (!sitesConfig.sites || sitesConfig.sites.length === 0) {
          return [];
        }

        return sitesConfig.sites.map(site => {
          const isCurrent = site["site-id"] === sitesConfig["current-site"];
          const isDefault = site["site-id"] === sitesConfig["default-site"];
          const abbreviation = this.getEnvironmentAbbreviation(site.environment);

          return new SiteTreeItem(site, isCurrent, isDefault, abbreviation, vscode.TreeItemCollapsibleState.Collapsed);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to load sites: ${message}`);
        return [];
      }
    }

    if (element instanceof SiteTreeItem) {
      const siteId = element.siteInfo["site-id"];

      try {
        const [serverScripts, clientScripts, active] = await Promise.all([
          this.scriptSynchronizer.listLocalServerScripts(siteId),
          this.scriptSynchronizer.listLocalClientScripts(siteId),
          this.scriptSynchronizer.getActiveScriptIds(siteId)
        ]);

        const serverItems = serverScripts.map(script => {
          const scriptId = script.id ?? undefined;
          const isActive = scriptId !== undefined && active.server.includes(scriptId);
          return new ScriptTreeItem(
            element.siteInfo,
            "server",
            scriptId,
            script.title,
            script.filePath,
            isActive
          );
        });

        const clientItems = clientScripts.map(script => {
          const scriptId = script.id ?? undefined;
          const isActive = scriptId !== undefined && active.client.includes(scriptId);
          return new ScriptTreeItem(
            element.siteInfo,
            "client",
            scriptId,
            script.title,
            script.filePath,
            isActive
          );
        });

        return [...serverItems, ...clientItems];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to load scripts: ${message}`);
        return [];
      }
    }

    return [];
  }

  private getEnvironmentAbbreviation(environment: string): string {
    switch (environment?.toLowerCase()) {
      case "production":
        return "P";
      case "staging":
        return "S";
      case "development":
        return "D";
      default:
        return "U";
    }
  }
}

export class SiteTreeItem extends vscode.TreeItem {
  constructor(
    public readonly siteInfo: SiteInfo,
    public readonly isCurrent: boolean,
    public readonly isDefault: boolean,
    private readonly environmentAbbreviation: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(SiteTreeItem.buildLabel(environmentAbbreviation, siteInfo), collapsibleState);

    this.tooltip = [
      `Site ID: ${siteInfo["site-id"]}`,
      `Name: ${siteInfo["site-name"]}`,
      `Description: ${siteInfo.description || "N/A"}`,
      `Environment: ${siteInfo.environment}`,
      isCurrent ? "✓ Current Site" : "",
      isDefault ? "★ Default Site" : ""
    ]
      .filter(Boolean)
      .join("\n");

    const badges: string[] = [];
    if (isCurrent) badges.push("✓");
    if (isDefault) badges.push("★");
    this.description = badges.length > 0 ? `${badges.join(" ")} ${siteInfo.environment}` : siteInfo.environment;

    this.iconPath = this.getIconForEnvironment(siteInfo.environment);
    this.contextValue = "owlanterSite";
    this.command = {
      command: "owlanter.siteSelect",
      title: "Select Site",
      arguments: [siteInfo["site-id"]]
    };
  }

  private static buildLabel(environmentAbbreviation: string, siteInfo: SiteInfo): string {
    const title = siteInfo["site-name"] || "Untitled";
    return `${environmentAbbreviation}_${siteInfo["site-id"]}_${title}`;
  }

  private getIconForEnvironment(environment: string): vscode.ThemeIcon {
    switch (environment?.toLowerCase()) {
      case "production":
        return new vscode.ThemeIcon("server-environment", new vscode.ThemeColor("charts.red"));
      case "staging":
        return new vscode.ThemeIcon("server-environment", new vscode.ThemeColor("charts.yellow"));
      case "development":
        return new vscode.ThemeIcon("server-environment", new vscode.ThemeColor("charts.green"));
      default:
        return new vscode.ThemeIcon("server");
    }
  }
}

export class ScriptTreeItem extends vscode.TreeItem {
  constructor(
    public readonly siteInfo: SiteInfo,
    public readonly scriptType: "server" | "client",
    public readonly scriptId: number | undefined,
    public readonly titleText: string,
    public readonly filePath: string,
    public readonly isActive: boolean
  ) {
    super(ScriptTreeItem.buildLabel(scriptType, scriptId, titleText), vscode.TreeItemCollapsibleState.None);

    this.contextValue = scriptType === "server" ? "owlanterScript.server" : "owlanterScript.client";

    const typeLabel = scriptType === "server" ? "Server" : "Client";
    this.description = isActive ? `✓ ${typeLabel}` : typeLabel;

    this.tooltip = [
      `${typeLabel} Script`,
      `Site: ${siteInfo["site-name"]} (#${siteInfo["site-id"]})`,
      `Script ID: ${scriptId ?? "(none)"}`,
      `Title: ${titleText || "(untitled)"}`,
      `Path: ${filePath}`,
      `Active: ${isActive}`
    ].join("\n");

    this.iconPath = new vscode.ThemeIcon(scriptType === "server" ? "symbol-method" : "symbol-event");

    this.command = {
      command: "owlanter.scriptSet",
      title: "Toggle Active Script",
      arguments: [
        {
          siteId: siteInfo["site-id"],
          scriptType,
          scriptId,
          filePath
        }
      ]
    };
  }

  private static buildLabel(type: "server" | "client", scriptId: number | undefined, title: string): string {
    const prefix = type === "server" ? "S" : "C";
    const idPart = scriptId !== undefined ? scriptId.toString() : "new";
    const safeTitle = title && title.trim().length > 0 ? title : "(untitled)";
    return `${prefix}_${idPart}_${safeTitle}`;
  }
}
