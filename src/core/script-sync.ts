import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SiteManager } from './site-manager';
import { MetadataParser } from './metadata-parser';
import { Script, ServerScript, SiteData } from '../api/types';
import { createApiClient } from '../utils/connection';

interface PushOptions {
  dryRun?: boolean;
  force?: boolean;
  files?: string[];
}

interface LocalServerScript {
  id: number | null;
  title: string;
  filePath: string;
  script: ServerScript;
}

interface LocalClientScript {
  id: number | null;
  title: string;
  filePath: string;
  script: Script;
}

interface DiffEntry {
  type: 'server' | 'client';
  id: number | null;
  title: string;
  localPath?: string;
  remoteContent?: string;
}

export class ScriptSynchronizer {
  constructor(private readonly siteManager: SiteManager) {}

  async pull(siteId?: number): Promise<void> {
    const site = await this.requireSite(siteId);
    const apiClient = await createApiClient(this.siteManager);
    const siteData = await apiClient.getSiteSettings(site['site-id']);

    const siteDir = this.siteManager.getSiteDir(site['site-id']);
    await fs.mkdir(siteDir, { recursive: true });

    await fs.writeFile(
      path.join(siteDir, 'site-setting.json'),
      JSON.stringify(siteData, null, 2),
      'utf8'
    );

    const serverScripts = this.normalizeServerScripts(siteData);
    const clientScripts = this.normalizeClientScripts(siteData);

    const serverDir = this.siteManager.getServerScriptDir(site['site-id']);
    const clientDir = this.siteManager.getClientScriptDir(site['site-id']);

    const writtenServer = await this.writeServerScripts(serverDir, serverScripts);
    const writtenClient = await this.writeClientScripts(clientDir, clientScripts);

    await this.cleanupOrphanFiles(serverDir, writtenServer);
    await this.cleanupOrphanFiles(clientDir, writtenClient);

    await this.siteManager.updateSiteInfo(site['site-id'], info => {
      info.title = siteData.Title ?? info.title;
      info['reference-type'] = siteData.ReferenceType ?? info['reference-type'];
      info['scripts-count'] = {
        'server-scripts': serverScripts.length,
        'client-scripts': clientScripts.length,
      };
      info['last-pulled'] = new Date().toISOString();
    });

    await this.siteManager.updateLastSync(site['site-id']);
    vscode.window.showInformationMessage(`Pull completed for site ${site['site-name']}`);
  }

  async push(options: PushOptions = {}): Promise<void> {
    const site = await this.requireSite();
    if (options.dryRun) {
      await this.diff(site['site-id']);
      return;
    }

    const { serverScripts, clientScripts } = await this.collectLocalScripts(site['site-id']);
    const { server: activeServer, client: activeClient } = await this.getActiveScriptIds(site['site-id']);

    const filteredServer = this.filterByActive(serverScripts, activeServer);
    const filteredClient = this.filterByActive(clientScripts, activeClient);

    if (filteredServer.length === 0 && filteredClient.length === 0) {
      vscode.window.showInformationMessage('No scripts to push.');
      return;
    }

    const requiresConfirmation = await this.siteManager.isConfirmationRequired(site.environment);
    if (requiresConfirmation && !options.force) {
      const answer = await vscode.window.showWarningMessage(
        `Push scripts to ${site.environment} environment?`,
        { modal: true },
        'Push',
        'Cancel'
      );
      if (answer !== 'Push') {
        return;
      }
    }

    const apiClient = await createApiClient(this.siteManager);
    await apiClient.batchUpdateScripts(
      site['site-id'],
      filteredClient.map(item => item.script),
      filteredServer.map(item => item.script)
    );

    await this.siteManager.updateSiteInfo(site['site-id'], info => {
      info['last-pushed'] = new Date().toISOString();
    });
    await this.siteManager.updateLastSync(site['site-id']);

    vscode.window.showInformationMessage(
      `Push completed (server: ${filteredServer.length}, client: ${filteredClient.length})`
    );
  }

  async pushFile(siteId: number, filePath: string, options: { silent?: boolean } = {}): Promise<void> {
    const site = await this.requireSite(siteId);
    const normalized = path.normalize(filePath);
    const serverDir = path.normalize(this.siteManager.getServerScriptDir(site['site-id']));
    const clientDir = path.normalize(this.siteManager.getClientScriptDir(site['site-id']));

    if (!normalized.startsWith(serverDir) && !normalized.startsWith(clientDir)) {
      if (!options.silent) {
        vscode.window.showWarningMessage('The modified file is not under server-script or client-script directories.');
      }
      return;
    }

    const apiClient = await createApiClient(this.siteManager);
    const existingMaps = await this.loadExistingScriptMaps(site['site-id']);

    if (normalized.startsWith(serverDir)) {
      const script = await this.parseServerScript(normalized, existingMaps.server);
      await apiClient.addServerScript(site['site-id'], script.script);
    } else {
      const script = await this.parseClientScript(normalized, existingMaps.client);
      await apiClient.addScript(site['site-id'], script.script);
    }

    await this.siteManager.updateSiteInfo(site['site-id'], info => {
      info['last-pushed'] = new Date().toISOString();
    });
    await this.siteManager.updateLastSync(site['site-id']);

    if (!options.silent) {
      vscode.window.showInformationMessage(`Uploaded changes for ${path.basename(filePath)}`);
    }
  }

  async diff(siteId?: number): Promise<void> {
    const site = await this.requireSite(siteId);
    const apiClient = await createApiClient(this.siteManager);
    const siteData = await apiClient.getSiteSettings(site['site-id']);

    const remoteServers = this.normalizeServerScripts(siteData);
    const remoteClients = this.normalizeClientScripts(siteData);
    const localServer = await this.collectLocalServerScripts(site['site-id']);
    const localClient = await this.collectLocalClientScripts(site['site-id']);

    const entries = this.buildDiffEntries(remoteServers, remoteClients, localServer, localClient);

    if (entries.length === 0) {
      vscode.window.showInformationMessage('No scripts available for diff.');
      return;
    }

    const items = entries.map(entry => ({
      label: entry.title,
      description: `${entry.type.toUpperCase()} ${entry.id ?? '(new)'}`,
      entry,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a script to diff',
    });

    if (!selected) {
      return;
    }

    await this.openDiff(selected.entry);
  }

  async upload(paths: string[], type?: 'server' | 'client'): Promise<void> {
    const site = await this.requireSite();
    if (paths.length === 0) {
      return;
    }

    const apiClient = await createApiClient(this.siteManager);

    const serverUploads: ServerScript[] = [];
    const clientUploads: Script[] = [];

    for (const filePath of paths) {
      const normalized = path.normalize(filePath);
      let targetType = type;

      if (!targetType) {
        if (normalized.includes('server-script')) {
          targetType = 'server';
        } else if (normalized.includes('client-script')) {
          targetType = 'client';
        }
      }

      if (!targetType) {
        const selection = await vscode.window.showQuickPick(
          [
            { label: 'Server Script', value: 'server' },
            { label: 'Client Script', value: 'client' },
          ],
          { placeHolder: `Select script type for ${path.basename(filePath)}` }
        );
        if (!selection) {
          continue;
        }
        targetType = selection.value as 'server' | 'client';
      }

      if (targetType === 'server') {
        const parsed = await this.parseServerScript(filePath);
        serverUploads.push(parsed.script);
      } else {
        const parsed = await this.parseClientScript(filePath);
        clientUploads.push(parsed.script);
      }
    }

    if (serverUploads.length === 0 && clientUploads.length === 0) {
      vscode.window.showInformationMessage('No scripts to upload.');
      return;
    }

    await apiClient.batchUpdateScripts(site['site-id'], clientUploads, serverUploads);

    await this.siteManager.updateSiteInfo(site['site-id'], info => {
      info['last-pushed'] = new Date().toISOString();
    });
    await this.siteManager.updateLastSync(site['site-id']);

    vscode.window.showInformationMessage(
      `Uploaded scripts (server: ${serverUploads.length}, client: ${clientUploads.length})`
    );
  }

  async getActiveScriptIds(siteId: number): Promise<{ server: number[]; client: number[] }> {
    const info = await this.siteManager.readSiteInfo(siteId);
    return {
      server: Array.isArray(info['active-scripts']?.server) ? info['active-scripts'].server : [],
      client: Array.isArray(info['active-scripts']?.client) ? info['active-scripts'].client : [],
    };
  }

  async setActiveScripts(siteId: number, server: number[], client: number[]): Promise<void> {
    await this.siteManager.updateSiteInfo(siteId, info => {
      info['active-scripts'] = {
        server: [...new Set(server)].sort((a, b) => a - b),
        client: [...new Set(client)].sort((a, b) => a - b),
      };
    });
  }

  async clearActiveScripts(siteId: number): Promise<void> {
    await this.setActiveScripts(siteId, [], []);
  }

  async listLocalServerScripts(siteId: number): Promise<LocalServerScript[]> {
    const maps = await this.loadExistingScriptMaps(siteId);
    return this.collectLocalServerScripts(siteId, maps.server);
  }

  async listLocalClientScripts(siteId: number): Promise<LocalClientScript[]> {
    const maps = await this.loadExistingScriptMaps(siteId);
    return this.collectLocalClientScripts(siteId, maps.client);
  }

  getWatchPaths(siteId: number): string[] {
    return [
      this.siteManager.getServerScriptDir(siteId),
      this.siteManager.getClientScriptDir(siteId),
    ];
  }

  private async requireSite(siteId?: number) {
    const target = siteId !== undefined
      ? await this.siteManager.getSiteById(siteId)
      : await this.siteManager.getCurrentSite();

    if (!target) {
      throw new Error('No site selected. Please select a site first.');
    }

    return target;
  }

  private normalizeServerScripts(siteData: SiteData): ServerScript[] {
    const scripts = siteData.SiteSettings?.ServerScripts ?? [];
    return scripts.map(raw => this.normalizeServerScript(raw));
  }

  private normalizeClientScripts(siteData: SiteData): Script[] {
    const scripts = siteData.SiteSettings?.Scripts ?? [];
    return scripts.map(raw => this.normalizeClientScript(raw));
  }

  private normalizeServerScript(raw: any): ServerScript {
    const script: ServerScript = {
      Id: toNumberOrUndefined(raw.Id ?? raw.ID),
      Title: raw.Title ?? raw.Name ?? '',
      Name: raw.Name ?? raw.Title ?? '',
      Body: raw.Body ?? '',
      ServerScriptWhenloadingSiteSettings: toBool(raw, ['ServerScriptWhenloadingSiteSettings', 'WhenLoadingSiteSettings']),
      ServerScriptWhenViewProcessing: toBool(raw, ['ServerScriptWhenViewProcessing', 'WhenViewProcessing']),
      ServerScriptWhenloadingRecord: toBool(raw, ['ServerScriptWhenloadingRecord', 'WhenLoadingRecord']),
      ServerScriptBeforeFormula: toBool(raw, ['ServerScriptBeforeFormula', 'BeforeFormula']),
      ServerScriptAfterFormula: toBool(raw, ['ServerScriptAfterFormula', 'AfterFormula']),
      ServerScriptBeforeCreate: toBool(raw, ['ServerScriptBeforeCreate', 'BeforeCreate']),
      ServerScriptAfterCreate: toBool(raw, ['ServerScriptAfterCreate', 'AfterCreate']),
      ServerScriptBeforeUpdate: toBool(raw, ['ServerScriptBeforeUpdate', 'BeforeUpdate']),
      ServerScriptAfterUpdate: toBool(raw, ['ServerScriptAfterUpdate', 'AfterUpdate']),
      ServerScriptBeforeDelete: toBool(raw, ['ServerScriptBeforeDelete', 'BeforeDelete']),
      ServerScriptAfterDelete: toBool(raw, ['ServerScriptAfterDelete', 'AfterDelete']),
      ServerScriptBeforeBulkDelete: toBool(raw, ['ServerScriptBeforeBulkDelete', 'BeforeBulkDelete']),
      ServerScriptAfterBulkDelete: toBool(raw, ['ServerScriptAfterBulkDelete', 'AfterBulkDelete']),
      ServerScriptBeforeOpeningPage: toBool(raw, ['ServerScriptBeforeOpeningPage', 'BeforeOpeningPage']),
      ServerScriptBeforeOpeningRow: toBool(raw, ['ServerScriptBeforeOpeningRow', 'BeforeOpeningRow']),
      ServerScriptShared: toBool(raw, ['ServerScriptShared', 'Shared']),
      Functionalize: toBool(raw, ['Functionalize']),
      TryCatch: toBool(raw, ['TryCatch', 'Trycatch']),
    };

    return script;
  }

  private normalizeClientScript(raw: any): Script {
    const script: Script = {
      Id: toNumberOrUndefined(raw.Id ?? raw.ID),
      Title: raw.Title ?? '',
      Body: raw.Body ?? '',
      Disabled: toBool(raw, ['Disabled']),
      ScriptAll: toBool(raw, ['ScriptAll', 'All']),
      ScriptNew: toBool(raw, ['ScriptNew', 'New']),
      ScriptEdit: toBool(raw, ['ScriptEdit', 'Edit']),
      ScriptIndex: toBool(raw, ['ScriptIndex', 'Index']),
    };

    return script;
  }

  private async writeServerScripts(directory: string, scripts: ServerScript[]): Promise<string[]> {
    await fs.mkdir(directory, { recursive: true });
    const written: string[] = [];

    for (const script of scripts) {
      const fileName = `${script.Id ?? 'new'}_${sanitizeFileName(script.Title ?? script.Name ?? 'server-script')}.js`;
      const target = path.join(directory, fileName);
      await MetadataParser.writeServerScriptFile(target, script);
      written.push(target);
    }

    return written;
  }

  private async writeClientScripts(directory: string, scripts: Script[]): Promise<string[]> {
    await fs.mkdir(directory, { recursive: true });
    const written: string[] = [];

    for (const script of scripts) {
      const fileName = `${script.Id ?? 'new'}_${sanitizeFileName(script.Title ?? 'client-script')}.js`;
      const target = path.join(directory, fileName);
      await MetadataParser.writeScriptFile(target, script);
      written.push(target);
    }

    return written;
  }

  private async cleanupOrphanFiles(directory: string, keepFiles: string[]): Promise<void> {
    const keepSet = new Set(keepFiles.map(f => path.normalize(f)));
    const entries = await safeReadDir(directory);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.js')) {
        continue;
      }
      const target = path.normalize(path.join(directory, entry.name));
      if (!keepSet.has(target)) {
        await fs.unlink(target);
      }
    }
  }

  private async collectLocalScripts(siteId: number): Promise<{
    serverScripts: LocalServerScript[];
    clientScripts: LocalClientScript[];
  }> {
    const existingMaps = await this.loadExistingScriptMaps(siteId);
    const serverScripts = await this.collectLocalServerScripts(siteId, existingMaps.server);
    const clientScripts = await this.collectLocalClientScripts(siteId, existingMaps.client);
    return { serverScripts, clientScripts };
  }

  private async loadExistingScriptMaps(siteId: number): Promise<{
    server: Map<number, ServerScript>;
    client: Map<number, Script>;
  }> {
    const server = new Map<number, ServerScript>();
    const client = new Map<number, Script>();
    const siteDir = this.siteManager.getSiteDir(siteId);
    const settingPath = path.join(siteDir, 'site-setting.json');

    try {
      const raw = await fs.readFile(settingPath, 'utf8');
      const json = JSON.parse(raw);
      const data = json?.Response?.Data ?? json;
      const siteSettings = data?.SiteSettings ?? {};

      for (const entry of siteSettings.ServerScripts ?? []) {
        const normalized = this.normalizeServerScript(entry);
        if (normalized.Id !== undefined) {
          server.set(normalized.Id, normalized);
        }
      }

      for (const entry of siteSettings.Scripts ?? []) {
        const normalized = this.normalizeClientScript(entry);
        if (normalized.Id !== undefined) {
          client.set(normalized.Id, normalized);
        }
      }
    } catch {
      // ignore missing or malformed site-setting.json
    }

    return { server, client };
  }

  private async collectLocalServerScripts(
    siteId: number,
    existingMap?: Map<number, ServerScript>
  ): Promise<LocalServerScript[]> {
    const dir = this.siteManager.getServerScriptDir(siteId);
    const entries = await safeReadDir(dir);
    const scripts: LocalServerScript[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.js')) {
        continue;
      }

      const filePath = path.join(dir, entry.name);
      const parsed = await this.parseServerScript(filePath, existingMap);
      scripts.push(parsed);
    }

    return scripts;
  }

  private async collectLocalClientScripts(
    siteId: number,
    existingMap?: Map<number, Script>
  ): Promise<LocalClientScript[]> {
    const dir = this.siteManager.getClientScriptDir(siteId);
    const entries = await safeReadDir(dir);
    const scripts: LocalClientScript[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.js')) {
        continue;
      }

      const filePath = path.join(dir, entry.name);
      const parsed = await this.parseClientScript(filePath, existingMap);
      scripts.push(parsed);
    }

    return scripts;
  }

  private async parseServerScript(
    filePath: string,
    existingMap?: Map<number, ServerScript>
  ): Promise<LocalServerScript> {
    const parsed = await MetadataParser.parseFile(filePath);
    const metadata = parsed.metadata ?? {};
    const body = parsed.body;
    const fileName = path.basename(filePath);
    const match = fileName.match(/^(\d+)_([^.]*)/);
    const inferredId = match ? Number(match[1]) : undefined;
    const inferredTitle = match ? match[2] : path.basename(filePath, path.extname(filePath));
    const existing = inferredId !== undefined ? existingMap?.get(inferredId) : undefined;

    const script: ServerScript = existing ? { ...existing } : {};
    script.Body = body;
    const metadataId = metadata.id !== undefined ? Number(metadata.id) : undefined;
    script.Id = toNumberOrUndefined(metadataId ?? inferredId ?? script.Id);

    const metaTitle = metadata.title as string | undefined;
    const metaName = metadata.name as string | undefined;
    script.Title = metaTitle ?? script.Title ?? inferredTitle;
    script.Name = metaName ?? script.Name ?? script.Title ?? inferredTitle;

    const serverFlagMap: Record<string, keyof ServerScript> = {
      'when-loading-site-settings': 'ServerScriptWhenloadingSiteSettings',
      'when-view-processing': 'ServerScriptWhenViewProcessing',
      'when-loading-record': 'ServerScriptWhenloadingRecord',
      'before-formula': 'ServerScriptBeforeFormula',
      'after-formula': 'ServerScriptAfterFormula',
      'before-create': 'ServerScriptBeforeCreate',
      'after-create': 'ServerScriptAfterCreate',
      'before-update': 'ServerScriptBeforeUpdate',
      'after-update': 'ServerScriptAfterUpdate',
      'before-delete': 'ServerScriptBeforeDelete',
      'after-delete': 'ServerScriptAfterDelete',
      'before-bulk-delete': 'ServerScriptBeforeBulkDelete',
      'after-bulk-delete': 'ServerScriptAfterBulkDelete',
      'before-opening-page': 'ServerScriptBeforeOpeningPage',
      'before-opening-row': 'ServerScriptBeforeOpeningRow',
      'shared': 'ServerScriptShared',
    };

    for (const [metaKey, apiKey] of Object.entries(serverFlagMap)) {
      if (metaKey in metadata) {
        (script as any)[apiKey] = Boolean(metadata[metaKey]);
      }
    }

    if ('functionalize' in metadata) {
      (script as any).Functionalize = Boolean(metadata.functionalize);
    }
    if ('try-catch' in metadata) {
      (script as any).TryCatch = Boolean(metadata['try-catch']);
    }

    const idForLocal = script.Id ?? toNumberOrUndefined(metadataId ?? inferredId);

    return {
      id: idForLocal ?? null,
      title: script.Title ?? inferredTitle ?? '(untitled)',
      filePath,
      script,
    };
  }

  private async parseClientScript(
    filePath: string,
    existingMap?: Map<number, Script>
  ): Promise<LocalClientScript> {
    const parsed = await MetadataParser.parseFile(filePath);
    const metadata = parsed.metadata ?? {};
    const body = parsed.body;
    const fileName = path.basename(filePath);
    const match = fileName.match(/^(\d+)_([^.]*)/);
    const inferredId = match ? Number(match[1]) : undefined;
    const inferredTitle = match ? match[2] : path.basename(filePath, path.extname(filePath));
    const existing = inferredId !== undefined ? existingMap?.get(inferredId) : undefined;

    const script: Script = existing ? { ...existing } : {};
    script.Body = body;
    const metadataId = metadata.id !== undefined ? Number(metadata.id) : undefined;
    script.Id = toNumberOrUndefined(metadataId ?? inferredId ?? script.Id);

    const metaTitle = metadata.title as string | undefined;
    script.Title = metaTitle ?? script.Title ?? inferredTitle;

    const flagMap: Record<string, keyof Script> = {
      'disabled': 'Disabled',
      'all': 'ScriptAll',
      'new': 'ScriptNew',
      'edit': 'ScriptEdit',
      'index': 'ScriptIndex',
    };
    for (const [metaKey, apiKey] of Object.entries(flagMap)) {
      if (metaKey in metadata) {
        (script as any)[apiKey] = Boolean(metadata[metaKey]);
      }
    }

    return {
      id: script.Id ?? toNumberOrUndefined(metadataId ?? inferredId) ?? null,
      title: script.Title ?? inferredTitle ?? '(untitled)',
      filePath,
      script,
    };
  }

  private filterByActive<T extends { id: number | null }>(
    scripts: T[],
    activeIds: number[]
  ): T[] {
    if (activeIds.length === 0) {
      return scripts;
    }
    const activeSet = new Set(activeIds);
    return scripts.filter(script => script.id !== null && activeSet.has(script.id));
  }

  private buildDiffEntries(
    remoteServers: ServerScript[],
    remoteClients: Script[],
    localServer: LocalServerScript[],
    localClient: LocalClientScript[]
  ): DiffEntry[] {
    const entries: DiffEntry[] = [];
    const map = new Map<string, DiffEntry>();

    for (const script of remoteServers) {
      const key = `server:${script.Id ?? script.Title}`;
      map.set(key, {
        type: 'server',
        id: toNumberOrNull(script.Id),
        title: script.Title ?? script.Name ?? '(server script)',
        remoteContent: composeServerScriptContent(script),
      });
    }

    for (const script of remoteClients) {
      const key = `client:${script.Id ?? script.Title}`;
      map.set(key, {
        type: 'client',
        id: toNumberOrNull(script.Id),
        title: script.Title ?? '(client script)',
        remoteContent: composeClientScriptContent(script),
      });
    }

    for (const script of localServer) {
      const key = `server:${script.id ?? script.title}`;
      const existing = map.get(key);
      if (existing) {
        existing.localPath = script.filePath;
        existing.title = script.title;
      } else {
        map.set(key, {
          type: 'server',
          id: script.id,
          title: script.title,
          localPath: script.filePath,
        });
      }
    }

    for (const script of localClient) {
      const key = `client:${script.id ?? script.title}`;
      const existing = map.get(key);
      if (existing) {
        existing.localPath = script.filePath;
        existing.title = script.title;
      } else {
        map.set(key, {
          type: 'client',
          id: script.id,
          title: script.title,
          localPath: script.filePath,
        });
      }
    }

    map.forEach(entry => entries.push(entry));
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'server' ? -1 : 1;
      }
      const aId = a.id ?? Number.MAX_SAFE_INTEGER;
      const bId = b.id ?? Number.MAX_SAFE_INTEGER;
      return aId - bId;
    });

    return entries;
  }

  private async openDiff(entry: DiffEntry): Promise<void> {
    const leftUri = entry.localPath
      ? vscode.Uri.file(entry.localPath)
      : vscode.Uri.parse(`untitled:Owlanter/${entry.type}-${entry.id ?? 'new'}-local.js`);

    let rightDocumentUri: vscode.Uri;
    if (entry.remoteContent !== undefined) {
      const doc = await vscode.workspace.openTextDocument({
        content: entry.remoteContent,
        language: 'javascript',
      });
      rightDocumentUri = doc.uri;
    } else {
      const doc = await vscode.workspace.openTextDocument({
        content: '',
        language: 'javascript',
      });
      rightDocumentUri = doc.uri;
    }

    const title = `${entry.type.toUpperCase()} ${entry.id ?? '(new)'}: ${entry.title}`;
    await vscode.commands.executeCommand('vscode.diff', rightDocumentUri, leftUri, title);
  }
}

function toNumberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNumberOrUndefined(value: any): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toBool(source: any, keys: string[]): boolean {
  for (const key of keys) {
    if (source && key in source) {
      const value = source[key];
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
      }
      return Boolean(value);
    }
  }
  return false;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'script';
}

async function safeReadDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function composeServerScriptContent(script: ServerScript): string {
  const metadataLines = [
    `// @pleasanter-id: ${script.Id ?? ''}`,
    `// @pleasanter-title: ${script.Title ?? ''}`,
    `// @pleasanter-name: ${script.Name ?? ''}`,
  ];

  const mapping: Array<[string, boolean | undefined]> = [
    ['when-loading-site-settings', script.ServerScriptWhenloadingSiteSettings],
    ['when-view-processing', script.ServerScriptWhenViewProcessing],
    ['when-loading-record', script.ServerScriptWhenloadingRecord],
    ['before-formula', script.ServerScriptBeforeFormula],
    ['after-formula', script.ServerScriptAfterFormula],
    ['before-create', script.ServerScriptBeforeCreate],
    ['after-create', script.ServerScriptAfterCreate],
    ['before-update', script.ServerScriptBeforeUpdate],
    ['after-update', script.ServerScriptAfterUpdate],
    ['before-delete', script.ServerScriptBeforeDelete],
    ['after-delete', script.ServerScriptAfterDelete],
    ['before-bulk-delete', script.ServerScriptBeforeBulkDelete],
    ['after-bulk-delete', script.ServerScriptAfterBulkDelete],
    ['before-opening-page', script.ServerScriptBeforeOpeningPage],
    ['before-opening-row', script.ServerScriptBeforeOpeningRow],
    ['shared', script.ServerScriptShared],
  ];

  for (const [key, value] of mapping) {
    if (value) {
      metadataLines.push(`// @pleasanter-${key}: true`);
    }
  }

  return `${metadataLines.join('\n')}\n\n${script.Body ?? ''}`;
}

function composeClientScriptContent(script: Script): string {
  const metadataLines = [
    `// @pleasanter-id: ${script.Id ?? ''}`,
    `// @pleasanter-title: ${script.Title ?? ''}`,
    `// @pleasanter-all: ${script.ScriptAll ?? false}`,
    `// @pleasanter-new: ${script.ScriptNew ?? false}`,
    `// @pleasanter-edit: ${script.ScriptEdit ?? false}`,
    `// @pleasanter-index: ${script.ScriptIndex ?? false}`,
    `// @pleasanter-disabled: ${script.Disabled ?? false}`,
  ];

  return `${metadataLines.join('\n')}\n\n${script.Body ?? ''}`;
}
