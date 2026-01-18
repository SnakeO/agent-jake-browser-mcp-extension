/**
 * Popup script for extension UI.
 * Manages tab connection UI.
 */

interface TabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
  connected: boolean;
  favIconUrl?: string;
}

interface Status {
  connected: boolean;
  tabId: number | null;
  tabs: TabInfo[];
}

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const tabList = document.getElementById('tabList')!;
const connectSection = document.getElementById('connectSection')!;
const connectedSection = document.getElementById('connectedSection')!;
const focusBtn = document.getElementById('focusBtn')!;
const disconnectBtn = document.getElementById('disconnectBtn')!;

/**
 * Send message to background script.
 */
async function sendMessage<T>(action: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response === undefined) {
        reject(new Error('No response from background script'));
      } else {
        resolve(response as T);
      }
    });
  });
}

/**
 * Update UI based on status.
 */
function updateUI(status: Status): void {
  const connectedTab = status.tabs.find(t => t.connected);

  if (connectedTab) {
    statusDot.className = status.connected ? 'status-dot connected' : 'status-dot tab-connected';
    statusText.textContent = status.connected
      ? `Connected to "${truncate(connectedTab.title, 25)}"`
      : `Tab connected, waiting for server...`;

    connectSection.style.display = 'none';
    connectedSection.style.display = 'block';
  } else {
    statusDot.className = 'status-dot';
    statusText.textContent = 'No tab connected';

    connectSection.style.display = 'block';
    connectedSection.style.display = 'none';
  }

  renderTabList(status.tabs);
}

/**
 * Render the list of available tabs.
 */
function renderTabList(tabs: TabInfo[]): void {
  const validTabs = tabs.filter(tab =>
    tab.url &&
    !tab.url.startsWith('chrome://') &&
    !tab.url.startsWith('chrome-extension://')
  );

  if (validTabs.length === 0) {
    tabList.innerHTML = '<div style="color: #666; font-size: 13px;">No valid tabs available</div>';
    return;
  }

  tabList.innerHTML = validTabs.map(tab => `
    <div class="tab-item ${tab.connected ? 'active' : ''}" data-tab-id="${tab.id}">
      <img
        class="tab-favicon"
        src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'}"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'"
      >
      <span class="tab-title">${escapeHtml(tab.title || 'Untitled')}</span>
      ${tab.connected ? '<span class="connected-badge">CONNECTED</span>' : ''}
    </div>
  `).join('');

  // Add click handlers
  tabList.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', async () => {
      const tabId = parseInt(item.getAttribute('data-tab-id')!, 10);
      await connectToTab(tabId);
    });
  });
}

/**
 * Connect to a tab.
 */
async function connectToTab(tabId: number): Promise<void> {
  try {
    await sendMessage('connectTab', { tabId });
    await refreshStatus();
  } catch (error) {
    console.error('Failed to connect:', error);
    statusText.textContent = `Error: ${(error as Error).message}`;
  }
}

/**
 * Disconnect from current tab.
 */
async function disconnect(): Promise<void> {
  try {
    await sendMessage('disconnectTab');
    await refreshStatus();
  } catch (error) {
    console.error('Failed to disconnect:', error);
  }
}

/**
 * Focus the connected tab.
 */
async function focusConnectedTab(): Promise<void> {
  const status = await sendMessage<Status>('getStatus');
  if (status.tabId) {
    await chrome.tabs.update(status.tabId, { active: true });
    window.close();
  }
}

/**
 * Refresh status from background.
 */
async function refreshStatus(): Promise<void> {
  try {
    const status = await sendMessage<Status>('getStatus');
    updateUI(status);
  } catch (error) {
    console.error('Failed to get status:', error);
    statusText.textContent = 'Error loading status';
  }
}

/**
 * Truncate string.
 */
function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + '...' : str;
}

/**
 * Escape HTML.
 */
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Event listeners
focusBtn.addEventListener('click', focusConnectedTab);
disconnectBtn.addEventListener('click', disconnect);

// Initial load
refreshStatus();

// Refresh every 2 seconds
setInterval(refreshStatus, 2000);
