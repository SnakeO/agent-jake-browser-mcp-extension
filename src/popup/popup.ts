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

interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'connection' | 'tab' | 'tool' | 'error';
  action: string;
  description: string;
  details?: Record<string, unknown>;
  success: boolean;
  durationMs?: number;
}

interface ActivityLogResponse {
  activities: ActivityEntry[];
  total: number;
}

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const tabList = document.getElementById('tabList')!;
const connectSection = document.getElementById('connectSection')!;
const connectedSection = document.getElementById('connectedSection')!;
const focusBtn = document.getElementById('focusBtn')!;
const disconnectBtn = document.getElementById('disconnectBtn')!;

// Activity log elements
const activityLog = document.getElementById('activityLog')!;
const seeMoreBtn = document.getElementById('seeMoreBtn')!;
const activityTotal = document.getElementById('activityTotal')!;
const clearActivityBtn = document.getElementById('clearActivityBtn')!;
const refreshActivityBtn = document.getElementById('refreshActivityBtn')!;
const activityModal = document.getElementById('activityModal')!;
const modalClose = document.getElementById('modalClose')!;
const modalActivityLog = document.getElementById('modalActivityLog')!;
const filterBtns = document.querySelectorAll('.filter-btn');

// Activity state
let allActivities: ActivityEntry[] = [];
let currentFilter = 'all';
let displayedActivityIds: Set<string> = new Set();

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
 * Sorts tabs: connected first, then active (current) tab, then rest.
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

  // Sort: connected first, then active (current) tab, then rest
  const sortedTabs = [...validTabs].sort((a, b) => {
    // Connected tab always first
    if (a.connected && !b.connected) return -1;
    if (!a.connected && b.connected) return 1;
    // Active (current) tab next
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return 0;
  });

  tabList.innerHTML = sortedTabs.map(tab => {
    // Determine which badge to show (connected takes precedence)
    let badge = '';
    if (tab.connected) {
      badge = '<span class="connected-badge">CONNECTED</span>';
    } else if (tab.active) {
      badge = '<span class="current-badge">CURRENT</span>';
    }

    return `
      <div class="tab-item ${tab.connected ? 'active' : ''}" data-tab-id="${tab.id}">
        <img
          class="tab-favicon"
          src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'}"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'"
        >
        <span class="tab-title">${escapeHtml(tab.title || 'Untitled')}</span>
        ${badge}
      </div>
    `;
  }).join('');

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

/**
 * Format timestamp to time string.
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format duration.
 */
function formatDuration(ms?: number): string {
  if (ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Render a single activity entry.
 * @param entry The activity entry to render
 * @param options.expanded Whether to show details expanded
 * @param options.animate Whether to apply slide-in animation
 */
function renderActivityEntry(
  entry: ActivityEntry,
  options: { expanded?: boolean; animate?: boolean } = {}
): string {
  const { expanded = false, animate = true } = options;
  const statusClass = entry.success ? 'success' : 'error';
  const statusIcon = entry.success ? '✓' : '✕';
  const details = entry.details ? JSON.stringify(entry.details, null, 2) : null;
  const animateClass = animate ? '' : 'no-animate';
  const durationText = entry.durationMs !== undefined ? formatDuration(entry.durationMs) : '';

  return `
    <div class="activity-entry ${statusClass} ${expanded ? 'expanded' : ''} ${animateClass}"
         data-type="${entry.type}"
         data-id="${entry.id}">
      <div class="activity-header">
        <span class="activity-time">${formatTime(entry.timestamp)}</span>
        <span class="activity-type">${entry.type}</span>
        <span class="activity-spacer"></span>
        <span class="activity-icon">${statusIcon}</span>
        ${durationText ? `<span class="activity-duration">${durationText}</span>` : ''}
      </div>
      <div class="activity-desc">${escapeHtml(entry.description)}</div>
      ${details ? `<div class="activity-details">${escapeHtml(details)}</div>` : ''}
    </div>
  `;
}

/**
 * Fetch and render activity log (latest 5).
 */
async function refreshActivityLog(): Promise<void> {
  try {
    const response = await sendMessage<ActivityLogResponse>('getActivity', { limit: 5 });

    // Handle case where response might not have expected shape
    const activities = response?.activities ?? [];
    const total = response?.total ?? 0;

    // Check if entries have changed
    const newIds = new Set(activities.map(e => e.id));
    const hasChanges = activities.length !== displayedActivityIds.size ||
      activities.some(e => !displayedActivityIds.has(e.id));

    // Skip re-render if nothing changed
    if (!hasChanges && allActivities.length > 0) {
      return;
    }

    allActivities = activities;

    // Render entries, only animating new ones
    activityLog.innerHTML = activities.length > 0
      ? activities.map(e => renderActivityEntry(e, {
          animate: !displayedActivityIds.has(e.id)
        })).join('')
      : '';

    // Update tracked IDs
    displayedActivityIds = newIds;

    // Show/hide "See More" button
    if (total > 5) {
      seeMoreBtn.style.display = 'block';
      activityTotal.textContent = String(total);
    } else {
      seeMoreBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to fetch activity:', error);
    // On error, show empty state instead of error message (less alarming on first load)
    allActivities = [];
    activityLog.innerHTML = '';
    seeMoreBtn.style.display = 'none';
  }
}

/**
 * Fetch all activities for modal.
 */
async function fetchAllActivities(): Promise<void> {
  try {
    const response = await sendMessage<ActivityLogResponse>('getActivity');
    allActivities = response.activities;
    renderModalActivities();
  } catch (error) {
    console.error('Failed to fetch all activities:', error);
  }
}

/**
 * Render activities in the modal based on current filter.
 */
function renderModalActivities(): void {
  const filtered = currentFilter === 'all'
    ? allActivities
    : allActivities.filter(e => e.type === currentFilter);

  // No animation in modal - too many entries
  modalActivityLog.innerHTML = filtered.map(e => renderActivityEntry(e, { animate: false })).join('');

  // Add click handlers for expanding details
  modalActivityLog.querySelectorAll('.activity-entry').forEach(entry => {
    entry.addEventListener('click', () => {
      entry.classList.toggle('expanded');
    });
  });
}

/**
 * Open activity modal.
 */
function openActivityModal(): void {
  activityModal.classList.add('open');
  fetchAllActivities();
}

/**
 * Close activity modal.
 */
function closeActivityModal(): void {
  activityModal.classList.remove('open');
}

/**
 * Clear activity log.
 */
async function clearActivity(): Promise<void> {
  try {
    await sendMessage('clearActivity');
    // Reset tracked IDs so new entries will animate
    displayedActivityIds = new Set();
    await refreshActivityLog();
    if (activityModal.classList.contains('open')) {
      modalActivityLog.innerHTML = '';
      allActivities = [];
    }
  } catch (error) {
    console.error('Failed to clear activity:', error);
  }
}

/**
 * Set filter and re-render modal.
 */
function setFilter(filter: string): void {
  currentFilter = filter;
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
  });
  renderModalActivities();
}

// Event listeners
focusBtn.addEventListener('click', focusConnectedTab);
disconnectBtn.addEventListener('click', disconnect);

// Activity event listeners
clearActivityBtn.addEventListener('click', clearActivity);
refreshActivityBtn.addEventListener('click', refreshActivityLog);
seeMoreBtn.addEventListener('click', openActivityModal);
modalClose.addEventListener('click', closeActivityModal);

// Close modal on overlay click
activityModal.addEventListener('click', (e) => {
  if (e.target === activityModal) {
    closeActivityModal();
  }
});

// Filter buttons
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.getAttribute('data-filter') || 'all';
    setFilter(filter);
  });
});

// Initial load
refreshStatus();
refreshActivityLog();

// Refresh every 2 seconds
setInterval(refreshStatus, 2000);
setInterval(refreshActivityLog, 2000);
