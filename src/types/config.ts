/**
 * Extension configuration constants.
 */

export const CONFIG = {
  // Laravel API server
  // For local testing: 'http://localhost:8000'
  // For remote/ngrok: 'https://jakes.ngrok.pizza'
  API_URL: 'http://localhost:8000',

  // Laravel Reverb WebSocket server
  // For local testing: 'localhost'
  // For remote: must match API domain or use separate ngrok tunnel
  REVERB_HOST: 'localhost',
  REVERB_PORT: 8085,
  REVERB_APP_KEY: 'sortie-extension-key',

  // WebSocket connection to browser-mcp server (local only)
  WS_PORT: 8765,
  WS_HOST: 'localhost',

  // Reconnection settings
  RECONNECT_INTERVAL_MS: 5000,  // Check every 5 seconds (fixed, no backoff)
  MAX_RECONNECT_ATTEMPTS: 0,    // 0 = unlimited retries

  // Timeouts
  MESSAGE_TIMEOUT_MS: 30000,
  ELEMENT_WAIT_TIMEOUT_MS: 10000,
  DOM_STABILITY_MS: 500,

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 500,

  // Snapshot settings
  MAX_SNAPSHOT_AGE_MS: 30000,
  MAX_NAME_LENGTH: 500,

  // Error codes
  ERRORS: {
    NO_TAB: 'NO_CONNECTED_TAB',
    STALE_REF: 'STALE_ELEMENT_REF',
    NOT_FOUND: 'ELEMENT_NOT_FOUND',
    NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE',
    NOT_CLICKABLE: 'ELEMENT_NOT_CLICKABLE',
    TIMEOUT: 'OPERATION_TIMEOUT',
    WS_DISCONNECTED: 'WEBSOCKET_DISCONNECTED',
  },
} as const;

export type ErrorCode = typeof CONFIG.ERRORS[keyof typeof CONFIG.ERRORS];
