/**
 * API client for Laravel backend communication.
 * Handles authentication and extension API endpoints.
 */

import { CONFIG } from '../types/config';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
}

export interface ConnectionStatus {
  online: boolean;
  connected_at?: string;
  last_seen?: string;
  session_id?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  /** HTTP status code for error handling */
  status?: number;
  /** Whether error is recoverable (can retry) */
  isRecoverable?: boolean;
}

/**
 * API client class for communicating with Laravel backend.
 */
export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = CONFIG.API_URL;
  }

  /**
   * Set the authentication token.
   */
  setToken(token: string | null): void {
    this.token = token;
  }

  /**
   * Get the current token.
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Make an API request.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Try to parse JSON response
      let data: Record<string, unknown> = {};
      try {
        data = await response.json();
      } catch {
        // Response might not be JSON
      }

      if (!response.ok) {
        const errorMessage = (data.message as string) ||
                            (data.error as string) ||
                            `HTTP ${response.status}`;

        // Categorize error for offline handling
        const isRecoverable = this.isRecoverableStatus(response.status);

        return {
          success: false,
          error: errorMessage,
          status: response.status,
          isRecoverable,
        };
      }

      return {
        success: true,
        data: data as T,
        status: response.status,
      };
    } catch (error) {
      // Network errors (fetch failed)
      const isNetworkError = error instanceof TypeError ||
                            (error instanceof Error && error.message.includes('fetch'));

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
        status: 0, // 0 indicates network error
        isRecoverable: isNetworkError, // Network errors are recoverable
      };
    }
  }

  /**
   * Check if HTTP status indicates a recoverable error.
   */
  private isRecoverableStatus(status: number): boolean {
    // 5xx errors: server issues, usually recoverable
    if (status >= 500) return true;
    // 429: rate limited, recoverable after waiting
    if (status === 429) return true;
    // 408: request timeout, recoverable
    if (status === 408) return true;
    // 401/403: auth issues, NOT recoverable without user action
    if (status === 401 || status === 403) return false;
    // 4xx: client errors, usually not recoverable
    return false;
  }

  /**
   * Login with email and password.
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const result = await this.request<{ token: string; user: AuthUser }>(
      '/api/v1/extension/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );

    if (result.success && result.data) {
      // Server wraps response in { data: {...} } envelope
      const responseData = (result.data as unknown as { data: { token: string; user: AuthUser } }).data;
      this.token = responseData.token;
      return {
        success: true,
        token: responseData.token,
        user: responseData.user,
      };
    }

    return {
      success: false,
      error: result.error || 'Login failed',
    };
  }

  /**
   * Get the authenticated user's info.
   */
  async getUser(): Promise<ApiResponse<AuthUser>> {
    // Server returns: { data: { user: {...}, connection: {...} } }
    const result = await this.request<{ data: { user: AuthUser } }>('/api/v1/extension/user');
    if (result.success && result.data?.data?.user) {
      return {
        ...result,
        data: result.data.data.user,  // Unwrap to get the user object
      };
    }
    return result as unknown as ApiResponse<AuthUser>;
  }

  /**
   * Mark extension as connected.
   */
  async connect(sessionId: string): Promise<ApiResponse<ConnectionStatus>> {
    return this.request<ConnectionStatus>('/api/v1/extension/connect', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        metadata: {
          browser: 'Chrome',
          extension_version: chrome.runtime.getManifest().version,
        },
      }),
    });
  }

  /**
   * Mark extension as disconnected.
   */
  async disconnect(): Promise<ApiResponse<void>> {
    return this.request<void>('/api/v1/extension/disconnect', {
      method: 'POST',
    });
  }

  /**
   * Send heartbeat to keep connection alive.
   */
  async heartbeat(sessionId: string): Promise<ApiResponse<ConnectionStatus>> {
    return this.request<ConnectionStatus>('/api/v1/extension/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
  }

  /**
   * Get current connection status.
   */
  async getStatus(): Promise<ApiResponse<ConnectionStatus>> {
    return this.request<ConnectionStatus>('/api/v1/extension/status');
  }

  /**
   * Send command response back to server.
   */
  async sendCommandResponse(
    commandId: string,
    success: boolean,
    result: unknown = {},
    error?: string
  ): Promise<ApiResponse<void>> {
    return this.request<void>('/api/v1/extension/response', {
      method: 'POST',
      body: JSON.stringify({
        command_id: commandId,
        success,
        result,
        error,
      }),
    });
  }
}

// Singleton instance
export const apiClient = new ApiClient();
