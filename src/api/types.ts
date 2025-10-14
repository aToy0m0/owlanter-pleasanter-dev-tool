/**
 * Pleasanter API Type Definitions
 */

export interface ApiResponse {
  Id: number;
  StatusCode: number;
  Message: string;
}

export interface SiteSettings {
  Id: number;
  Title: string;
  Body: string;
  ReferenceType: string;
  Scripts?: Script[];
  ServerScripts?: ServerScript[];
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
}

export interface SitesConfig {
  sites: SiteInfo[];
  'current-site': number;
  'default-site': number;
}

export interface Config {
  'pleasanter-domain': string;
  'pleasanter-api': string;
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
