/**
 * Unit tests for ReverbClient.
 * Tests Laravel Echo WebSocket connection and command handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock CONFIG
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
  getToken: vi.fn(() => 'mock-token'),
  sendCommandResponse: vi.fn(),
};

vi.mock('@/background/api-client', () => ({
  apiClient: mockApiClient,
}));

// Mock activity-log
vi.mock('@/background/activity-log', () => ({
  logActivity: vi.fn(),
}));

// Mock Echo channel
const mockChannel = {
  subscribed: vi.fn(),
  listen: vi.fn(),
  error: vi.fn(),
};

// Mock Echo instance
const mockEcho = {
  private: vi.fn(() => mockChannel),
  leave: vi.fn(),
  disconnect: vi.fn(),
  connector: {
    pusher: {
      connection: {
        bind: vi.fn(),
      },
    },
  },
};

// Mock Echo constructor
vi.mock('laravel-echo', () => ({
  default: vi.fn(() => mockEcho),
}));

// Mock Pusher with Runtime for service worker compatibility patching
const mockPusher = vi.fn();
(mockPusher as Record<string, unknown>).Runtime = {
  getProtocol: vi.fn(() => 'ws:'),
  getLocalStorage: vi.fn(() => undefined),
};

vi.mock('pusher-js', () => ({
  default: mockPusher,
}));

describe('ReverbClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.getToken.mockReturnValue('mock-token');
    mockApiClient.sendCommandResponse.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setCommandHandler', () => {
    it('stores the command handler', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const handler = vi.fn();
      reverbClient.setCommandHandler(handler);

      // Handler is stored internally - we'll test it's called in handleCommand tests
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('creates Echo instance with correct configuration', async () => {
      vi.resetModules();
      const Echo = (await import('laravel-echo')).default;
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);

      expect(Echo).toHaveBeenCalledWith(
        expect.objectContaining({
          broadcaster: 'pusher',
          key: 'test-key',
          wsHost: 'localhost',
          wsPort: 8085,
          authEndpoint: 'https://test.example.com/broadcasting/auth',
          auth: expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer mock-token',
            }),
          }),
        })
      );
    });

    it('subscribes to private channel for user', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(456);

      expect(mockEcho.private).toHaveBeenCalledWith('extension.456');
    });

    it('sets up event listeners on channel', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(789);

      expect(mockChannel.subscribed).toHaveBeenCalled();
      expect(mockChannel.listen).toHaveBeenCalledWith('.browser.command', expect.any(Function));
      expect(mockChannel.error).toHaveBeenCalled();
    });

    it('does not connect without token', async () => {
      mockApiClient.getToken.mockReturnValue(null);

      vi.resetModules();
      const Echo = (await import('laravel-echo')).default;
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);

      expect(Echo).not.toHaveBeenCalled();
    });

    it('disconnects existing connection before reconnecting', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);
      vi.clearAllMocks();

      await reverbClient.connect(456);

      expect(mockEcho.leave).toHaveBeenCalledWith('extension.123');
      expect(mockEcho.disconnect).toHaveBeenCalled();
    });

    it('reuses existing connection for same user', async () => {
      vi.resetModules();
      const Echo = (await import('laravel-echo')).default;
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);
      const firstCallCount = (Echo as ReturnType<typeof vi.fn>).mock.calls.length;

      await reverbClient.connect(123);

      // Should not create new Echo instance
      expect((Echo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('disconnect', () => {
    it('leaves channel and disconnects Echo', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);
      await reverbClient.disconnect();

      expect(mockEcho.leave).toHaveBeenCalledWith('extension.123');
      expect(mockEcho.disconnect).toHaveBeenCalled();
    });

    it('does nothing if not connected', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.disconnect();

      expect(mockEcho.leave).not.toHaveBeenCalled();
      expect(mockEcho.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('command handling', () => {
    it('executes command handler when command received', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const handler = vi.fn().mockResolvedValue({
        success: true,
        result: { clicked: true },
      });
      reverbClient.setCommandHandler(handler);

      await reverbClient.connect(123);

      // Get the listener callback
      const listenCallback = mockChannel.listen.mock.calls[0][1];

      // Simulate receiving a command
      await listenCallback({
        commandId: 'cmd-123',
        userId: 123,
        type: 'browser_click',
        payload: { ref: 's1e42' },
      });

      expect(handler).toHaveBeenCalledWith({
        commandId: 'cmd-123',
        userId: 123,
        type: 'browser_click',
        payload: { ref: 's1e42' },
      });
    });

    it('sends response back to server after command execution', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const handler = vi.fn().mockResolvedValue({
        success: true,
        result: { navigated: 'https://example.com' },
      });
      reverbClient.setCommandHandler(handler);

      await reverbClient.connect(123);

      const listenCallback = mockChannel.listen.mock.calls[0][1];
      await listenCallback({
        commandId: 'cmd-456',
        userId: 123,
        type: 'browser_navigate',
        payload: { url: 'https://example.com' },
      });

      expect(mockApiClient.sendCommandResponse).toHaveBeenCalledWith(
        'cmd-456',
        true,
        { navigated: 'https://example.com' },
        undefined
      );
    });

    it('sends error response when command fails', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const handler = vi.fn().mockResolvedValue({
        success: false,
        error: 'Element not found',
      });
      reverbClient.setCommandHandler(handler);

      await reverbClient.connect(123);

      const listenCallback = mockChannel.listen.mock.calls[0][1];
      await listenCallback({
        commandId: 'cmd-789',
        userId: 123,
        type: 'browser_click',
        payload: { ref: 's1e99' },
      });

      expect(mockApiClient.sendCommandResponse).toHaveBeenCalledWith(
        'cmd-789',
        false,
        {},
        'Element not found'
      );
    });

    it('handles exception in command handler', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const handler = vi.fn().mockRejectedValue(new Error('Unexpected error'));
      reverbClient.setCommandHandler(handler);

      await reverbClient.connect(123);

      const listenCallback = mockChannel.listen.mock.calls[0][1];
      await listenCallback({
        commandId: 'cmd-error',
        userId: 123,
        type: 'browser_click',
        payload: {},
      });

      expect(mockApiClient.sendCommandResponse).toHaveBeenCalledWith(
        'cmd-error',
        false,
        {},
        'Unexpected error'
      );
    });

    it('handles missing command handler', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      // Don't set command handler

      await reverbClient.connect(123);

      const listenCallback = mockChannel.listen.mock.calls[0][1];
      await listenCallback({
        commandId: 'cmd-no-handler',
        userId: 123,
        type: 'browser_click',
        payload: {},
      });

      expect(mockApiClient.sendCommandResponse).toHaveBeenCalledWith(
        'cmd-no-handler',
        false,
        {},
        'No command handler registered'
      );
    });
  });

  describe('isConnectedToReverb', () => {
    it('returns false initially', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      expect(reverbClient.isConnectedToReverb()).toBe(false);
    });

    it('returns true after successful subscription', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);

      // Simulate subscription success
      const subscribedCallback = mockChannel.subscribed.mock.calls[0][0];
      subscribedCallback();

      expect(reverbClient.isConnectedToReverb()).toBe(true);
    });

    it('returns false after disconnect', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      await reverbClient.connect(123);

      const subscribedCallback = mockChannel.subscribed.mock.calls[0][0];
      subscribedCallback();

      await reverbClient.disconnect();

      expect(reverbClient.isConnectedToReverb()).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('notifies listeners on connection state change', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const listener = vi.fn();
      reverbClient.subscribe(listener);

      await reverbClient.connect(123);

      // Simulate subscription success
      const subscribedCallback = mockChannel.subscribed.mock.calls[0][0];
      subscribedCallback();

      expect(listener).toHaveBeenCalledWith(true);
    });

    it('returns unsubscribe function', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const listener = vi.fn();
      const unsubscribe = reverbClient.subscribe(listener);

      unsubscribe();

      await reverbClient.connect(123);

      const subscribedCallback = mockChannel.subscribed.mock.calls[0][0];
      subscribedCallback();

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('connection state events', () => {
    it('updates state to CONNECTED on pusher connected event', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const listener = vi.fn();
      reverbClient.subscribe(listener);

      await reverbClient.connect(123);

      // Find the 'connected' event handler from pusher.connection.bind calls
      const bindCalls = mockEcho.connector.pusher.connection.bind.mock.calls;
      const connectedHandler = bindCalls.find((call: unknown[]) => call[0] === 'connected')?.[1];

      expect(connectedHandler).toBeDefined();

      // Simulate pusher connected event
      connectedHandler();

      // Should notify listeners
      expect(listener).toHaveBeenCalled();
    });

    it('updates state on pusher disconnected event', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const listener = vi.fn();
      reverbClient.subscribe(listener);

      await reverbClient.connect(123);

      // Find the 'disconnected' event handler
      const bindCalls = mockEcho.connector.pusher.connection.bind.mock.calls;
      const disconnectedHandler = bindCalls.find((call: unknown[]) => call[0] === 'disconnected')?.[1];

      expect(disconnectedHandler).toBeDefined();

      // Simulate pusher disconnected event
      disconnectedHandler();

      // Should notify listeners
      expect(listener).toHaveBeenCalled();
    });

    it('updates state on pusher error event', async () => {
      vi.resetModules();
      const { reverbClient } = await import('@/background/reverb-client');

      const listener = vi.fn();
      reverbClient.subscribe(listener);

      await reverbClient.connect(123);

      // Find the 'error' event handler
      const bindCalls = mockEcho.connector.pusher.connection.bind.mock.calls;
      const errorHandler = bindCalls.find((call: unknown[]) => call[0] === 'error')?.[1];

      expect(errorHandler).toBeDefined();

      // Simulate pusher error event
      errorHandler(new Error('Connection failed'));

      // Should notify listeners
      expect(listener).toHaveBeenCalled();
    });
  });
});
