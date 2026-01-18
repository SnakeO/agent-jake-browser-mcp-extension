/**
 * WebSocket client for connecting to browser-mcp server.
 * Handles connection lifecycle, reconnection, and message routing.
 */

import { CONFIG } from '@/types/config';
import { log } from '@/utils/logger';
import type { IncomingMessage, OutgoingMessage } from '@/types/messages';

type MessageHandler = (message: IncomingMessage) => Promise<OutgoingMessage>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isConnecting = false;
  private shouldReconnect = true;

  constructor(private port: number = CONFIG.WS_PORT) {}

  /**
   * Set the handler for incoming tool requests.
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Connect to the browser-mcp WebSocket server.
   */
  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      log.debug('Already connected');
      return;
    }

    if (this.isConnecting) {
      log.debug('Connection in progress');
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        const url = `ws://${CONFIG.WS_HOST}:${this.port}`;
        log.info(`Connecting to ${url}`);

        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
          log.info('WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.socket.onclose = (event) => {
          log.info(`WebSocket closed: ${event.code} ${event.reason}`);
          this.isConnecting = false;
          this.socket = null;
          this.handleDisconnect();
        };

        this.socket.onerror = (error) => {
          log.error('WebSocket error:', error);
          this.isConnecting = false;
          if (this.reconnectAttempts === 0) {
            reject(new Error('Failed to connect to browser-mcp'));
          }
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket disconnected'));
    }
    this.pendingRequests.clear();

    log.info('Disconnected');
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a response back to the server.
   */
  send(message: OutgoingMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      log.error('Cannot send: not connected');
      return;
    }

    const data = JSON.stringify(message);
    log.debug('Sending:', data);
    this.socket.send(data);
  }

  /**
   * Handle incoming WebSocket message.
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data) as IncomingMessage;
      log.debug('Received:', message.type, message.id);

      if (!this.messageHandler) {
        log.error('No message handler set');
        this.send({
          id: message.id,
          success: false,
          error: {
            code: 'NO_HANDLER',
            message: 'No message handler configured',
          },
        });
        return;
      }

      const response = await this.messageHandler(message);
      this.send(response);
    } catch (error) {
      log.error('Failed to handle message:', error);
    }
  }

  /**
   * Handle disconnection with auto-reconnect.
   */
  private handleDisconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      log.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = CONFIG.RECONNECT_INTERVAL_MS * this.reconnectAttempts;

    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        log.error('Reconnect failed:', error);
      });
    }, delay);
  }
}
