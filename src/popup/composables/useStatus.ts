/**
 * Vue composable for tab connection status management.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Status, TabInfo } from '../types';
import { sendMessage } from './useChrome';

export function useStatus() {
  const status = ref<Status>({
    connected: false,
    tabId: null,
    tabs: [],
  });

  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  const connectedTab = computed<TabInfo | undefined>(() => {
    return status.value.tabs.find(t => t.connected);
  });

  const hasConnectedTab = computed<boolean>(() => {
    return !!connectedTab.value;
  });

  const validTabs = computed<TabInfo[]>(() => {
    return status.value.tabs.filter(tab => {
      if (!tab.url || tab.url === 'about:blank' || tab.url === 'chrome://newtab/') {
        return true;
      }
      return !tab.url.startsWith('chrome://') &&
             !tab.url.startsWith('chrome-extension://');
    });
  });

  const sortedTabs = computed<TabInfo[]>(() => {
    return [...validTabs.value].sort((a, b) => {
      if (a.connected && !b.connected) return -1;
      if (!a.connected && b.connected) return 1;
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return 0;
    });
  });

  async function refresh(): Promise<void> {
    try {
      status.value = await sendMessage<Status>('getStatus');
    } catch (e) {
      console.error('[useStatus] Failed to refresh:', e);
    }
  }

  async function connectTab(tabId: number, tabUrl?: string): Promise<void> {
    try {
      await sendMessage('connectTab', { tabId, tabUrl });
      await refresh();
    } catch (e) {
      console.error('[useStatus] Failed to connect:', e);
    }
  }

  async function disconnectTab(): Promise<void> {
    try {
      await sendMessage('disconnectTab');
      await refresh();
    } catch (e) {
      console.error('[useStatus] Failed to disconnect:', e);
    }
  }

  async function focusTab(): Promise<void> {
    const tab = connectedTab.value;
    if (tab?.id) {
      try {
        const fullTab = await chrome.tabs.get(tab.id);
        await chrome.tabs.update(tab.id, { active: true });
        if (fullTab.windowId) {
          await chrome.windows.update(fullTab.windowId, { focused: true });
        }
        window.close();
      } catch (e) {
        console.error('[useStatus] Failed to focus tab:', e);
      }
    }
  }

  onMounted(() => {
    refresh();
    refreshInterval = setInterval(refresh, 2000);
  });

  onUnmounted(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  return {
    status,
    connectedTab,
    hasConnectedTab,
    sortedTabs,
    refresh,
    connectTab,
    disconnectTab,
    focusTab,
  };
}
