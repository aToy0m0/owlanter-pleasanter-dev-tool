/**
 * Owlanter API Type Definitions
 */

export interface ApiResponse {
  Id: number;
  StatusCode: number;
  Message: string;
}

export interface Script {
  Id?: number;
  Title?: string;
  Body?: string;
  Disabled?: boolean;
  ScriptAll?: boolean;
  ScriptNew?: boolean;
  ScriptEdit?: boolean;
  ScriptIndex?: boolean;
  Delete?: number;
}

export interface ServerScript {
  Id?: number;
  Title?: string;
  Name?: string;
  Body?: string;
  ServerScriptWhenloadingSiteSettings?: boolean;
  ServerScriptWhenViewProcessing?: boolean;
  ServerScriptWhenloadingRecord?: boolean;
  ServerScriptBeforeFormula?: boolean;
  ServerScriptAfterFormula?: boolean;
  ServerScriptBeforeCreate?: boolean;
  ServerScriptAfterCreate?: boolean;
  ServerScriptBeforeUpdate?: boolean;
  ServerScriptAfterUpdate?: boolean;
  ServerScriptBeforeDelete?: boolean;
  ServerScriptAfterDelete?: boolean;
  ServerScriptBeforeBulkDelete?: boolean;
  ServerScriptAfterBulkDelete?: boolean;
  ServerScriptBeforeOpeningPage?: boolean;
  ServerScriptBeforeOpeningRow?: boolean;
  ServerScriptShared?: boolean;
  Functionalize?: boolean;
  TryCatch?: boolean;
  Delete?: number;
}

export interface SiteInfo {
  'site-id': number;
  'site-name': string;
  description: string;
  environment: 'production' | 'staging' | 'development';
  'last-sync': string;
  active: boolean;
  color: string;
  'folder-name'?: string;
}

export interface SitesConfig {
  sites: SiteInfo[];
  'current-site': number;
  'default-site': number;
}

export interface Config {
  'owlanter-domain'?: string;
  'owlanter-api'?: string;
  'pleasanter-domain'?: string;
  'pleasanter-api'?: string;
  settings: {
    'auto-backup': boolean;
    'backup-count': number;
    'confirmation-required': {
      production: boolean;
      staging: boolean;
      development: boolean;
    };
    'default-delay': number;
    'max-retries': number;
  };
}

export interface CommandOptions {
  siteId?: number;
  env?: string;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
}

export interface ApiResponseEnvelope<T> {
  StatusCode: number;
  Response?: {
    Data?: T;
  };
  Messages?: unknown;
}

export interface SiteData {
  SiteId: number;
  Title: string;
  Body?: string;
  SiteName?: string;
  SiteGroupName?: string;
  ReferenceType?: string;
  SiteSettings?: {
    Version?: number;
    ReferenceType?: string;
    Description?: string;
    Scripts?: Script[];
    ServerScripts?: Array<ServerScript & {
      BeforeUpdate?: boolean;
      AfterUpdate?: boolean;
      BeforeCreate?: boolean;
      AfterCreate?: boolean;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SiteInfoFile {
  'site-id': number;
  'site-name': string;
  title: string;
  'reference-type': string;
  'tenant-id': number;
  environment: 'production' | 'staging' | 'development';
  'created-at': string;
  'last-pulled': string;
  'last-pushed': string;
  version: number;
  'scripts-count': {
    'server-scripts': number;
    'client-scripts': number;
  };
  'active-scripts': {
    server: number[];
    client: number[];
  };
  'folder-name'?: string;
  [key: string]: unknown;
}
