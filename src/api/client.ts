import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponseEnvelope, SiteData, Script, ServerScript, ApiResponse } from './types';

/**
 * Owlanter API Client
 * Handles all communication with Owlanter server
 */
export class OwlanterApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Get site settings from Owlanter
   */
  async getSiteSettings(siteId: number): Promise<SiteData> {
    try {
      const response: AxiosResponse<ApiResponseEnvelope<SiteData>> = await this.client.post(
        `/api/items/${siteId}/getsite`,
        {
          ApiVersion: '1.1',
          ApiKey: this.apiKey,
        }
      );

      const data = response.data?.Response?.Data;
      if (!data) {
        throw new Error('Owlanter API did not return site data');
      }
      return data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get site settings');
    }
  }

  /**
   * Update site settings (Scripts and/or ServerScripts)
   */
  async updateSiteSettings(
    siteId: number,
    payload: {
      Scripts?: Script[];
      ServerScripts?: ServerScript[];
    }
  ): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await this.client.post(
        `/api/items/${siteId}/updatesitesettings`,
        ensureApiPayload(this.apiKey, payload)
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to update site settings');
    }
  }

  /**
   * Add or update a client script
   */
  async addScript(siteId: number, script: Script): Promise<ApiResponse> {
    return this.updateSiteSettings(siteId, {
      Scripts: [script],
    });
  }

  /**
   * Add or update a server script
   */
  async addServerScript(siteId: number, script: ServerScript): Promise<ApiResponse> {
    return this.updateSiteSettings(siteId, {
      ServerScripts: [script],
    });
  }

  /**
   * Delete a client script by ID
   */
  async deleteScript(siteId: number, scriptId: number): Promise<ApiResponse> {
    return this.updateSiteSettings(siteId, {
      Scripts: [{ Id: scriptId, Delete: 1 }],
    });
  }

  /**
   * Delete a server script by ID
   */
  async deleteServerScript(siteId: number, scriptId: number): Promise<ApiResponse> {
    return this.updateSiteSettings(siteId, {
      ServerScripts: [{ Id: scriptId, Delete: 1 }],
    });
  }

  /**
   * Batch update multiple scripts
   */
  async batchUpdateScripts(
    siteId: number,
    scripts: Script[],
    serverScripts: ServerScript[]
  ): Promise<ApiResponse> {
    return this.updateSiteSettings(siteId, {
      Scripts: scripts.length > 0 ? scripts : undefined,
      ServerScripts: serverScripts.length > 0 ? serverScripts : undefined,
    });
  }

  /**
   * Test connection to Owlanter server
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/version', {
        params: {
          ApiKey: this.apiKey,
        },
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle API errors
   */
  private handleError(error: any, defaultMessage: string): Error {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Server responded with error
        const status = error.response.status;
        const data = error.response.data as ApiResponse;

        if (status === 403) {
          return new Error('API key is invalid or insufficient permissions');
        } else if (status === 404) {
          return new Error('Site not found');
        } else if (data?.Message) {
          return new Error(`Owlanter API error: ${data.Message}`);
        }
      } else if (error.request) {
        // Request was made but no response
        return new Error('Cannot connect to Owlanter server. Check your network connection.');
      }
    }
    return new Error(`${defaultMessage}: ${error?.message ?? 'Unknown error'}`);
  }
}

function ensureApiPayload<T extends Record<string, unknown>>(apiKey: string, payload: T): T & {
  ApiVersion: string;
  ApiKey: string;
} {
  return {
    ApiVersion: '1.1',
    ApiKey: apiKey,
    ...payload,
  };
}
