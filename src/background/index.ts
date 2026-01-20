/**
 * Background service worker entry point.
 * Manages WebSocket connection to browser-mcp and routes tool calls.
 *
 * Uses chrome.alarms API to keep the service worker alive when a tab is connected.
 * Manifest V3 service workers can go to sleep after ~30 seconds of inactivity,
 * which would kill the WebSocket connection to browser-mcp.
 */

import { WebSocketClient } from './ws-client';
import { TabManager } from './tab-manager';
import { createToolHandlers } from './tool-handlers';
import { activityLog } from './activity-log';
import { log } from '@/utils/logger';
import { CONFIG } from '@/types/config';

// Keep-alive alarm name - fires every 12 seconds to prevent service worker sleep
const KEEPALIVE_ALARM = 'keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.2; // 12 seconds

// Singleton instances
let wsClient: WebSocketClient | null = null;
let tabManager: TabManager | null = null;

/**
 * Initialize the extension.
 */
async function initialize(): Promise<void> {
  log.info('Initializing Agent Jake Browser MCP Extension');

  // Create tab manager
  tabManager = new TabManager();
  await tabManager.initialize();

  // Create WebSocket client
  wsClient = new WebSocketClient(CONFIG.WS_PORT);

  // Create tool handlers
  const handleMessage = createToolHandlers(tabManager);
  wsClient.setMessageHandler(handleMessage);

  // Start connection loop
  startConnectionLoop();

  log.info('Extension initialized');
}

/**
 * Start or stop the keep-alive alarm based on whether a tab is connected.
 * The alarm prevents the service worker from going to sleep.
 */
async function updateKeepAliveAlarm(): Promise<void> {
  const tabId = tabManager?.getConnectedTabId();

  if (tabId) {
    // Tab connected - start keep-alive alarm
    const existing = await chrome.alarms.get(KEEPALIVE_ALARM);
    if (!existing) {
      await chrome.alarms.create(KEEPALIVE_ALARM, {
        periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
      });
      log.info('[KeepAlive] Alarm started - service worker will stay awake');
    }
  } else {
    // No tab connected - stop keep-alive alarm to allow service worker to sleep
    await chrome.alarms.clear(KEEPALIVE_ALARM);
    log.debug('[KeepAlive] Alarm cleared - no connected tab');
  }
}

/**
 * Handle keep-alive alarm - triggers connection check.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    log.debug('[KeepAlive] Alarm fired - checking connection');
    tryConnect();
  }
});

/**
 * Try to connect to browser-mcp if we have a connected tab.
 */
async function tryConnect(): Promise<void> {
  if (!wsClient) return;

  const tabId = tabManager?.getConnectedTabId();
  const wsConnected = wsClient?.isConnected();
  log.debug(`[Loop] tryConnect - tabId: ${tabId}, wsConnected: ${wsConnected}`);

  // Only connect if we have a connected tab
  if (!tabId) {
    log.debug('[Loop] No connected tab, skipping WebSocket connection');
    return;
  }

  if (!wsConnected) {
    log.info('[Loop] Not connected, attempting WebSocket connect...');
    try {
      await wsClient.connect();
      log.info('[Loop] Connected to browser-mcp');
    } catch (error) {
      log.warn(`[Loop] Connect failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Connection loop - keeps trying to connect to browser-mcp.
 */
async function startConnectionLoop(): Promise<void> {
  if (!wsClient) return;

  // Try immediately
  await tryConnect();

  // Update keep-alive alarm based on current state
  await updateKeepAliveAlarm();

  // Also poll every 5 seconds as backup (in case alarm fails)
  setInterval(tryConnect, CONFIG.RECONNECT_INTERVAL_MS);
}

/**
 * Handle messages from popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Log all incoming messages for debugging
  log.debug('Message received, url:', sender.url, 'action:', message?.action);

  // Check if message is from our extension pages (popup, etc.)
  // When popup is opened as a page (Playwright), sender.tab is set but URL is still chrome-extension://
  const isFromExtension = sender.url?.startsWith('chrome-extension://');
  const isFromContentScript = sender.tab && !isFromExtension;

  if (isFromContentScript) {
    // Message from content script in a regular web page - handle separately
    // Don't return false - just don't respond to popup-style messages
    return;
  }

  // This is from popup or other extension page
  (async () => {
    try {
      const response = await handlePopupMessage(message);
      log.debug('Sending popup response');
      sendResponse(response);
    } catch (error) {
      log.error('Message handler error:', error);
      sendResponse({ success: false, error: (error as Error).message });
    }
  })();

  return true; // Keep sendResponse channel open for async response
});

/**
 * Handle popup messages.
 */
async function handlePopupMessage(message: {
  action: string;
  payload?: unknown;
}): Promise<unknown> {
  const { action, payload } = message;

  switch (action) {
    case 'getStatus': {
      // Ensure tabManager is initialized before accessing
      const tabs = tabManager ? await tabManager.listTabs() : [];
      return {
        connected: wsClient?.isConnected() || false,
        tabId: tabManager?.getConnectedTabId() || null,
        tabs,
      };
    }

    case 'connectTab': {
      const { tabId, tabUrl } = payload as { tabId: number; tabUrl?: string };
      await tabManager?.connectTab(tabId, tabUrl);
      // Reset reconnect counter and try to connect immediately
      wsClient?.resetReconnectAttempts();
      wsClient?.connect().catch(() => {}); // Fire and forget
      // Start keep-alive alarm to prevent service worker sleep
      await updateKeepAliveAlarm();
      return { success: true };
    }

    case 'disconnectTab': {
      await tabManager?.disconnectTab();
      wsClient?.disconnect();
      // Stop keep-alive alarm
      await updateKeepAliveAlarm();
      return { success: true };
    }

    case 'getActivity': {
      try {
        const { limit } = (payload as { limit?: number }) || {};
        if (limit) {
          return await activityLog.getLatest(limit);
        }
        return await activityLog.getAll();
      } catch (error) {
        log.error('Failed to get activity:', error);
        // Return empty response on error
        return { activities: [], total: 0 };
      }
    }

    case 'clearActivity': {
      await activityLog.clear();
      return { success: true };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Handle extension install/update.
 */
chrome.runtime.onInstalled.addListener((details) => {
  log.info(`Extension installed: ${details.reason}`);
});

/**
 * Handle debugger detach.
 * Attempts to reattach if it wasn't user-initiated.
 */
chrome.debugger.onDetach.addListener(async (source, reason) => {
  log.warn(`Debugger detached from tab ${source.tabId}: ${reason}`);

  // Mark debugger as detached in TabManager
  tabManager?.markDebuggerDetached();

  // If it's our connected tab and reason isn't user-initiated, try to reattach
  const connectedTabId = tabManager?.getConnectedTabId();
  if (source.tabId === connectedTabId && reason !== 'canceled_by_user') {
    // Small delay to let Chrome settle
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      await tabManager?.reattachDebugger();
      log.info('[onDetach] Debugger reattached successfully');
    } catch (error) {
      log.error('[onDetach] Failed to reattach debugger:', error);
      // Don't throw - the next tool call will try again via sendDebuggerCommand
    }
  }
});

// Initialize on load
console.log('========================================');
console.log('Agent Jake Browser MCP Extension v1.0.19');
console.log('========================================');
initialize().catch(error => {
  log.error('Failed to initialize:', error);
});

// Expose debug helpers for service worker console
(globalThis as Record<string, unknown>).__debug = {
  getStatus: () => ({
    wsConnected: wsClient?.isConnected(),
    tabId: tabManager?.getConnectedTabId(),
    reconnectAttempts: (wsClient as unknown as { reconnectAttempts?: number })?.reconnectAttempts,
  }),
  forceConnect: () => wsClient?.connect(),
  forceDisconnect: () => wsClient?.disconnect(),
  resetReconnect: () => wsClient?.resetReconnectAttempts(),
};
