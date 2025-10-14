import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import { ScriptSynchronizer } from './script-sync';

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private activeSiteId: number | null = null;

  constructor(private readonly scriptSynchronizer: ScriptSynchronizer) {}

  isWatching(): boolean {
    return this.watcher !== null;
  }

  getActiveSiteId(): number | null {
    return this.activeSiteId;
  }

  async start(siteId: number, watchPaths: string[]): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    if (watchPaths.length === 0) {
      vscode.window.showWarningMessage('No directories to watch.');
      return;
    }

    this.activeSiteId = siteId;
    this.watcher = chokidar.watch(watchPaths, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', async (filePath: string) => {
      try {
        await this.scriptSynchronizer.pushFile(siteId, filePath, { silent: true });
        vscode.window.setStatusBarMessage(`Owlanter: Auto-pushed ${path.basename(filePath)}`, 1500);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Auto push failed: ${error?.message ?? error}`);
      }
    });

    this.watcher.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Owlanter watcher error: ${message}`);
    });

    vscode.window.showInformationMessage('Owlanter watch started.');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.activeSiteId = null;
      vscode.window.showInformationMessage('Owlanter watch stopped.');
    }
  }
}
