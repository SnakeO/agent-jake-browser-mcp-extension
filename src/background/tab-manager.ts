/**
 * Manages connected tab state and tab operations.
 * Tracks which tab is currently being automated.
 */

import { log } from '@/utils/logger';
import { logTab, logError } from './activity-log';
import type { TabInfo } from '@/types/messages';
import { DEBUGGER } from '@/constants';

export class TabManager {
  private connectedTabId: number | null = null;
  private debuggerAttached = false;

  /**
   * Initialize tab manager, restoring state from storage.
   */
  async initialize(): Promise<void> {
    const stored = await chrome.storage.local.get(DEBUGGER.STORAGE_KEY);
    if (stored[DEBUGGER.STORAGE_KEY]) {
      const tabId = stored[DEBUGGER.STORAGE_KEY] as number;
      // Verify tab still exists
      if (await this.tabExists(tabId)) {
        this.connectedTabId = tabId;
        log.info(`Restored connected tab: ${tabId}`);
      } else {
        await chrome.storage.local.remove(DEBUGGER.STORAGE_KEY);
      }
    }
  }

  /**
   * Get the currently connected tab ID.
   */
  getConnectedTabId(): number | null {
    return this.connectedTabId;
  }

  /**
   * Connect to a specific tab for automation.
   * If tabUrl is chrome://newtab/, navigates to about:blank first.
   */
  async connectTab(tabId: number, tabUrl?: string): Promise<void> {
    // If tab is chrome://newtab/, navigate to about:blank first
    // (Chrome blocks extensions from accessing chrome:// URLs)
    if (tabUrl === 'chrome://newtab/') {
      await chrome.tabs.update(tabId, { url: 'about:blank' });
      await this.waitForTabLoad(tabId);
    }

    // Disconnect previous tab if any
    if (this.connectedTabId && this.connectedTabId !== tabId) {
      await this.disconnectTab();
    }

    // Verify tab exists
    if (!await this.tabExists(tabId)) {
      await logError('tab_connect', `Tab ${tabId} does not exist`, { tabId });
      throw new Error(`Tab ${tabId} does not exist`);
    }

    try {
      // Attach debugger
      await this.attachDebugger(tabId);

      this.connectedTabId = tabId;
      await chrome.storage.local.set({ [DEBUGGER.STORAGE_KEY]: tabId });

      // Get tab info for logging
      const tab = await chrome.tabs.get(tabId);
      const title = tab.title || tab.url || `Tab ${tabId}`;

      log.info(`Connected to tab: ${tabId}`);
      await logTab('tab_connect', `Connected to: ${title}`, true, { tabId, url: tab.url });
    } catch (error) {
      await logError('tab_connect', `Failed to connect: ${(error as Error).message}`, { tabId });
      throw error;
    }
  }

  /**
   * Disconnect from the current tab.
   */
  async disconnectTab(): Promise<void> {
    if (!this.connectedTabId) {
      return;
    }

    const tabId = this.connectedTabId;

    await this.detachDebugger();

    this.connectedTabId = null;
    await chrome.storage.local.remove(DEBUGGER.STORAGE_KEY);

    log.info(`Disconnected from tab: ${tabId}`);
    await logTab('tab_disconnect', `Disconnected from tab ${tabId}`, true, { tabId });
  }

  /**
   * Check if a tab exists.
   */
  private async tabExists(tabId: number): Promise<boolean> {
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if debugger is actually attached to a tab.
   * Uses chrome.debugger.getTargets() for accurate state.
   */
  private async isDebuggerAttached(tabId: number): Promise<boolean> {
    try {
      const targets = await chrome.debugger.getTargets();
      return targets.some(t => t.tabId === tabId && t.attached);
    } catch {
      return false;
    }
  }

  /**
   * Attach debugger to tab for input simulation.
   */
  private async attachDebugger(tabId: number): Promise<void> {
    // Always check actual state, not just our flag
    const actuallyAttached = await this.isDebuggerAttached(tabId);
    if (actuallyAttached) {
      log.debug(`Debugger already attached to tab ${tabId}, skipping attach`);
      this.debuggerAttached = true;
      // Still enable domains in case they were disabled
      await this.enableDebuggerDomains(tabId);
      return;
    }

    // Reset flag before attempting attach
    this.debuggerAttached = false;

    try {
      log.info(`Attaching debugger to tab ${tabId}...`);
      await chrome.debugger.attach({ tabId }, DEBUGGER.PROTOCOL_VERSION);
      this.debuggerAttached = true;
      log.info(`Debugger attached to tab ${tabId}`);
    } catch (error) {
      // May already be attached by another client
      if ((error as Error).message?.includes('Another debugger')) {
        log.warn('Debugger already attached by another client, will try to enable domains anyway');
        this.debuggerAttached = true;
      } else {
        log.error('Failed to attach debugger:', error);
        throw error;
      }
    }

    // Always enable domains after attaching or detecting existing attachment
    // These calls are idempotent (safe to call multiple times)
    await this.enableDebuggerDomains(tabId);
  }

  /**
   * Enable required debugger protocol domains.
   */
  private async enableDebuggerDomains(tabId: number): Promise<void> {
    // Enable Runtime domain for evaluate commands
    // This must be done before Runtime.evaluate will work
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      log.info('Runtime domain enabled');
    } catch (enableError) {
      log.error('Failed to enable Runtime domain:', enableError);
    }

    // Enable Page domain for navigation and screenshots
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      log.info('Page domain enabled');
    } catch (enableError) {
      log.error('Failed to enable Page domain:', enableError);
    }

    // Enable DOM domain for DOM operations
    try {
      await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
      log.info('DOM domain enabled');
    } catch (enableError) {
      log.error('Failed to enable DOM domain:', enableError);
    }
  }

  /**
   * Detach debugger from tab.
   */
  private async detachDebugger(): Promise<void> {
    if (!this.connectedTabId) {
      return;
    }

    // Always reset flag
    this.debuggerAttached = false;

    try {
      await chrome.debugger.detach({ tabId: this.connectedTabId });
      log.debug('Debugger detached');
    } catch (error) {
      // May already be detached
      log.warn('Failed to detach debugger:', error);
    }
  }

  /**
   * Reattach debugger to the connected tab.
   * Called when debugger is unexpectedly detached.
   */
  async reattachDebugger(): Promise<void> {
    if (!this.connectedTabId) {
      throw new Error('No tab connected');
    }

    // Mark as detached so attachDebugger will do full attach
    this.debuggerAttached = false;

    await this.attachDebugger(this.connectedTabId);
    log.info(`[TabManager] Debugger reattached to tab ${this.connectedTabId}`);
  }

  /**
   * Mark debugger as detached (called from onDetach listener).
   */
  markDebuggerDetached(): void {
    this.debuggerAttached = false;
  }

  /**
   * Send a debugger command to the connected tab.
   * Auto-reattaches debugger if it has been detached.
   */
  async sendDebuggerCommand<T>(
    method: string,
    params?: Record<string, unknown>,
    timeout: number = 25000 // 25 seconds default timeout (less than WS timeout of 30s)
  ): Promise<T> {
    if (!this.connectedTabId) {
      throw new Error('No tab connected');
    }

    // Check actual debugger state (not just our flag) and reattach if needed
    const attached = await this.isDebuggerAttached(this.connectedTabId);
    if (!attached) {
      log.warn(`[sendDebuggerCommand] Debugger detached, reattaching to tab ${this.connectedTabId}...`);
      await this.attachDebugger(this.connectedTabId);
    }

    log.debug(`[sendDebuggerCommand] Executing ${method}`, {
      tabId: this.connectedTabId,
      hasParams: params !== undefined,
    });

    // Wrap Chrome's debugger command in a timeout
    const commandPromise = chrome.debugger.sendCommand(
      { tabId: this.connectedTabId },
      method,
      params
    ) as Promise<T>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Debugger command timed out after ${timeout}ms: ${method}`));
      }, timeout);
    });

    try {
      const result = await Promise.race([commandPromise, timeoutPromise]);
      log.debug(`[sendDebuggerCommand] ${method} completed successfully`);
      return result;
    } catch (error) {
      log.error(`[sendDebuggerCommand] ${method} failed:`, error);
      throw error;
    }
  }

  /**
   * List all open tabs.
   * Only marks a tab as "active" if it's the active tab in the last focused normal window.
   */
  async listTabs(): Promise<TabInfo[]> {
    // Get the active tab in the last focused window (most reliable method)
    const [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const currentTabId = currentTab?.id;

    const tabs = await chrome.tabs.query({});

    return tabs.map(tab => ({
      id: tab.id!,
      url: tab.url || '',
      title: tab.title || '',
      // Only mark the specific current tab as active
      active: tab.id === currentTabId,
      connected: tab.id === this.connectedTabId,
    }));
  }

  /**
   * Create a new tab and optionally connect to it.
   */
  async createTab(url: string, connect = true): Promise<TabInfo> {
    const tab = await chrome.tabs.create({ url });

    if (connect && tab.id) {
      // Wait for tab to finish loading
      await this.waitForTabLoad(tab.id);
      await this.connectTab(tab.id);
    }

    return {
      id: tab.id!,
      url: tab.url || url,
      title: tab.title || '',
      active: tab.active,
      connected: connect && tab.id === this.connectedTabId,
    };
  }

  /**
   * Switch to a different tab.
   */
  async switchTab(tabId: number): Promise<void> {
    if (!await this.tabExists(tabId)) {
      throw new Error(`Tab ${tabId} does not exist`);
    }

    await this.connectTab(tabId);
    await chrome.tabs.update(tabId, { active: true });
  }

  /**
   * Close a tab.
   */
  async closeTab(tabId?: number): Promise<void> {
    const targetTabId = tabId || this.connectedTabId;

    if (!targetTabId) {
      throw new Error('No tab specified and no connected tab');
    }

    if (targetTabId === this.connectedTabId) {
      await this.disconnectTab();
    }

    await chrome.tabs.remove(targetTabId);
    log.info(`Closed tab: ${targetTabId}`);
  }

  /**
   * Wait for a tab to finish loading.
   */
  private waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
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
}
