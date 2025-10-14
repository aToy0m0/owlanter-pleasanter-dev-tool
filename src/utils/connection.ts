import * as vscode from 'vscode';
import { SiteManager } from '../core/site-manager';
import { OwlanterApiClient } from '../api/client';

export interface ConnectionInfo {
  domain: string;
  apiKey: string;
}

export async function resolveConnectionInfo(siteManager: SiteManager): Promise<ConnectionInfo> {
  let domain = '';
  let apiKey = '';

  try {
    const config = await siteManager.getConfig();
    domain = (config['owlanter-domain'] ?? config['pleasanter-domain'] ?? '').trim();
    apiKey = (config['owlanter-api'] ?? config['pleasanter-api'] ?? '').trim();
  } catch {
    // config.json が未作成の場合は VS Code 設定から補完する
  }

  const settings = vscode.workspace.getConfiguration('owlanter');
  if (!domain) {
    domain = (settings.get<string>('domain') ?? '').trim();
  }
  if (!apiKey) {
    apiKey = (settings.get<string>('apiKey') ?? '').trim();
  }

  if (!domain || !apiKey) {
    throw new Error('Owlanter connection information is incomplete. Use the settings sync command to provide domain and API key.');
  }

  return {
    domain: normalizeDomain(domain),
    apiKey,
  };
}

export async function createApiClient(siteManager: SiteManager): Promise<OwlanterApiClient> {
  const { domain, apiKey } = await resolveConnectionInfo(siteManager);
  return new OwlanterApiClient(domain, apiKey);
}

export function normalizeDomain(domain: string): string {
  return domain.endsWith('/') ? domain : `${domain}/`;
}
