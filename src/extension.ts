import * as vscode from 'vscode';
import { SiteManager } from './core/site-manager';
import { registerCommands } from './ui/commands';
import { OwlanterSitesProvider } from './ui/tree-provider';
import { ScriptSynchronizer } from './core/script-sync';
import { FileWatcher } from './core/file-watcher';

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Owlanter extension is now active!');

  // Get workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(
      'Owlanter requires a workspace to be opened. Please open a folder.'
    );
    return;
  }

  try {
    // Initialize Site Manager
    const siteManager = new SiteManager(workspaceRoot);

    // Register tree data provider for Owlanter Sites view
    const sitesProvider = new OwlanterSitesProvider(context, siteManager);
    vscode.window.registerTreeDataProvider('owlanterSites', sitesProvider);

    // Register refresh command for tree view
    context.subscriptions.push(
      vscode.commands.registerCommand('owlanter.sitesRefresh', () => {
        sitesProvider.refresh();
      })
    );

    const scriptSynchronizer = new ScriptSynchronizer(siteManager);
    const fileWatcher = new FileWatcher(scriptSynchronizer);

    // Ensure watcher stops on deactivate
    context.subscriptions.push({ dispose: () => fileWatcher.stop() });

    // Register all commands
    await registerCommands(context, siteManager, scriptSynchronizer, fileWatcher);

    console.log('Owlanter: All commands registered successfully');

    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get('owleanter.hasShownWelcome');
    if (!hasShownWelcome) {
      const answer = await vscode.window.showInformationMessage(
        'Welcome to Owlanter! Configure your Owlanter connection first.',
        'Configure Now',
        'Later'
      );

      if (answer === 'Configure Now') {
        await vscode.commands.executeCommand('owlanter.configSet');
      }

      context.globalState.update('owleanter.hasShownWelcome', true);
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Owlanter activation failed: ${error.message}`);
    console.error('Owlanter activation error:', error);
  }
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('Owlanter extension is now deactivated');
}
