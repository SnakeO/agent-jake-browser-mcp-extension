/**
 * Unit tests for ApiClient.
 * Tests API communication with Laravel backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock CONFIG before importing api-client
vi.mock('@/types/config', () => ({
  CONFIG: {
    API_URL: 'https://test.example.com',
    REVERB_HOST: 'localhost',
    REVERB_PORT: 8085,
    REVERB_APP_KEY: 'test-key',
  },
}));

// Mock chrome.runtime for extension version
vi.stubGlobal('chrome', {
  runtime: {
    getManifest: () => ({ version: '1.0.0' }),
  },
});

// Import after mocks are set up
import { ApiClient } from '@/background/api-client';

describe('ApiClient', () => {
  let apiClient: ApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiClient = new ApiClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setToken / getToken', () => {
    it('stores and retrieves token', () => {
      expect(apiClient.getToken()).toBeNull();

      apiClient.setToken('test-token-123');

      expect(apiClient.getToken()).toBe('test-token-123');
    });

    it('clears token when set to null', () => {
      apiClient.setToken('test-token');
      apiClient.setToken(null);

      expect(apiClient.getToken()).toBeNull();
    });
  });

  describe('login', () => {
    it('returns success with token and user on successful login', async () => {
      const mockUser = { id: 1, name: 'Test User', email: 'test@example.com' };
      const mockToken = 'sanctum-token-xyz';

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken, user: mockUser }),
      });

      const result = await apiClient.login('test@example.com', 'password123');

      expect(result.success).toBe(true);
      expect(result.token).toBe(mockToken);
      expect(result.user).toEqual(mockUser);
      expect(apiClient.getToken()).toBe(mockToken);

      // Verify request
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/extension/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
        })
      );
    });

    it('returns error on failed login', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Invalid credentials' }),
      });

      const result = await apiClient.login('test@example.com', 'wrongpassword');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
      expect(apiClient.getToken()).toBeNull();
    });

    it('returns error on network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await apiClient.login('test@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('getUser', () => {
    it('returns user data when authenticated', async () => {
      const mockUser = { id: 1, name: 'Test User', email: 'test@example.com' };
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const result = await apiClient.getUser();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUser);

      // Verify Authorization header
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/extension/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token',
          }),
        })
      );
    });

    it('returns error when not authenticated', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Unauthenticated' }),
      });

      const result = await apiClient.getUser();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthenticated');
    });
  });

  describe('connect', () => {
    it('sends connect request with session ID and metadata', async () => {
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ online: true, connected_at: '2024-01-01T00:00:00Z' }),
      });

      const result = await apiClient.connect('session-123');

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/extension/connect',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('session-123'),
        })
      );

      // Verify metadata includes browser and version
      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.metadata.browser).toBe('Chrome');
      expect(callBody.metadata.extension_version).toBe('1.0.0');
    });
  });

  describe('disconnect', () => {
    it('sends disconnect request', async () => {
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await apiClient.disconnect();

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/extension/disconnect',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('heartbeat', () => {
    it('sends heartbeat with session ID', async () => {
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ online: true, last_seen: '2024-01-01T00:00:00Z' }),
      });

      const result = await apiClient.heartbeat('session-456');

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/extension/heartbeat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ session_id: 'session-456' }),
        })
      );
    });
  });

  describe('getStatus', () => {
    it('returns connection status', async () => {
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          online: true,
          connected_at: '2024-01-01T00:00:00Z',
          session_id: 'session-789',
        }),
      });

      const result = await apiClient.getStatus();

      expect(result.success).toBe(true);
      expect(result.data?.online).toBe(true);
    });
  });

  describe('sendCommandResponse', () => {
    it('sends successful command response', async () => {
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await apiClient.sendCommandResponse(
        'cmd-123',
        true,
        { clicked: true },
        undefined
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/extension/response',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            command_id: 'cmd-123',
            success: true,
            result: { clicked: true },
            error: undefined,
          }),
        })
      );
    });

    it('sends failed command response with error', async () => {
      apiClient.setToken('valid-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await apiClient.sendCommandResponse(
        'cmd-456',
        false,
        {},
        'Element not found'
      );

      expect(result.success).toBe(true);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.success).toBe(false);
      expect(callBody.error).toBe('Element not found');
    });
  });

  describe('request headers', () => {
    it('includes Content-Type and Accept headers', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.getStatus();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
    });

    it('includes Authorization header when token is set', async () => {
      apiClient.setToken('my-token');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.getStatus();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
          }),
        })
      );
    });

    it('does not include Authorization header when no token', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.getStatus();

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });
});
