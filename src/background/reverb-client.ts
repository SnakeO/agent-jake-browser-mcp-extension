/**
 * Laravel Reverb WebSocket client for receiving browser commands.
 * Uses Laravel Echo with Pusher protocol to connect to Reverb server.
 * Implements graceful offline handling with exponential backoff.
 */

import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { CONFIG } from '../types/config';
import { apiClient } from './api-client';
import { logActivity } from './activity-log';
import { ConnectionStateManager, ConnectionState, ErrorCodes } from './connection-state';

// Make Pusher available globally for Laravel Echo
(globalThis as Record<string, unknown>).Pusher = Pusher;

export interface BrowserCommand {
  commandId: string;
  userId: number;
  type: string;
  payload: Record<string, unknown>;
}

export type CommandHandler = (command: BrowserCommand) => Promise<{ success: boolean; result?: unknown; error?: string }>;

/**
 * Reverb client for receiving commands from Laravel server.
 * Implements graceful offline handling with exponential backoff.
 */
class ReverbClient {
  private echo: Echo<'pusher'> | null = null;
  private userId: number | null = null;
  private commandHandler: CommandHandler | null = null;
  private connectionState: ConnectionStateManager;
  private listeners: Set<(connected: boolean) => void> = new Set();

  constructor() {
    this.connectionState = new ConnectionStateManager({
      initialDelay: 1000,    // Start with 1 second
      maxDelay: 30000,       // Max 30 seconds for WebSocket
      multiplier: 2,
      maxAttempts: 0,        // Unlimited
      jitter: true,
    });
  }

  /**
   * Set the command handler that processes incoming browser commands.
   */
  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  /**
   * Connect to Reverb server for a specific user.
   * Implements graceful error handling with automatic reconnection.
   */
  async connect(userId: number): Promise<void> {
    // Upfront auth check - prevent connecting without valid token
    const token = apiClient.getToken();
    if (!token) {
      console.log('[ReverbClient] Cannot connect without auth token');
      this.connectionState.setDisconnected();
      return;
    }

    if (this.echo && this.userId === userId && this.connectionState.isConnected()) {
      console.log('[ReverbClient] Already connected for user', userId);
      return;
    }

    // Disconnect any existing connection
    await this.disconnect();

    this.userId = userId;

    this.connectionState.setConnecting();

    try {
      console.log('[ReverbClient] Connecting to Reverb server...');

      this.echo = new Echo({
        broadcaster: 'pusher',
        key: CONFIG.REVERB_APP_KEY,
        wsHost: CONFIG.REVERB_HOST,
        wsPort: CONFIG.REVERB_PORT,
        wssPort: CONFIG.REVERB_PORT,
        forceTLS: false,
        encrypted: false,
        disableStats: true,
        enabledTransports: ['ws', 'wss'],
        cluster: 'mt1',
        authEndpoint: `${CONFIG.API_URL}/broadcasting/auth`,
        auth: {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        },
      });

      // Subscribe to private channel
      const channelName = `extension.${userId}`;
      console.log('[ReverbClient] Subscribing to channel:', channelName);

      const channel = this.echo.private(channelName);

      // Handle subscription success
      channel.subscribed(() => {
        console.log('[ReverbClient] Subscribed to channel:', channelName);
        this.connectionState.setConnected();
        this.notifyListeners();
        logActivity({
          type: 'connection',
          action: 'reverb_connected',
          description: 'Connected to Reverb WebSocket server',
          success: true,
        });
      });

      // Handle incoming browser commands
      channel.listen('.browser.command', async (event: {
        commandId: string;
        userId: number;
        type: string;
        payload: Record<string, unknown>;
      }) => {
        console.log('[ReverbClient] Received command:', event);

        logActivity({
          type: 'tool',
          action: event.type,
          description: `Received command: ${event.type}`,
          success: true,
          details: { commandId: event.commandId },
        });

        await this.handleCommand({
          commandId: event.commandId,
          userId: event.userId,
          type: event.type,
          payload: event.payload,
        });
      });

      // Handle subscription error
      channel.error((error: Error) => {
        console.error('[ReverbClient] Channel error:', error);
        this.notifyListeners();
        this.scheduleReconnect(error.message);
      });

      // Handle connection state changes via Pusher instance
      const pusher = (this.echo.connector as { pusher: Pusher }).pusher;

      pusher.connection.bind('connected', () => {
        console.log('[ReverbClient] Pusher connected');
      });

      pusher.connection.bind('disconnected', () => {
        console.log('[ReverbClient] Pusher disconnected');
        this.notifyListeners();
        this.scheduleReconnect('Pusher disconnected');
      });

      pusher.connection.bind('error', (error: Error) => {
        console.error('[ReverbClient] Pusher error:', error);
        logActivity({
          type: 'error',
          action: 'reverb_error',
          description: `WebSocket error: ${error.message || 'Unknown error'}`,
          success: false,
        });
      });

    } catch (error) {
      console.error('[ReverbClient] Failed to connect:', error);
      logActivity({
        type: 'error',
        action: 'reverb_connect_failed',
        description: `Failed to connect to Reverb: ${(error as Error).message}`,
        success: false,
      });
      this.scheduleReconnect((error as Error).message);
    }
  }

  /**
   * Disconnect from Reverb server.
   */
  async disconnect(): Promise<void> {
    // Cancel any pending reconnection
    this.connectionState.clearReconnectTimer();

    // Store userId for channel cleanup, then clear immediately to prevent stale reconnects
    const userIdForCleanup = this.userId;
    this.userId = null;

    if (this.echo) {
      try {
        if (userIdForCleanup) {
          this.echo.leave(`extension.${userIdForCleanup}`);
        }
        this.echo.disconnect();
      } catch (error) {
        console.error('[ReverbClient] Error during disconnect:', error);
      }
      this.echo = null;
    }

    this.connectionState.setDisconnected();
    this.notifyListeners();
  }

  /**
   * Handle an incoming command.
   */
  private async handleCommand(command: BrowserCommand): Promise<void> {
    const startTime = Date.now();

    try {
      let result: { success: boolean; result?: unknown; error?: string };

      if (this.commandHandler) {
        result = await this.commandHandler(command);
      } else {
        result = {
          success: false,
          error: 'No command handler registered',
        };
      }

      // Send response back to server
      await apiClient.sendCommandResponse(
        command.commandId,
        result.success,
        result.result || {},
        result.error
      );

      const durationMs = Date.now() - startTime;

      logActivity({
        type: 'tool',
        action: command.type,
        description: result.success
          ? `Command ${command.type} completed`
          : `Command ${command.type} failed: ${result.error}`,
        success: result.success,
        durationMs,
        details: { commandId: command.commandId },
      });

    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error('[ReverbClient] Command execution error:', error);

      // Report error back to server
      await apiClient.sendCommandResponse(
        command.commandId,
        false,
        {},
        errorMsg
      );

      logActivity({
        type: 'error',
        action: command.type,
        description: `Command error: ${errorMsg}`,
        success: false,
        durationMs: Date.now() - startTime,
        details: { commandId: command.commandId },
      });
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(errorMessage?: string): void {
    if (!this.userId) return;

    // Verify token is still available before scheduling retry
    const token = apiClient.getToken();
    if (!token) {
      console.log('[ReverbClient] No token available, skipping reconnect');
      this.connectionState.setDisconnected();
      return;
    }

    // Handle error and get retry info
    const { shouldRetry, delay } = this.connectionState.handleError(
      ErrorCodes.WEBSOCKET_ERROR,
      errorMessage || 'WebSocket disconnected'
    );

    if (shouldRetry && delay) {
      const attempt = this.connectionState.getInfo().reconnectAttempt;
      console.log(`[ReverbClient] Scheduling reconnect in ${delay}ms (attempt ${attempt})`);

      this.connectionState.scheduleReconnect(async () => {
        if (this.userId) {
          await this.connect(this.userId);
        }
      }, delay);

      logActivity({
        type: 'connection',
        action: 'reverb_reconnect_scheduled',
        description: `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt})`,
        success: true,
      });
    }
  }

  /**
   * Check if connected to Reverb.
   */
  isConnectedToReverb(): boolean {
    return this.connectionState.isConnected();
  }

  /**
   * Get detailed connection state.
   */
  getConnectionState(): ConnectionState {
    return this.connectionState.getState();
  }

  /**
   * Subscribe to connection state changes.
   */
  subscribe(listener: (connected: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of connection state change.
   */
  private notifyListeners(): void {
    const connected = this.connectionState.isConnected();
    this.listeners.forEach(listener => listener(connected));
  }
}

// Singleton instance
export const reverbClient = new ReverbClient();
