/**
 * Tool handlers for browser automation commands.
 * Each handler implements one MCP tool.
 */

import { z } from 'zod';
import type { TabManager } from './tab-manager';
import type { IncomingMessage, OutgoingMessage, Coordinates } from '@/types/messages';
import { CONFIG } from '@/types/config';
import { log } from '@/utils/logger';
import { logTool, logError } from './activity-log';

// Input validators using Zod
const schemas = {
  browser_navigate: z.object({
    url: z.string().url(),
  }),

  browser_click: z.object({
    ref: z.string().describe('Element reference from snapshot (e.g., s1e42)'),
    selector: z.string().optional().describe('CSS selector fallback'),
  }),

  browser_type: z.object({
    ref: z.string(),
    text: z.string(),
    clear: z.boolean().optional().default(false),
  }),

  browser_hover: z.object({
    ref: z.string(),
    selector: z.string().optional(),
  }),

  browser_drag: z.object({
    startRef: z.string(),
    endRef: z.string(),
  }),

  browser_select_option: z.object({
    ref: z.string(),
    value: z.string().optional(),
    label: z.string().optional(),
    index: z.number().optional(),
  }),

  browser_press_key: z.object({
    key: z.string().describe('Key name like "Enter", "Tab", "ArrowDown", or "a"'),
  }),

  browser_wait: z.object({
    time: z.number().min(0).max(30).describe('Time to wait in seconds'),
  }),

  browser_new_tab: z.object({
    url: z.string().url(),
  }),

  browser_switch_tab: z.object({
    tabId: z.number(),
  }),

  browser_get_text: z.object({
    ref: z.string(),
  }),

  browser_get_attribute: z.object({
    ref: z.string(),
    attribute: z.string(),
  }),

  browser_wait_for_element: z.object({
    ref: z.string(),
    timeout: z.number().optional().default(10000),
  }),

  browser_highlight: z.object({
    ref: z.string(),
  }),

  browser_evaluate: z.object({
    code: z.string(),
  }),

  browser_evaluate_safe: z.object({
    code: z.string().describe('JavaScript code to evaluate (CSP-safe via CDP)'),
  }),

  browser_resize_viewport: z.object({
    width: z.number().int().min(320).max(3840),
    height: z.number().int().min(200).max(2160),
  }),

  browser_upload_file: z.object({
    ref: z.string().optional(),
    selector: z.string().optional(),
    filePath: z.string(),
  }),
};

type ToolName = keyof typeof schemas;

/**
 * Create tool handlers bound to a tab manager.
 */
export function createToolHandlers(tabManager: TabManager) {
  /**
   * Send message to content script in connected tab.
   */
  async function sendToContent<T>(
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const tabId = tabManager.getConnectedTabId();
    if (!tabId) {
      throw new Error('No tab connected. Use the popup to connect a tab first.');
    }

    const response = await chrome.tabs.sendMessage(tabId, { action, payload });

    if (!response.success) {
      throw new Error(response.error || 'Content script error');
    }

    return response.data as T;
  }

  /**
   * Get selector for element ref.
   */
  async function getSelector(ref: string): Promise<string> {
    return sendToContent<string>('getSelector', { ref });
  }

  /**
   * Wait for DOM to stabilize after action.
   */
  async function waitForStable(): Promise<void> {
    await sendToContent('waitForDomStable', { timeout: CONFIG.DOM_STABILITY_MS });
  }

  /**
   * Check if an error is a navigation-related error (BFCache, port closed, etc).
   * These errors often occur after a successful action that triggers navigation.
   */
  function isNavigationError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return msg.includes('back/forward cache') ||
           msg.includes('message channel') ||
           msg.includes('port') ||
           msg.includes('closed') ||
           msg.includes('receiving end does not exist');
  }

  /**
   * Try to wait for DOM stability, handling navigation gracefully.
   * Returns true if navigated, false if stable on same page.
   */
  async function waitForStableOrNavigation(initialUrl: string): Promise<{ navigated: boolean; newUrl?: string }> {
    const tabId = tabManager.getConnectedTabId();
    if (!tabId) throw new Error('No tab connected');

    try {
      await waitForStable();
      return { navigated: false };
    } catch (error) {
      if (isNavigationError(error as Error)) {
        // Check if navigation actually occurred
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.url !== initialUrl) {
          log.info('[waitForStableOrNavigation] Navigation detected - action succeeded');
          return { navigated: true, newUrl: currentTab.url };
        }
        // Same URL but port closed - might be page refresh or form submit
        log.warn('[waitForStableOrNavigation] Port closed but same URL - assuming success');
        return { navigated: false };
      }
      throw error;
    }
  }

  /**
   * Send mouse event via Chrome Debugger API.
   */
  async function dispatchMouseEvent(
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle' = 'left',
    clickCount = 1
  ): Promise<void> {
    await tabManager.sendDebuggerCommand('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      clickCount,
    });
  }

  /**
   * Send keyboard event via Chrome Debugger API.
   */
  async function dispatchKeyEvent(
    type: 'keyDown' | 'keyUp' | 'char',
    key: string,
    text?: string
  ): Promise<void> {
    const keyDef = getKeyDefinition(key);

    await tabManager.sendDebuggerCommand('Input.dispatchKeyEvent', {
      type,
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      text: type === 'char' ? text : undefined,
    });
  }

  // Tool implementation map
  const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
    browser_navigate: async (payload) => {
      const { url } = schemas.browser_navigate.parse(payload);
      const tabId = tabManager.getConnectedTabId();

      if (!tabId) {
        throw new Error('No tab connected');
      }

      await chrome.tabs.update(tabId, { url });

      // Wait for navigation to complete
      await new Promise<void>((resolve) => {
        const listener = (
          updatedTabId: number,
          changeInfo: { status?: string }
        ) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      return { navigated: url };
    },

    browser_go_back: async () => {
      await tabManager.sendDebuggerCommand('Page.navigateToHistoryEntry', {
        entryId: -1, // This won't work directly
      });
      // Actually use history API
      const tabId = tabManager.getConnectedTabId();
      if (tabId) {
        await chrome.tabs.goBack(tabId);
      }
      return { success: true };
    },

    browser_go_forward: async () => {
      const tabId = tabManager.getConnectedTabId();
      if (tabId) {
        await chrome.tabs.goForward(tabId);
      }
      return { success: true };
    },

    browser_reload: async () => {
      const tabId = tabManager.getConnectedTabId();
      if (tabId) {
        await chrome.tabs.reload(tabId);
        // Wait for reload to complete
        await new Promise<void>((resolve) => {
          const listener = (
            updatedTabId: number,
            changeInfo: { status?: string }
          ) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
      return { success: true };
    },

    browser_snapshot: async () => {
      const snapshot = await sendToContent<string>('generateSnapshot');
      const { url, title } = await sendToContent<{ url: string; title: string }>('getPageInfo');

      return {
        url,
        title,
        snapshot,
      };
    },

    browser_click: async (payload) => {
      const { ref } = schemas.browser_click.parse(payload);
      const tabId = tabManager.getConnectedTabId();
      if (!tabId) throw new Error('No tab connected');

      // Capture initial URL to detect navigation
      const initialTab = await chrome.tabs.get(tabId);
      const initialUrl = initialTab.url || '';

      const selector = await getSelector(ref);
      await sendToContent('scrollIntoView', { selector });

      const coords = await sendToContent<Coordinates>('getElementCoordinates', {
        selector,
        clickable: true,
      });

      // Click sequence: move, down, up (uses CDP, doesn't need content script)
      await dispatchMouseEvent('mouseMoved', coords.x, coords.y);
      await dispatchMouseEvent('mousePressed', coords.x, coords.y, 'left', 1);
      await dispatchMouseEvent('mouseReleased', coords.x, coords.y, 'left', 1);

      // Wait for stability, handling navigation gracefully
      const result = await waitForStableOrNavigation(initialUrl);
      if (result.navigated) {
        return { clicked: ref, navigated: true, newUrl: result.newUrl };
      }
      return { clicked: ref };
    },

    browser_type: async (payload) => {
      const { ref, text, clear } = schemas.browser_type.parse(payload);
      const tabId = tabManager.getConnectedTabId();
      if (!tabId) throw new Error('No tab connected');

      // Capture initial URL (typing can trigger form submission/navigation)
      const initialTab = await chrome.tabs.get(tabId);
      const initialUrl = initialTab.url || '';

      const selector = await getSelector(ref);
      await sendToContent('scrollIntoView', { selector });

      const coords = await sendToContent<Coordinates>('getElementCoordinates', { selector });

      // Click to focus
      await dispatchMouseEvent('mouseMoved', coords.x, coords.y);
      await dispatchMouseEvent('mousePressed', coords.x, coords.y, 'left', 1);
      await dispatchMouseEvent('mouseReleased', coords.x, coords.y, 'left', 1);

      // Clear existing text if requested
      if (clear) {
        await dispatchKeyEvent('keyDown', 'Control');
        await dispatchKeyEvent('keyDown', 'a');
        await dispatchKeyEvent('keyUp', 'a');
        await dispatchKeyEvent('keyUp', 'Control');
        await dispatchKeyEvent('keyDown', 'Backspace');
        await dispatchKeyEvent('keyUp', 'Backspace');
      }

      // Type each character
      for (const char of text) {
        await dispatchKeyEvent('keyDown', char);
        await dispatchKeyEvent('char', char, char);
        await dispatchKeyEvent('keyUp', char);
      }

      // Wait for stability, handling navigation gracefully
      const result = await waitForStableOrNavigation(initialUrl);
      if (result.navigated) {
        return { typed: text, cleared: clear, navigated: true, newUrl: result.newUrl };
      }
      return { typed: text, cleared: clear };
    },

    browser_hover: async (payload) => {
      const parsed = schemas.browser_hover.parse(payload);
      const ref = parsed.ref;

      const selector = await getSelector(ref);
      await sendToContent('scrollIntoView', { selector });

      const coords = await sendToContent<Coordinates>('getElementCoordinates', { selector });
      await dispatchMouseEvent('mouseMoved', coords.x, coords.y);

      return { hovered: ref };
    },

    browser_press_key: async (payload) => {
      const { key } = schemas.browser_press_key.parse(payload);
      const tabId = tabManager.getConnectedTabId();
      if (!tabId) throw new Error('No tab connected');

      // Capture initial URL (Enter key can submit forms/navigate)
      const initialTab = await chrome.tabs.get(tabId);
      const initialUrl = initialTab.url || '';

      await dispatchKeyEvent('keyDown', key);
      await dispatchKeyEvent('keyUp', key);

      // Wait for stability, handling navigation gracefully
      const result = await waitForStableOrNavigation(initialUrl);
      if (result.navigated) {
        return { pressed: key, navigated: true, newUrl: result.newUrl };
      }
      return { pressed: key };
    },

    browser_wait: async (payload) => {
      const { time } = schemas.browser_wait.parse(payload);
      await new Promise(resolve => setTimeout(resolve, time * 1000));
      return { waited: time };
    },

    browser_screenshot: async () => {
      const result = await tabManager.sendDebuggerCommand<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png' }
      );

      return {
        image: `data:image/png;base64,${result.data}`,
      };
    },

    browser_get_console_logs: async () => {
      // Note: This would require setting up Console domain monitoring
      // For now, return empty array
      return { logs: [] };
    },

    // New features
    browser_new_tab: async (payload) => {
      const { url } = schemas.browser_new_tab.parse(payload);
      const tabInfo = await tabManager.createTab(url, true);
      return { tab: tabInfo };
    },

    browser_list_tabs: async () => {
      const tabs = await tabManager.listTabs();
      return { tabs };
    },

    browser_switch_tab: async (payload) => {
      const { tabId } = schemas.browser_switch_tab.parse(payload);
      await tabManager.switchTab(tabId);
      return { switched: tabId };
    },

    browser_close_tab: async () => {
      await tabManager.closeTab();
      return { closed: true };
    },

    browser_get_text: async (payload) => {
      const { ref } = schemas.browser_get_text.parse(payload);
      const selector = await getSelector(ref);
      const text = await sendToContent<string>('getText', { selector });
      return { text };
    },

    browser_get_attribute: async (payload) => {
      const { ref, attribute } = schemas.browser_get_attribute.parse(payload);
      const selector = await getSelector(ref);
      const value = await sendToContent<string | null>('getAttribute', { selector, attribute });
      return { value };
    },

    browser_is_visible: async (payload) => {
      const { ref } = z.object({ ref: z.string() }).parse(payload);
      const selector = await getSelector(ref);
      const visible = await sendToContent<boolean>('isVisible', { selector });
      return { visible };
    },

    browser_wait_for_element: async (payload) => {
      const { ref, timeout } = schemas.browser_wait_for_element.parse(payload);
      const selector = await getSelector(ref);
      const found = await sendToContent<boolean>('waitForElement', { selector, timeout });
      return { found };
    },

    browser_highlight: async (payload) => {
      const { ref } = schemas.browser_highlight.parse(payload);
      const selector = await getSelector(ref);
      await sendToContent('highlight', { selector });
      return { highlighted: ref };
    },

    browser_evaluate: async (payload) => {
      const { code } = schemas.browser_evaluate.parse(payload);
      log.info('[browser_evaluate] Evaluating code:', code.substring(0, 50));

      // Use content script messaging to evaluate code in page context
      const result = await sendToContent<unknown>('evaluate', { code });
      log.info('[browser_evaluate] Result type:', typeof result);
      return result;
    },

    /**
     * CSP-safe JavaScript evaluation using CDP Runtime.evaluate.
     * Unlike browser_evaluate (which uses content script eval), this uses
     * Chrome DevTools Protocol which bypasses CSP restrictions.
     * Use this on sites with strict Content Security Policy.
     */
    browser_evaluate_safe: async (payload) => {
      const { code } = schemas.browser_evaluate_safe.parse(payload);
      log.info('[browser_evaluate_safe] Evaluating via CDP:', code.substring(0, 50));

      try {
        const result = await tabManager.sendDebuggerCommand<{
          result: { type: string; value?: unknown; description?: string };
          exceptionDetails?: { text: string; exception?: { description: string } };
        }>('Runtime.evaluate', {
          expression: code,
          returnByValue: true,
          awaitPromise: true,
        });

        // Check for evaluation errors
        if (result.exceptionDetails) {
          const errMsg = result.exceptionDetails.exception?.description ||
                         result.exceptionDetails.text ||
                         'Unknown evaluation error';
          throw new Error(`Evaluation failed: ${errMsg}`);
        }

        log.info('[browser_evaluate_safe] Result type:', result.result?.type);
        return result.result?.value ?? null;
      } catch (error) {
        log.error('[browser_evaluate_safe] CDP evaluation failed:', error);
        throw error;
      }
    },

    /**
     * Get page HTML using CDP DOM.getOuterHTML (no JS eval, CSP-safe).
     * This works on sites that block unsafe-eval in their CSP.
     */
    browser_get_html: async () => {
      log.info('[browser_get_html] Getting HTML via CDP DOM.getOuterHTML');

      // Use CDP DOM.getDocument to get the document node
      const { root } = await tabManager.sendDebuggerCommand<{ root: { nodeId: number } }>(
        'DOM.getDocument',
        { depth: 0 }
      );

      // Get the outer HTML of the document element
      const { outerHTML } = await tabManager.sendDebuggerCommand<{ outerHTML: string }>(
        'DOM.getOuterHTML',
        { nodeId: root.nodeId }
      );

      log.info('[browser_get_html] Got HTML, length:', outerHTML.length);
      return { html: outerHTML };
    },

    browser_resize_viewport: async (payload) => {
      const { width, height } = schemas.browser_resize_viewport.parse(payload);

      // Use Emulation.setDeviceMetricsOverride to set viewport
      await tabManager.sendDebuggerCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      return { width, height };
    },

    browser_upload_file: async (payload) => {
      const { ref, selector, filePath } = schemas.browser_upload_file.parse(payload);

      // Get the selector for the file input
      let targetSelector = selector;
      if (!targetSelector && ref) {
        targetSelector = await getSelector(ref);
      }

      if (!targetSelector) {
        throw new Error('Either ref or selector must be provided');
      }

      // Get the document root
      const doc = await tabManager.sendDebuggerCommand<{ root: { nodeId: number } }>(
        'DOM.getDocument',
        {}
      );

      // Find the file input element
      const node = await tabManager.sendDebuggerCommand<{ nodeId: number }>(
        'DOM.querySelector',
        {
          nodeId: doc.root.nodeId,
          selector: targetSelector,
        }
      );

      if (!node.nodeId) {
        throw new Error(`Element not found: ${targetSelector}`);
      }

      // Set the file on the input
      await tabManager.sendDebuggerCommand('DOM.setFileInputFiles', {
        nodeId: node.nodeId,
        files: [filePath],
      });

      return { uploaded: true, filePath };
    },
  };

  /**
   * Handle incoming message from WebSocket.
   */
  return async function handleMessage(message: IncomingMessage): Promise<OutgoingMessage> {
    const { id, type, payload } = message;
    const startTime = performance.now();

    log.debug(`[Tool] Received: ${type} (id: ${id})`);

    try {
      const handler = handlers[type];
      if (!handler) {
        logError(type, `Unknown tool: ${type}`, { payload });
        return {
          id,
          success: false,
          error: {
            code: 'UNKNOWN_TOOL',
            message: `Unknown tool: ${type}`,
          },
        };
      }

      const result = await handler(payload);
      const durationMs = Math.round(performance.now() - startTime);

      // Create concise description based on tool type
      const description = getToolDescription(type, payload, result);
      logTool(type, description, true, durationMs, { payload, result });

      log.info(`[Tool] Completed: ${type} (id: ${id}) - success in ${durationMs}ms`);

      return {
        id,
        success: true,
        result,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      log.error(`[Tool] Failed: ${type} (id: ${id}) - ${(error as Error).message} in ${durationMs}ms`);

      logTool(type, (error as Error).message, false, durationMs, { payload, error: (error as Error).message });

      return {
        id,
        success: false,
        error: {
          code: (error as Error).name || 'EXECUTION_ERROR',
          message: (error as Error).message,
        },
      };
    }
  };
}

/**
 * Get a concise description for the tool action.
 */
function getToolDescription(type: string, payload: unknown, result: unknown): string {
  const p = payload as Record<string, unknown>;
  const r = result as Record<string, unknown>;

  switch (type) {
    case 'browser_navigate':
      return `Navigate to ${p?.url || 'unknown'}`;
    case 'browser_click':
      return `Click on "${p?.ref || p?.selector}"`;
    case 'browser_type':
      return `Type "${String(p?.text || '').slice(0, 20)}${(String(p?.text || '').length > 20) ? '...' : ''}"`;
    case 'browser_hover':
      return `Hover on "${p?.ref || p?.selector}"`;
    case 'browser_press_key':
      return `Press key "${p?.key}"`;
    case 'browser_wait':
      return `Wait ${p?.time}s`;
    case 'browser_screenshot':
      return 'Take screenshot';
    case 'browser_snapshot':
      return `Snapshot: ${r?.title || 'page'}`;
    case 'browser_new_tab':
      return `New tab: ${p?.url || 'unknown'}`;
    case 'browser_switch_tab':
      return `Switch to tab ${p?.tabId}`;
    case 'browser_close_tab':
      return 'Close tab';
    case 'browser_evaluate':
      return `Evaluate JS (${String(p?.code || '').length} chars)`;
    case 'browser_evaluate_safe':
      return `Evaluate JS via CDP (${String(p?.code || '').length} chars)`;
    case 'browser_get_html':
      return `Get page HTML (${(r?.html as string)?.length || 0} chars)`;
    case 'browser_resize_viewport':
      return `Resize to ${p?.width}x${p?.height}`;
    case 'browser_upload_file':
      return `Upload file: ${p?.filePath}`;
    default:
      return type.replace('browser_', '').replace(/_/g, ' ');
  }
}

/**
 * Get key definition for keyboard events.
 */
function getKeyDefinition(key: string): { key: string; code: string; keyCode: number } {
  // Common key mappings
  const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    Home: { key: 'Home', code: 'Home', keyCode: 36 },
    End: { key: 'End', code: 'End', keyCode: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
  };

  if (keyMap[key]) {
    return keyMap[key];
  }

  // Single character
  if (key.length === 1) {
    const charCode = key.charCodeAt(0);
    const code = key.toUpperCase().match(/[A-Z]/)
      ? `Key${key.toUpperCase()}`
      : `Digit${key}`;

    return {
      key,
      code,
      keyCode: charCode,
    };
  }

  // Default
  return { key, code: key, keyCode: 0 };
}
