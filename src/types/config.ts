/**
 * Extension configuration constants.
 */

export const CONFIG = {
  // WebSocket connection to browser-mcp server
  WS_PORT: 8765,
  WS_HOST: 'localhost',

  // Reconnection settings
  RECONNECT_INTERVAL_MS: 1000,
  MAX_RECONNECT_ATTEMPTS: 10,

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
