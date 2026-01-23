/**
 * Unit tests for AuthService.
 * Tests authentication state management, session persistence, and heartbeat.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing auth-service
vi.mock('@/types/config', () => ({
  CONFIG: {
    API_URL: 'https://test.example.com',
    REVERB_HOST: 'localhost',
    REVERB_PORT: 8085,
    REVERB_APP_KEY: 'test-key',
  },
}));

// Mock apiClient
const mockApiClient = {
  setToken: vi.fn(),
  getToken: vi.fn(),
  login: vi.fn(),
  getUser: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  heartbeat: vi.fn(),
};

vi.mock('@/background/api-client', () => ({
  apiClient: mockApiClient,
}));

// Mock reverbClient
const mockReverbClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('@/background/reverb-client', () => ({
  reverbClient: mockReverbClient,
}));

// Mock activity-log
vi.mock('@/background/activity-log', () => ({
  logActivity: vi.fn(),
}));

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {};
        keys.forEach(key => {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key];
          }
        });
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
      remove: vi.fn(async (keys: string[]) => {
        keys.forEach(key => delete mockStorage[key]);
      }),
    },
  },
  runtime: {
    getManifest: () => ({ version: '1.0.0' }),
  },
});

// Import after mocks
// Note: We need to create a fresh instance for each test since authService is a singleton
// We'll test the class behavior through the exported singleton

describe('AuthService', () => {
  beforeEach(() => {
    // Clear mocks and storage
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);

    // Reset default mock implementations
    mockApiClient.login.mockReset();
    mockApiClient.getUser.mockReset();
    mockApiClient.connect.mockReset();
    mockApiClient.disconnect.mockReset();
    mockApiClient.heartbeat.mockReset();
    mockReverbClient.connect.mockReset();
    mockReverbClient.disconnect.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('restores session from storage when token exists and is valid', async () => {
      // Pre-populate storage
      mockStorage['auth_token'] = 'stored-token';
      mockStorage['auth_user'] = { id: 1, name: 'Test', email: 'test@example.com' };
      mockStorage['session_id'] = 'stored-session';

      // Mock successful user verification
      mockApiClient.getUser.mockResolvedValueOnce({
        success: true,
        data: { id: 1, name: 'Test', email: 'test@example.com' },
      });

      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      // Import fresh module to test initialization
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.initialize();

      expect(mockApiClient.setToken).toHaveBeenCalledWith('stored-token');
      expect(mockApiClient.getUser).toHaveBeenCalled();
      expect(mockApiClient.connect).toHaveBeenCalled();
    });

    it('clears session when stored token is invalid', async () => {
      mockStorage['auth_token'] = 'invalid-token';
      mockStorage['auth_user'] = { id: 1, name: 'Test', email: 'test@example.com' };

      mockApiClient.getUser.mockResolvedValueOnce({
        success: false,
        error: 'Unauthenticated',
      });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.initialize();

      // Should clear storage
      expect(chrome.storage.local.remove).toHaveBeenCalled();
      expect(mockApiClient.setToken).toHaveBeenCalledWith(null);
    });

    it('does nothing when no token in storage', async () => {
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.initialize();

      expect(mockApiClient.getUser).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('stores token and user on successful login', async () => {
      const mockUser = { id: 1, name: 'Test User', email: 'test@example.com' };
      const mockToken = 'new-token';

      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: mockToken,
        user: mockUser,
      });

      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      const result = await authService.login('test@example.com', 'password');

      expect(result.success).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_token: mockToken,
          auth_user: mockUser,
        })
      );
    });

    it('connects to server after successful login', async () => {
      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: { id: 1, name: 'Test', email: 'test@example.com' },
      });

      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.login('test@example.com', 'password');

      expect(mockApiClient.connect).toHaveBeenCalled();
      expect(mockReverbClient.connect).toHaveBeenCalledWith(1); // user.id
    });

    it('returns error on failed login', async () => {
      mockApiClient.login.mockResolvedValueOnce({
        success: false,
        error: 'Invalid credentials',
      });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      const result = await authService.login('test@example.com', 'wrong');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('disconnects and clears session', async () => {
      mockApiClient.disconnect.mockResolvedValueOnce({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      // Set up authenticated state first
      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: { id: 1, name: 'Test', email: 'test@example.com' },
      });
      mockApiClient.connect.mockResolvedValueOnce({ success: true });
      await authService.login('test@example.com', 'password');

      vi.clearAllMocks();

      await authService.logout();

      expect(mockReverbClient.disconnect).toHaveBeenCalled();
      expect(mockApiClient.setToken).toHaveBeenCalledWith(null);
      expect(chrome.storage.local.remove).toHaveBeenCalledWith([
        'auth_token',
        'auth_user',
        'session_id',
      ]);
    });
  });

  describe('getState', () => {
    it('returns unauthenticated state when not logged in', async () => {
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      const state = authService.getState();

      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.isConnected).toBe(false);
    });

    it('returns authenticated state after login', async () => {
      const mockUser = { id: 1, name: 'Test', email: 'test@example.com' };

      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: mockUser,
      });
      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.login('test@example.com', 'password');

      const state = authService.getState();

      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockUser);
      expect(state.isConnected).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('notifies listeners on state change', async () => {
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      const listener = vi.fn();
      authService.subscribe(listener);

      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: { id: 1, name: 'Test', email: 'test@example.com' },
      });
      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      await authService.login('test@example.com', 'password');

      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0];
      expect(lastCall.isAuthenticated).toBe(true);
    });

    it('returns unsubscribe function', async () => {
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      const listener = vi.fn();
      const unsubscribe = authService.subscribe(listener);

      unsubscribe();

      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: { id: 1, name: 'Test', email: 'test@example.com' },
      });
      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      await authService.login('test@example.com', 'password');

      // Listener should not be called after unsubscribe
      // Note: It may have been called during login, but we check it wasn't called
      // after the login state change
      const callCount = listener.mock.calls.length;

      // Trigger another state change
      await authService.logout();

      // Should not have additional calls after unsubscribe
      expect(listener.mock.calls.length).toBe(callCount);
    });
  });

  describe('isAuthenticated', () => {
    it('returns false when not logged in', async () => {
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      expect(authService.isAuthenticated()).toBe(false);
    });

    it('returns true when logged in', async () => {
      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: { id: 1, name: 'Test', email: 'test@example.com' },
      });
      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.login('test@example.com', 'password');

      expect(authService.isAuthenticated()).toBe(true);
    });
  });

  describe('getUser', () => {
    it('returns null when not logged in', async () => {
      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      expect(authService.getUser()).toBeNull();
    });

    it('returns user when logged in', async () => {
      const mockUser = { id: 1, name: 'Test', email: 'test@example.com' };

      mockApiClient.login.mockResolvedValueOnce({
        success: true,
        token: 'token',
        user: mockUser,
      });
      mockApiClient.connect.mockResolvedValueOnce({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.login('test@example.com', 'password');

      expect(authService.getUser()).toEqual(mockUser);
    });
  });

  describe('session ID generation', () => {
    it('generates unique session IDs', async () => {
      mockApiClient.login.mockResolvedValue({
        success: true,
        token: 'token',
        user: { id: 1, name: 'Test', email: 'test@example.com' },
      });
      mockApiClient.connect.mockResolvedValue({ success: true });

      vi.resetModules();
      const { authService } = await import('@/background/auth-service');

      await authService.login('test@example.com', 'password');

      const sessionId1 = authService.getSessionId();

      // Logout and login again
      await authService.logout();
      await authService.login('test@example.com', 'password');

      const sessionId2 = authService.getSessionId();

      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(/^ext_\d+_[a-z0-9]+$/);
      expect(sessionId2).toMatch(/^ext_\d+_[a-z0-9]+$/);
    });
  });
});
