import * as vscode from 'vscode';
import { SiteManager } from '../core/site-manager';
import { ScriptSynchronizer } from '../core/script-sync';
import { FileWatcher } from '../core/file-watcher';
import { createApiClient, normalizeDomain } from '../utils/connection';
import type { ScriptTreeItem, SiteTreeItem } from './tree-provider';

type ScriptNodeArgs = {
  siteId: number;
  scriptType: 'server' | 'client';
  scriptId?: number;
  filePath?: string;
};

type SiteNodeArgs = {
  siteId: number;
};

function normalizeSiteId(arg: unknown): number | undefined {
  if (!arg) {
    return undefined;
  }
  if (typeof arg === 'object' && arg !== null) {
    const maybeSite = arg as SiteNodeArgs;
    if (typeof (maybeSite as SiteNodeArgs).siteId === 'number') {
      return maybeSite.siteId;
    }
    const maybeTreeItem = arg as SiteTreeItem;
    if (maybeTreeItem.siteInfo && typeof maybeTreeItem.siteInfo['site-id'] === 'number') {
      return maybeTreeItem.siteInfo['site-id'];
    }
  }
  return undefined;
}

function normalizeScriptArgs(arg: unknown): ScriptNodeArgs | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined;
  }
  const maybeArgs = arg as ScriptNodeArgs;
  if (
    typeof maybeArgs.siteId === 'number' &&
    (maybeArgs.scriptType === 'server' || maybeArgs.scriptType === 'client')
  ) {
    return {
      siteId: maybeArgs.siteId,
      scriptType: maybeArgs.scriptType,
      scriptId: maybeArgs.scriptId,
      filePath: maybeArgs.filePath,
    };
  }

  const maybeTreeItem = arg as ScriptTreeItem;
  if (
    maybeTreeItem.siteInfo &&
    typeof maybeTreeItem.siteInfo['site-id'] === 'number' &&
    (maybeTreeItem.scriptType === 'server' || maybeTreeItem.scriptType === 'client')
  ) {
    return {
      siteId: maybeTreeItem.siteInfo['site-id'],
      scriptType: maybeTreeItem.scriptType,
      scriptId: maybeTreeItem.scriptId,
      filePath: maybeTreeItem.filePath,
    };
  }

  return undefined;
}

export async function registerCommands(
  context: vscode.ExtensionContext,
  siteManager: SiteManager,
  scriptSynchronizer: ScriptSynchronizer,
  fileWatcher: FileWatcher
): Promise<void> {
  registerSiteCommands(context, siteManager);
  registerSyncCommands(context, siteManager, scriptSynchronizer, fileWatcher);
  registerUploadCommands(context, siteManager, scriptSynchronizer);
  registerScriptManagementCommands(context, siteManager, scriptSynchronizer);
  registerConfigCommands(context, siteManager);
}

function registerSiteCommands(
  context: vscode.ExtensionContext,
  siteManager: SiteManager
): void {
  // Site List
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.siteList', async () => {
      try {
        const config = await siteManager.getSites();
        const currentSite = await siteManager.getCurrentSite();

        const items = config.sites.map(site => ({
          label: `${site.active ? '$(check) ' : ''}${site['site-name']}`,
          description: `ID: ${site['site-id']} | ${site.environment}`,
          detail: site.description,
          siteId: site['site-id'],
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Current: ${currentSite?.['site-name'] ?? 'None'}`,
        });

        if (selected) {
          await siteManager.selectSite(selected.siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to list sites: ${error.message}`);
      }
    })
  );

  // Site Select
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.siteSelect', async (siteId?: number) => {
      try {
        if (typeof siteId === 'number') {
          await siteManager.selectSite(siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          return;
        }

        const config = await siteManager.getSites();
        if (config.sites.length === 0) {
          const answer = await vscode.window.showInformationMessage(
            'No sites registered. Add a site first?',
            'Add Site'
          );
          if (answer === 'Add Site') {
            await vscode.commands.executeCommand('owlanter.siteAdd');
          }
          return;
        }

        const items = config.sites.map(site => ({
          label: site['site-name'],
          description: `ID: ${site['site-id']} | ${site.environment}`,
          detail: site.description,
          siteId: site['site-id'],
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a site to switch to',
        });

        if (selected) {
          await siteManager.selectSite(selected.siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to select site: ${error.message}`);
      }
    })
  );

  // Site Current
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.siteCurrent', async () => {
      try {
        const currentSite = await siteManager.getCurrentSite();

        if (!currentSite) {
          vscode.window.showInformationMessage('No site is currently selected.');
          return;
        }

        const message = [
          '**Current Site**',
          `- Name: ${currentSite['site-name']}`,
          `- ID: ${currentSite['site-id']}`,
          `- Environment: ${currentSite.environment}`,
          `- Description: ${currentSite.description}`,
          `- Last Sync: ${currentSite['last-sync']}`,
        ].join('\n');

        vscode.window.showInformationMessage(message);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to get current site: ${error.message}`);
      }
    })
  );

  // Site Add
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.siteAdd', async () => {
      try {
        const siteIdInput = await vscode.window.showInputBox({
          prompt: 'Enter Site ID',
          placeHolder: '1234',
          validateInput: value => (!value || isNaN(Number(value)) ? 'Please enter a valid number' : null),
        });

        if (!siteIdInput) {
          return;
        }

        const siteId = Number(siteIdInput);
        let siteTitle: string | undefined;
        let siteDescription = '';

        try {
          const apiClient = await createApiClient(siteManager);
          const siteInfo = await apiClient.getSiteSettings(siteId);
          siteTitle = (siteInfo?.Title ?? siteInfo?.SiteName ?? '').trim() || undefined;
          siteDescription = siteInfo?.Body ?? '';
        } catch (error: any) {
          const action = await vscode.window.showErrorMessage(
            `Failed to fetch site information (ID: ${siteId}).`,
            'Configure Connection',
            'Manual Input',
            'Cancel'
          );

          if (action === 'Configure Connection') {
            await vscode.commands.executeCommand('owlanter.configSet');
            return;
          }

          if (action !== 'Manual Input') {
            return;
          }
        }

        if (!siteTitle) {
          siteTitle = await vscode.window.showInputBox({
            prompt: 'Enter Site Name',
            placeHolder: 'Owlanter Site',
          });
        }

        if (!siteTitle) {
          vscode.window.showInformationMessage('Site creation cancelled.');
          return;
        }

        const environment = await vscode.window.showQuickPick(
          ['production', 'staging', 'development'],
          { placeHolder: 'Select Environment' }
        );

        if (!environment) {
          return;
        }

        await siteManager.addSite(
          siteId,
          siteTitle,
          siteDescription,
          environment as 'production' | 'staging' | 'development'
        );

        await vscode.commands.executeCommand('owlanter.sitesRefresh');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to add site: ${error.message}`);
      }
    })
  );
}

function registerSyncCommands(
  context: vscode.ExtensionContext,
  siteManager: SiteManager,
  scriptSynchronizer: ScriptSynchronizer,
  fileWatcher: FileWatcher
): void {
  // Pull
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.pull', async (payload?: SiteNodeArgs | SiteTreeItem) => {
      try {
        const siteId = normalizeSiteId(payload);
        await scriptSynchronizer.pull(siteId);
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Pull failed: ${error.message}`);
      }
    })
  );

  // Push
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.push', async (payload?: SiteNodeArgs | SiteTreeItem) => {
      try {
        const siteId = normalizeSiteId(payload);
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Push changes', value: 'push' },
            { label: 'Dry-run (Diff only)', value: 'dry-run' },
            { label: 'Force push (skip confirmation)', value: 'force' },
          ],
          { placeHolder: 'Select push mode', canPickMany: false }
        );

        if (!action) {
          return;
        }

        if (action.value === 'dry-run') {
          await scriptSynchronizer.push({ dryRun: true, siteId });
        } else if (action.value === 'force') {
          await scriptSynchronizer.push({ force: true, siteId });
        } else {
          await scriptSynchronizer.push({ siteId });
        }
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Push failed: ${error.message}`);
      }
    })
  );

  // Watch
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.watch', async (payload?: SiteNodeArgs | SiteTreeItem) => {
      try {
        let site = null;
        const siteId = normalizeSiteId(payload);
        if (siteId !== undefined) {
          site = await siteManager.getSiteById(siteId);
          if (!site) {
            vscode.window.showErrorMessage('Site not found.');
            return;
          }
        } else {
          site = await requireCurrentSite(siteManager);
        }

        if (fileWatcher.isWatching()) {
          if (fileWatcher.getActiveSiteId() !== site['site-id']) {
            await fileWatcher.stop();
          } else {
            await fileWatcher.stop();
            return;
          }
        }

        const paths = scriptSynchronizer.getWatchPaths(site['site-id']);
        await fileWatcher.start(site['site-id'], paths);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Watch failed: ${error.message}`);
      }
    })
  );

  // Diff
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'owlanter.diff',
      async (payload?: SiteNodeArgs | SiteTreeItem | ScriptNodeArgs | ScriptTreeItem) => {
        try {
          const siteId = normalizeSiteId(payload) ?? normalizeScriptArgs(payload)?.siteId;
          await scriptSynchronizer.diff(siteId);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Diff failed: ${error.message}`);
        }
      }
    )
  );
}

function registerUploadCommands(
  context: vscode.ExtensionContext,
  siteManager: SiteManager,
  scriptSynchronizer: ScriptSynchronizer
): void {
  // Upload (auto detect)
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.upload', async (payload?: ScriptNodeArgs | ScriptTreeItem) => {
      try {
        const scriptArgs = normalizeScriptArgs(payload);
        if (scriptArgs && scriptArgs.filePath) {
          const type = scriptArgs.scriptType === 'server' ? 'server' : 'client';
          await scriptSynchronizer.upload([scriptArgs.filePath], type, scriptArgs.siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          vscode.window.showInformationMessage('Script uploaded successfully.');
          return;
        }

        const site = await requireCurrentSite(siteManager);
        const files = await pickScriptFiles(siteManager.getSiteDir(site['site-id']));
        if (files.length === 0) {
          return;
        }
        await scriptSynchronizer.upload(files, undefined, site['site-id']);
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
        vscode.window.showInformationMessage('Scripts uploaded successfully.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Upload failed: ${error.message}`);
      }
    })
  );

  // Upload Server
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.uploadServer', async (payload?: ScriptNodeArgs | ScriptTreeItem) => {
      try {
        const scriptArgs = normalizeScriptArgs(payload);
        if (scriptArgs && scriptArgs.scriptType === 'server' && scriptArgs.filePath) {
          await scriptSynchronizer.upload([scriptArgs.filePath], 'server', scriptArgs.siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          vscode.window.showInformationMessage('Server script uploaded.');
          return;
        }

        const site = await requireCurrentSite(siteManager);
        const files = await pickScriptFiles(siteManager.getServerScriptDir(site['site-id']));
        if (files.length === 0) {
          return;
        }
        await scriptSynchronizer.upload(files, 'server', site['site-id']);
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
        vscode.window.showInformationMessage('Server scripts uploaded.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Server upload failed: ${error.message}`);
      }
    })
  );

  // Upload Client
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.uploadClient', async (payload?: ScriptNodeArgs | ScriptTreeItem) => {
      try {
        const scriptArgs = normalizeScriptArgs(payload);
        if (scriptArgs && scriptArgs.scriptType === 'client' && scriptArgs.filePath) {
          await scriptSynchronizer.upload([scriptArgs.filePath], 'client', scriptArgs.siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          vscode.window.showInformationMessage('Client script uploaded.');
          return;
        }

        const site = await requireCurrentSite(siteManager);
        const files = await pickScriptFiles(siteManager.getClientScriptDir(site['site-id']));
        if (files.length === 0) {
          return;
        }
        await scriptSynchronizer.upload(files, 'client', site['site-id']);
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
        vscode.window.showInformationMessage('Client scripts uploaded.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Client upload failed: ${error.message}`);
      }
    })
  );

  // Upload file (any path)
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.uploadFile', async (payload?: ScriptNodeArgs | ScriptTreeItem) => {
      try {
        const scriptArgs = normalizeScriptArgs(payload);
        if (scriptArgs && scriptArgs.filePath) {
          const type = scriptArgs.scriptType === 'server' ? 'server' : 'client';
          await scriptSynchronizer.upload([scriptArgs.filePath], type, scriptArgs.siteId);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          vscode.window.showInformationMessage('Script uploaded successfully.');
          return;
        }

        const files = await pickScriptFiles();
        if (files.length === 0) {
          return;
        }
        await scriptSynchronizer.upload(files);
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
        vscode.window.showInformationMessage('Scripts uploaded successfully.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`File upload failed: ${error.message}`);
      }
    })
  );
}

function registerScriptManagementCommands(
  context: vscode.ExtensionContext,
  siteManager: SiteManager,
  scriptSynchronizer: ScriptSynchronizer
): void {
  // Script Show
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.scriptShow', async () => {
      try {
        const site = await requireCurrentSite(siteManager);
        const [serverScripts, clientScripts, active] = await Promise.all([
          scriptSynchronizer.listLocalServerScripts(site['site-id']),
          scriptSynchronizer.listLocalClientScripts(site['site-id']),
          scriptSynchronizer.getActiveScriptIds(site['site-id']),
        ]);

        const serverLabels = serverScripts
          .filter(script => active.server.includes(script.id ?? -1))
          .map(script => `#${script.id ?? '?'} ${script.title}`);

        const clientLabels = clientScripts
          .filter(script => active.client.includes(script.id ?? -1))
          .map(script => `#${script.id ?? '?'} ${script.title}`);

        const message = [
          '**Active Scripts**',
          `- Server: ${serverLabels.length > 0 ? serverLabels.join(', ') : '(none)'}`,
          `- Client: ${clientLabels.length > 0 ? clientLabels.join(', ') : '(none)'}`,
        ].join('\n');

        vscode.window.showInformationMessage(message);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to show active scripts: ${error.message}`);
      }
    })
  );

  // Script Set
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.scriptSet', async (payload?: ScriptNodeArgs | ScriptTreeItem) => {
      try {
        const args = normalizeScriptArgs(payload);
        if (args && typeof args.siteId === 'number' && args.scriptType) {
          if (args.scriptId === undefined) {
            vscode.window.showWarningMessage('Script requires @pleasanter-id metadata to toggle active state.');
            return;
          }

          const sitesConfig = await siteManager.getSites();
          const targetSite = sitesConfig.sites.find(s => s['site-id'] === args.siteId);
          if (!targetSite) {
            vscode.window.showErrorMessage('Site not found.');
            return;
          }

          if (!targetSite.active) {
            const choice = await vscode.window.showWarningMessage(
              'Site "' + targetSite['site-name'] + '" is not active. Activate it to manage scripts?',
              'Activate Site',
              'Cancel'
            );
            if (choice !== 'Activate Site') {
              return;
            }
            await siteManager.selectSite(args.siteId);
            await vscode.commands.executeCommand('owlanter.sitesRefresh');
          }

          const siteId = args.siteId;
          const active = await scriptSynchronizer.getActiveScriptIds(siteId);
          const nextServer = active.server.length > 0 ? [active.server[0]] : [];
          const nextClient = active.client.length > 0 ? [active.client[0]] : [];

          const targetArray = args.scriptType === 'server' ? nextServer : nextClient;
          const existingIndex = targetArray.indexOf(args.scriptId);
          const willActivate = existingIndex === -1;

          if (willActivate) {
            targetArray.splice(0, targetArray.length, args.scriptId);
          } else {
            targetArray.splice(existingIndex, 1);
          }

          await scriptSynchronizer.setActiveScripts(siteId, nextServer, nextClient);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          vscode.window.showInformationMessage(
            'Script #' + args.scriptId + (willActivate ? ' activated.' : ' deactivated.')
          );
          return;
        }

        const site = await requireCurrentSite(siteManager);
        const [serverScripts, clientScripts, active] = await Promise.all([
          scriptSynchronizer.listLocalServerScripts(site['site-id']),
          scriptSynchronizer.listLocalClientScripts(site['site-id']),
          scriptSynchronizer.getActiveScriptIds(site['site-id']),
        ]);

        if (serverScripts.length === 0 && clientScripts.length === 0) {
          vscode.window.showWarningMessage('No scripts found in this site workspace.');
          return;
        }

        const picks = [
          ...serverScripts
            .filter(script => script.id !== null)
            .map(script => ({
              label: 'Server #' + script.id,
              description: script.title,
              picked: active.server.includes(script.id!),
              type: 'server' as const,
              id: script.id!,
            })),
          ...clientScripts
            .filter(script => script.id !== null)
            .map(script => ({
              label: 'Client #' + script.id,
              description: script.title,
              picked: active.client.includes(script.id!),
              type: 'client' as const,
              id: script.id!,
            })),
        ];

        if (picks.length === 0) {
          vscode.window.showWarningMessage('Scripts require @pleasanter-id metadata to be selectable.');
          return;
        }

        const selection = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Select a script to mark as active',
          canPickMany: false,
        });

        if (!selection) {
          return;
        }

        const currentServer = active.server.length > 0 ? [active.server[0]] : [];
        const currentClient = active.client.length > 0 ? [active.client[0]] : [];

        if (selection.type === 'server') {
          await scriptSynchronizer.setActiveScripts(site['site-id'], [selection.id], currentClient);
        } else {
          await scriptSynchronizer.setActiveScripts(site['site-id'], currentServer, [selection.id]);
        }
        vscode.window.showInformationMessage('Active script updated.');
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
      } catch (error: any) {
        vscode.window.showErrorMessage('Failed to set active scripts: ' + error.message);
      }
    })
  );

  // Script Clear
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.scriptClear', async (payload?: ScriptNodeArgs | ScriptTreeItem) => {
      try {
        const args = normalizeScriptArgs(payload);
        if (args && typeof args.siteId === 'number' && args.scriptType) {
          const siteId = args.siteId;
          const active = await scriptSynchronizer.getActiveScriptIds(siteId);
          const nextServer = args.scriptType === 'server' ? [] : active.server.slice(0, 1);
          const nextClient = args.scriptType === 'client' ? [] : active.client.slice(0, 1);

          await scriptSynchronizer.setActiveScripts(siteId, nextServer, nextClient);
          await vscode.commands.executeCommand('owlanter.sitesRefresh');
          vscode.window.showInformationMessage(
            args.scriptType === 'server' ? 'Active server scripts cleared.' : 'Active client scripts cleared.'
          );
          return;
        }

        const site = await requireCurrentSite(siteManager);
        await scriptSynchronizer.clearActiveScripts(site['site-id']);
        await vscode.commands.executeCommand('owlanter.sitesRefresh');
        vscode.window.showInformationMessage('All active scripts cleared.');
      } catch (error: any) {
        vscode.window.showErrorMessage('Failed to clear active scripts: ' + error.message);
      }
    })
  );
}

function registerConfigCommands(
  context: vscode.ExtensionContext,
  siteManager: SiteManager
): void {
  // Config Init
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.configInit', async () => {
      try {
        await siteManager.initializeConfig(true);
        vscode.window.showInformationMessage('config.json has been initialized.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to initialize config: ${error.message}`);
      }
    })
  );

  // Config Sync
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.configSync', async () => {
      try {
        const settings = vscode.workspace.getConfiguration('owlanter');
        const domain = (settings.get<string>('domain') ?? '').trim();
        const apiKey = (settings.get<string>('apiKey') ?? '').trim();

        if (!domain || !apiKey) {
          vscode.window.showWarningMessage('Owlanter settings are empty. Please set domain and API key first.');
          return;
        }

        const config =
          (await siteManager.configExists())
            ? await siteManager.getConfig()
            : await siteManager.initializeConfig();

        config['pleasanter-domain'] = normalizeDomain(domain);
        config['pleasanter-api'] = apiKey;

        await siteManager.saveConfig(config);
        vscode.window.showInformationMessage('VS Code settings have been synced to config.json.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to sync config: ${error.message}`);
      }
    })
  );

  // Config Show
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.configShow', async () => {
      try {
        const config = await siteManager.getConfig();
        const settings = vscode.workspace.getConfiguration('owlanter');

        const configDomain = (config['pleasanter-domain'] ?? '').trim() || '(譛ｪ險ｭ螳・';
        const configKey = (config['pleasanter-api'] ?? '').trim();
        const maskedConfigKey = configKey ? `${configKey.substring(0, 4)}...` : '(譛ｪ險ｭ螳・';

        const settingsDomain = (settings.get<string>('domain') ?? '').trim() || '(譛ｪ險ｭ螳・';
        const settingsKey = (settings.get<string>('apiKey') ?? '').trim();
        const maskedSettingsKey = settingsKey ? `${settingsKey.substring(0, 4)}...` : '(譛ｪ險ｭ螳・';

        const message = [
          '**Owlanter 險ｭ螳・*',
          `- config.json Domain: ${configDomain}`,
          `- config.json API Key: ${maskedConfigKey}`,
          `- Settings Domain: ${settingsDomain}`,
          `- Settings API Key: ${maskedSettingsKey}`,
          `- Auto Backup: ${config.settings['auto-backup']}`,
          `- Backup Count: ${config.settings['backup-count']}`,
        ].join('\n');

        vscode.window.showInformationMessage(message);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to show config: ${error.message}`);
      }
    })
  );

  // Config Set (manual input)
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.configSet', async () => {
      try {
        const domain = await vscode.window.showInputBox({
          prompt: 'Enter Owlanter Domain',
          placeHolder: 'https://your-pleasanter-server.com/',
        });

        if (!domain) {
          return;
        }

        const apiKey = await vscode.window.showInputBox({
          prompt: 'Enter API Key',
          password: true,
        });

        if (!apiKey) {
          return;
        }

        const config =
          (await siteManager.configExists())
            ? await siteManager.getConfig()
            : await siteManager.initializeConfig();

        const normalizedDomain = normalizeDomain(domain);
        config['pleasanter-domain'] = normalizedDomain;
        config['pleasanter-api'] = apiKey;

        await siteManager.saveConfig(config);

        const settings = vscode.workspace.getConfiguration('owlanter');
        await settings.update('domain', normalizedDomain, vscode.ConfigurationTarget.Global);
        await settings.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage('Configuration updated successfully.');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to update config: ${error.message}`);
      }
    })
  );

  // Open Settings shortcut
  context.subscriptions.push(
    vscode.commands.registerCommand('owlanter.openSettings', async () => {
      try {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'owlanter');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open settings: ${error.message}`);
      }
    })
  );
}

async function requireCurrentSite(siteManager: SiteManager) {
  const site = await siteManager.getCurrentSite();
  if (!site) {
    throw new Error('No site selected. Use Owlanter: 繧ｵ繧､繝磯∈謚・to choose a site.');
  }
  return site;
}

async function pickScriptFiles(defaultDir?: string): Promise<string[]> {
  const defaultUri = defaultDir ? vscode.Uri.file(defaultDir) : undefined;
  const result = await vscode.window.showOpenDialog({
    defaultUri,
    canSelectFiles: true,
    canSelectMany: true,
    filters: {
      Scripts: ['js'],
      All: ['*'],
    },
  });

  return result ? result.map(uri => uri.fsPath) : [];
}


