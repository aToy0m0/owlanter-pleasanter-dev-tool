import * as fs from 'fs/promises';
import { Script, ServerScript } from '../api/types';

/**
 * Metadata Parser
 * Parses @pleasanter-* comments from JavaScript files
 */
export class MetadataParser {
  /**
   * Parse JavaScript file and extract metadata and body
   */
  static async parseFile(filePath: string): Promise<{ metadata: any; body: string }> {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');

    const metadata: any = {};
    const bodyLines: string[] = [];
    let inMetadata = true;

    for (const line of lines) {
      const trimmed = line.trim();

      if (inMetadata && trimmed.startsWith('// @pleasanter-')) {
        const match = trimmed.match(/\/\/ @pleasanter-([^:]+):\s*(.+)/);
        if (match) {
          const key = match[1];
          const value = match[2].trim();
          metadata[key] = this.parseValue(value);
        }
      } else if (trimmed === '' && inMetadata) {
        // Empty line, still in metadata region
        continue;
      } else {
        // First non-metadata line
        inMetadata = false;
        bodyLines.push(line);
      }
    }

    return {
      metadata,
      body: bodyLines.join('\n').trim(),
    };
  }

  /**
   * Convert metadata to ServerScript object
   */
  static toServerScript(metadata: any, body: string): ServerScript {
    return {
      Id: metadata.id,
      Title: metadata.title,
      Name: metadata.name,
      Body: body,
      ServerScriptWhenloadingSiteSettings: metadata['when-loading-site-settings'] ?? false,
      ServerScriptWhenViewProcessing: metadata['when-view-processing'] ?? false,
      ServerScriptWhenloadingRecord: metadata['when-loading-record'] ?? false,
      ServerScriptBeforeFormula: metadata['before-formula'] ?? false,
      ServerScriptAfterFormula: metadata['after-formula'] ?? false,
      ServerScriptBeforeCreate: metadata['before-create'] ?? false,
      ServerScriptAfterCreate: metadata['after-create'] ?? false,
      ServerScriptBeforeUpdate: metadata['before-update'] ?? false,
      ServerScriptAfterUpdate: metadata['after-update'] ?? false,
      ServerScriptBeforeDelete: metadata['before-delete'] ?? false,
      ServerScriptAfterDelete: metadata['after-delete'] ?? false,
      ServerScriptBeforeBulkDelete: metadata['before-bulk-delete'] ?? false,
      ServerScriptAfterBulkDelete: metadata['after-bulk-delete'] ?? false,
      ServerScriptBeforeOpeningPage: metadata['before-opening-page'] ?? false,
      ServerScriptBeforeOpeningRow: metadata['before-opening-row'] ?? false,
      ServerScriptShared: metadata['shared'] ?? false,
    };
  }

  /**
   * Convert metadata to Script (client script) object
   */
  static toScript(metadata: any, body: string): Script {
    return {
      Id: metadata.id,
      Title: metadata.title,
      Body: body,
      Disabled: metadata.disabled ?? false,
      ScriptAll: metadata.all ?? false,
      ScriptNew: metadata.new ?? false,
      ScriptEdit: metadata.edit ?? false,
      ScriptIndex: metadata.index ?? false,
    };
  }

  /**
   * Parse value from string to appropriate type
   */
  private static parseValue(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(Number(value))) return Number(value);
    return value;
  }

  /**
   * Generate metadata comments from ServerScript
   */
  static generateServerScriptMetadata(script: ServerScript): string {
    const lines = [
      `// @pleasanter-id: ${script.Id}`,
      `// @pleasanter-title: ${script.Title}`,
      `// @pleasanter-name: ${script.Name}`,
    ];

    const hooks: Record<string, boolean | undefined> = {
      'when-loading-site-settings': script.ServerScriptWhenloadingSiteSettings,
      'when-view-processing': script.ServerScriptWhenViewProcessing,
      'when-loading-record': script.ServerScriptWhenloadingRecord,
      'before-formula': script.ServerScriptBeforeFormula,
      'after-formula': script.ServerScriptAfterFormula,
      'before-create': script.ServerScriptBeforeCreate,
      'after-create': script.ServerScriptAfterCreate,
      'before-update': script.ServerScriptBeforeUpdate,
      'after-update': script.ServerScriptAfterUpdate,
      'before-delete': script.ServerScriptBeforeDelete,
      'after-delete': script.ServerScriptAfterDelete,
      'before-bulk-delete': script.ServerScriptBeforeBulkDelete,
      'after-bulk-delete': script.ServerScriptAfterBulkDelete,
      'before-opening-page': script.ServerScriptBeforeOpeningPage,
      'before-opening-row': script.ServerScriptBeforeOpeningRow,
      'shared': script.ServerScriptShared,
    };

    for (const [key, value] of Object.entries(hooks)) {
      if (value) {
        lines.push(`// @pleasanter-${key}: true`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate metadata comments from Script (client script)
   */
  static generateScriptMetadata(script: Script): string {
    return [
      `// @pleasanter-id: ${script.Id}`,
      `// @pleasanter-title: ${script.Title}`,
      `// @pleasanter-all: ${script.ScriptAll}`,
      `// @pleasanter-new: ${script.ScriptNew}`,
      `// @pleasanter-edit: ${script.ScriptEdit}`,
      `// @pleasanter-index: ${script.ScriptIndex}`,
      `// @pleasanter-disabled: ${script.Disabled}`,
    ].join('\n');
  }

  /**
   * Write Script to JavaScript file with metadata
   */
  static async writeServerScriptFile(filePath: string, script: ServerScript): Promise<void> {
    const metadata = this.generateServerScriptMetadata(script);
    const content = `${metadata}\n\n${script.Body}`;
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Write client Script to JavaScript file with metadata
   */
  static async writeScriptFile(filePath: string, script: Script): Promise<void> {
    const metadata = this.generateScriptMetadata(script);
    const content = `${metadata}\n\n${script.Body}`;
    await fs.writeFile(filePath, content, 'utf8');
  }
}
