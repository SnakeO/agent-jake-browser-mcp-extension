/**
 * Manages connected tab state and tab operations.
 * Tracks which tab is currently being automated.
 */

import { log } from '@/utils/logger';
import { logTab, logError } from './activity-log';
import type { TabInfo } from '@/types/messages';
import { DEBUGGER } from '@/constants';

export interface CdpStatus {
  connectedTabId: number | null;
  debuggerAttached: boolean;
  canExecuteCdp: boolean;
  lastCdpError: string | null;
}

export class TabManager {
  private connectedTabId: number | null = null;
  private debuggerAttached = false;
  private lastCdpError: string | null = null;
  private pendingNewTab: TabInfo | null = null;
  private newTabListener: ((tab: chrome.tabs.Tab) => void) | null = null;

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
        await this.setLiveConnectionCloseGuard(tabId, true);
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
   * Return live CDP readiness for diagnostics and preflight checks.
   * Attempts a self-heal attach when possible.
   */
  async getCdpStatus(): Promise<CdpStatus> {
    const tabId = this.connectedTabId;
    if (!tabId) {
      return {
        connectedTabId: null,
        debuggerAttached: false,
        canExecuteCdp: false,
        lastCdpError: this.lastCdpError ?? 'CDP_NOT_READY: No tab connected',
      };
    }

    let attached = await this.isDebuggerAttached(tabId);
    if (!attached) {
      try {
        await this.attachDebugger(tabId);
        attached = await this.isDebuggerAttached(tabId);
      } catch (error) {
        this.recordCdpError(error);
      }
    }

    if (!attached) {
      return {
        connectedTabId: tabId,
        debuggerAttached: false,
        canExecuteCdp: false,
        lastCdpError: this.lastCdpError ?? `CDP_NOT_READY: Debugger is not attached to tab ${tabId}`,
      };
    }

    const probe = await this.probeCdp(tabId);

    return {
      connectedTabId: tabId,
      debuggerAttached: true,
      canExecuteCdp: probe.ok,
      lastCdpError: probe.error,
    };
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
      await this.setLiveConnectionCloseGuard(tabId, true);

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
    await this.setLiveConnectionCloseGuard(tabId, false);

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
      this.lastCdpError = null;
      log.info(`Debugger attached to tab ${tabId}`);
    } catch (error) {
      // May already be attached by another client
      if ((error as Error).message?.includes('Another debugger')) {
        const typedError = new Error(`CDP_DEBUGGER_BUSY: ${(error as Error).message}`);
        this.debuggerAttached = false;
        this.recordCdpError(typedError);
        log.warn('Debugger already attached by another client');
        throw typedError;
      } else {
        log.error('Failed to attach debugger:', error);
        this.recordCdpError(error);
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
    for (const domain of ['Runtime', 'Page', 'DOM'] as const) {
      try {
        await chrome.debugger.sendCommand({ tabId }, `${domain}.enable`);
        log.info(`${domain} domain enabled`);
      } catch (enableError) {
        this.recordCdpError(enableError);
        throw new Error(`CDP_NOT_READY: Failed to enable ${domain} domain: ${(enableError as Error).message}`);
      }
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
    this.lastCdpError = 'CDP_DEBUGGER_DETACHED: Debugger detached unexpectedly';
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

    let retriedAfterDetach = false;

    while (true) {
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
        this.lastCdpError = null;
        log.debug(`[sendDebuggerCommand] ${method} completed successfully`);
        return result;
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        this.recordCdpError(error);
        log.error(`[sendDebuggerCommand] ${method} failed:`, error);

        if (message.includes('Debugger is not attached')) {
          if (retriedAfterDetach) {
            throw new Error(`CDP_NOT_READY: ${message}`);
          }

          retriedAfterDetach = true;
          await this.attachDebugger(this.connectedTabId);
          continue;
        }

        throw error;
      }
    }
  }

  private recordCdpError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastCdpError = message;
  }

  private async probeCdp(tabId: number): Promise<{ ok: true; error: null } | { ok: false; error: string }> {
    try {
      await chrome.debugger.sendCommand(
        { tabId },
        'Runtime.evaluate',
        { expression: '1+1', returnByValue: true }
      );
      this.lastCdpError = null;
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordCdpError(error);
      return { ok: false, error: message };
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
   * Re-apply live connection UI on the connected tab after page navigations/reloads.
   */
  async reapplyLiveConnectionUi(): Promise<void> {
    if (!this.connectedTabId) {
      return;
    }

    await this.setLiveConnectionCloseGuard(this.connectedTabId, true);
  }

  /**
   * Start listening for new tabs opened during an operation.
   * Call this before actions that might open new tabs (like clicks).
   */
  startNewTabDetection(): void {
    // Clear any previous state
    this.pendingNewTab = null;

    // Remove existing listener if any
    if (this.newTabListener) {
      chrome.tabs.onCreated.removeListener(this.newTabListener);
    }

    this.newTabListener = (tab: chrome.tabs.Tab) => {
      // Only track if we have a connected tab (automation in progress)
      // and it's not the connected tab itself
      if (this.connectedTabId && tab.id && tab.id !== this.connectedTabId) {
        log.info(`[NewTabDetection] New tab opened: ${tab.id}, url: ${tab.url || tab.pendingUrl || 'unknown'}`);
        this.pendingNewTab = {
          id: tab.id,
          url: tab.url || tab.pendingUrl || '',
          title: tab.title || '',
          active: tab.active,
          connected: false,
        };
      }
    };

    chrome.tabs.onCreated.addListener(this.newTabListener);
    log.debug('[NewTabDetection] Started listening for new tabs');
  }

  /**
   * Stop listening for new tabs and return any detected tab.
   * Returns the new tab info if one was detected, null otherwise.
   */
  stopNewTabDetection(): TabInfo | null {
    if (this.newTabListener) {
      chrome.tabs.onCreated.removeListener(this.newTabListener);
      this.newTabListener = null;
      log.debug('[NewTabDetection] Stopped listening for new tabs');
    }

    const newTab = this.pendingNewTab;
    this.pendingNewTab = null;

    if (newTab) {
      log.info(`[NewTabDetection] Returning detected new tab: ${newTab.id}`);
    }

    return newTab;
  }

  /**
   * Wait for a tab to finish loading.
   */
  public waitForTabLoad(tabId: number): Promise<void> {
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

  /**
   * Enable or disable a beforeunload confirmation prompt on the target tab.
   */
  private async setLiveConnectionCloseGuard(tabId: number, enabled: boolean): Promise<void> {
    const message = 'A live Agent Jake browser connection is active. Close this tab anyway?';

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [enabled, message],
        func: (guardEnabled: boolean, guardMessage: string) => {
          const stateKey = '__agentJakeLiveCloseGuardMessage';
          const handlerKey = '__agentJakeLiveCloseGuardHandler';
          const bannerKey = '__agentJakeLiveCloseGuardBanner';
          const bannerMoveHandlerKey = '__agentJakeLiveBannerMoveHandler';
          const overlayKey = '__agentJakeLiveCloseGuardOverlay';
          const dismissedKey = '__agentJakeLiveCloseGuardOverlayDismissed';
          const styleKey = '__agentJakeLiveCloseGuardStyle';
          const host = window as unknown as Record<string, unknown>;
          const showOverlay = () => {
            const overlay = host[overlayKey] as HTMLDivElement | undefined;
            if (!overlay) return;
            overlay.classList.remove('agent-jake-live-overlay-hidden');
            overlay.classList.add('agent-jake-live-overlay-visible');
          };

          const handler = (event: BeforeUnloadEvent) => {
            const value = host[stateKey];
            if (typeof value !== 'string' || value.length === 0) {
              return;
            }
            showOverlay();
            event.preventDefault();
            event.returnValue = value;
            return value;
          };

          const ensureUi = () => {
            let styleEl = host[styleKey] as HTMLStyleElement | undefined;
            if (!styleEl) {
              styleEl = document.createElement('style');
              styleEl.id = 'agent-jake-live-close-guard-style';
              styleEl.textContent = `
                .agent-jake-live-banner {
                  position: fixed;
                  top: 0;
                  left: 0;
                  right: 0;
                  z-index: 2147483647;
                  background: #111827;
                  color: #f9fafb;
                  border-bottom: 1px solid rgba(248, 113, 113, 0.7);
                  padding: 10px 14px;
                  text-align: center;
                  font: 600 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                  letter-spacing: 0.01em;
                  box-shadow: 0 3px 10px rgba(0,0,0,0.2);
                  pointer-events: none;
                  user-select: none;
                  transition: opacity 120ms ease, transform 120ms ease;
                }
                .agent-jake-live-banner-hidden {
                  opacity: 0;
                  transform: translateY(-100%);
                }
                .agent-jake-live-overlay {
                  position: fixed;
                  inset: 0;
                  z-index: 2147483646;
                  background: rgba(7, 11, 22, 0.86);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  opacity: 1;
                  visibility: visible;
                  pointer-events: auto;
                  transition: opacity 120ms ease;
                }
                .agent-jake-live-overlay-visible {
                  opacity: 1;
                  visibility: visible;
                }
                .agent-jake-live-overlay-hidden {
                  opacity: 0;
                  visibility: hidden;
                  pointer-events: none;
                }
                .agent-jake-live-overlay-card {
                  background: #111827;
                  color: #f9fafb;
                  border: 1px solid rgba(248, 113, 113, 0.75);
                  border-radius: 14px;
                  padding: 20px 24px;
                  min-width: 320px;
                  max-width: min(88vw, 560px);
                  text-align: center;
                  font: 600 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                  box-shadow: 0 16px 36px rgba(0,0,0,0.35);
                }
                .agent-jake-live-overlay-title {
                  font-size: 16px;
                  margin-bottom: 6px;
                }
                .agent-jake-live-overlay-copy {
                  font-weight: 500;
                  opacity: 0.9;
                  margin-bottom: 14px;
                }
                .agent-jake-live-overlay-button {
                  border: 0;
                  border-radius: 10px;
                  padding: 10px 14px;
                  font: 700 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                  background: #ef4444;
                  color: #fff;
                  cursor: pointer;
                }
              `;
              document.documentElement.appendChild(styleEl);
              host[styleKey] = styleEl;
            }

            let banner = host[bannerKey] as HTMLDivElement | undefined;
            if (!banner) {
              banner = document.createElement('div');
              banner.className = 'agent-jake-live-banner';
              banner.textContent = 'Agent Jake live connection active';
              document.documentElement.appendChild(banner);
              host[bannerKey] = banner;
            }

            if (typeof host[bannerMoveHandlerKey] !== 'function') {
              const onMove = (event: MouseEvent) => {
                const currentBanner = host[bannerKey] as HTMLDivElement | undefined;
                if (!currentBanner) {
                  return;
                }

                const hideThreshold = currentBanner.offsetHeight || 44;
                if (event.clientY <= hideThreshold) {
                  currentBanner.classList.add('agent-jake-live-banner-hidden');
                } else {
                  currentBanner.classList.remove('agent-jake-live-banner-hidden');
                }
              };
              host[bannerMoveHandlerKey] = onMove;
              window.addEventListener('mousemove', onMove, { passive: true });
            }

            let overlay = host[overlayKey] as HTMLDivElement | undefined;
            if (!overlay) {
              overlay = document.createElement('div');
              overlay.className = 'agent-jake-live-overlay agent-jake-live-overlay-visible';
              overlay.innerHTML = `
                <div class="agent-jake-live-overlay-card">
                  <div class="agent-jake-live-overlay-title">Live Agent Connection</div>
                  <div class="agent-jake-live-overlay-copy">This tab is currently connected for automation.</div>
                  <button type="button" class="agent-jake-live-overlay-button">Click here to interact with the page</button>
                </div>
              `;
              const button = overlay.querySelector('.agent-jake-live-overlay-button') as HTMLButtonElement | null;
              if (button) {
                button.addEventListener('click', () => {
                  host[dismissedKey] = true;
                  overlay?.classList.add('agent-jake-live-overlay-hidden');
                });
              }
              document.documentElement.appendChild(overlay);
              host[overlayKey] = overlay;
            }
          };

          if (guardEnabled) {
            host[stateKey] = guardMessage;
            ensureUi();
            host[dismissedKey] = false;
            showOverlay();
            if (typeof host[handlerKey] !== 'function') {
              host[handlerKey] = handler;
              window.addEventListener('beforeunload', handler);
            }
            return;
          }

          host[stateKey] = '';
          const existing = host[handlerKey];
          if (typeof existing === 'function') {
            window.removeEventListener('beforeunload', existing as EventListener);
          }
          host[handlerKey] = null;

          const banner = host[bannerKey] as HTMLDivElement | undefined;
          if (banner) {
            banner.remove();
          }
          host[bannerKey] = null;

          const moveHandler = host[bannerMoveHandlerKey];
          if (typeof moveHandler === 'function') {
            window.removeEventListener('mousemove', moveHandler as EventListener);
          }
          host[bannerMoveHandlerKey] = null;

          const overlay = host[overlayKey] as HTMLDivElement | undefined;
          if (overlay) {
            overlay.remove();
          }
          host[overlayKey] = null;

          host[dismissedKey] = null;

          const style = host[styleKey] as HTMLStyleElement | undefined;
          if (style) {
            style.remove();
          }
          host[styleKey] = null;
        },
      });
    } catch {
      // Best effort: restricted pages cannot be scripted.
    }
  }
}
