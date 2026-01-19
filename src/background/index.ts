/**
 * Background service worker entry point.
 * Manages WebSocket connection to browser-mcp and routes tool calls.
 */

import { WebSocketClient } from './ws-client';
import { TabManager } from './tab-manager';
import { createToolHandlers } from './tool-handlers';
import { activityLog } from './activity-log';
import { log } from '@/utils/logger';
import { CONFIG } from '@/types/config';

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
 * Connection loop - keeps trying to connect to browser-mcp.
 */
async function startConnectionLoop(): Promise<void> {
  if (!wsClient) return;

  const tryConnect = async () => {
    if (!wsClient) return;

    // Only connect if we have a connected tab
    const tabId = tabManager?.getConnectedTabId();
    if (!tabId) {
      log.debug('No connected tab, skipping WebSocket connection');
      return;
    }

    if (!wsClient.isConnected()) {
      try {
        await wsClient.connect();
        log.info('Connected to browser-mcp');
      } catch (error) {
        log.debug('Connection attempt failed:', (error as Error).message);
      }
    }
  };

  // Try immediately
  await tryConnect();

  // Then poll every second
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
      const { tabId } = payload as { tabId: number };
      await tabManager?.connectTab(tabId);
      return { success: true };
    }

    case 'disconnectTab': {
      await tabManager?.disconnectTab();
      wsClient?.disconnect();
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
 */
chrome.debugger.onDetach.addListener((source, reason) => {
  log.warn(`Debugger detached from tab ${source.tabId}: ${reason}`);
});

// Initialize on load
initialize().catch(error => {
  log.error('Failed to initialize:', error);
});
