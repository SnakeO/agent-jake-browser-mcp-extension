/**
 * Manages connected tab state and tab operations.
 * Tracks which tab is currently being automated.
 */

import { log } from '@/utils/logger';
import type { TabInfo } from '@/types/messages';

const STORAGE_KEY = 'connectedTabId';

export class TabManager {
  private connectedTabId: number | null = null;
  private debuggerAttached = false;

  /**
   * Initialize tab manager, restoring state from storage.
   */
  async initialize(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored[STORAGE_KEY]) {
      const tabId = stored[STORAGE_KEY] as number;
      // Verify tab still exists
      if (await this.tabExists(tabId)) {
        this.connectedTabId = tabId;
        log.info(`Restored connected tab: ${tabId}`);
      } else {
        await chrome.storage.local.remove(STORAGE_KEY);
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
   */
  async connectTab(tabId: number): Promise<void> {
    // Disconnect previous tab if any
    if (this.connectedTabId && this.connectedTabId !== tabId) {
      await this.disconnectTab();
    }

    // Verify tab exists
    if (!await this.tabExists(tabId)) {
      throw new Error(`Tab ${tabId} does not exist`);
    }

    // Attach debugger
    await this.attachDebugger(tabId);

    this.connectedTabId = tabId;
    await chrome.storage.local.set({ [STORAGE_KEY]: tabId });

    log.info(`Connected to tab: ${tabId}`);
  }

  /**
   * Disconnect from the current tab.
   */
  async disconnectTab(): Promise<void> {
    if (!this.connectedTabId) {
      return;
    }

    await this.detachDebugger();

    const tabId = this.connectedTabId;
    this.connectedTabId = null;
    await chrome.storage.local.remove(STORAGE_KEY);

    log.info(`Disconnected from tab: ${tabId}`);
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
   * Attach debugger to tab for input simulation.
   */
  private async attachDebugger(tabId: number): Promise<void> {
    if (this.debuggerAttached) {
      return;
    }

    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      this.debuggerAttached = true;
      log.debug(`Debugger attached to tab ${tabId}`);
    } catch (error) {
      // May already be attached
      if ((error as Error).message?.includes('Another debugger')) {
        log.warn('Debugger already attached by another client');
        this.debuggerAttached = true;
      } else {
        throw error;
      }
    }
  }

  /**
   * Detach debugger from tab.
   */
  private async detachDebugger(): Promise<void> {
    if (!this.debuggerAttached || !this.connectedTabId) {
      return;
    }

    try {
      await chrome.debugger.detach({ tabId: this.connectedTabId });
      this.debuggerAttached = false;
      log.debug('Debugger detached');
    } catch (error) {
      log.warn('Failed to detach debugger:', error);
    }
  }

  /**
   * Send a debugger command to the connected tab.
   */
  async sendDebuggerCommand<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!this.connectedTabId) {
      throw new Error('No tab connected');
    }

    if (!this.debuggerAttached) {
      await this.attachDebugger(this.connectedTabId);
    }

    return chrome.debugger.sendCommand(
      { tabId: this.connectedTabId },
      method,
      params
    ) as Promise<T>;
  }

  /**
   * List all open tabs.
   */
  async listTabs(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({});
    return tabs.map(tab => ({
      id: tab.id!,
      url: tab.url || '',
      title: tab.title || '',
      active: tab.active,
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
