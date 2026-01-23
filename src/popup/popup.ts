/**
 * Popup script for extension UI.
 * Manages authentication and tab connection UI.
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

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isConnected: boolean;
  /** Detailed connection state */
  connectionState?: string;
  /** User-friendly status message */
  statusMessage?: string;
  /** Number of reconnect attempts */
  reconnectAttempt?: number;
  /** Last error if any */
  lastError?: string | null;
}

interface AuthUser {
  id: number;
  name: string;
  email: string;
}

interface LoginResponse {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
}

interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'connection' | 'tab' | 'tool' | 'error' | 'auth';
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

// Auth elements
const authSection = document.getElementById('authSection')!;
const authForm = document.getElementById('authForm')!;
const authSignedIn = document.getElementById('authSignedIn')!;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const signinBtn = document.getElementById('signinBtn')!;
const signoutBtn = document.getElementById('signoutBtn')!;
const userNameEl = document.getElementById('userName')!;
const userEmailEl = document.getElementById('userEmail')!;
const userAvatarEl = document.getElementById('userAvatar')!;
const connectionStatusEl = document.getElementById('connectionStatus')!;
const authError = document.getElementById('authError')!;

// Tab control elements
const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const tabList = document.getElementById('tabList')!;
const connectSection = document.getElementById('connectSection')!;
const connectedSection = document.getElementById('connectedSection')!;
const focusBtn = document.getElementById('focusBtn')!;
const disconnectBtn = document.getElementById('disconnectBtn')!;
const showTabBtn = document.getElementById('showTabBtn') as HTMLButtonElement;
const disconnectInlineBtn = document.getElementById('disconnectInlineBtn') as HTMLButtonElement;

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

// State
let allActivities: ActivityEntry[] = [];
let currentFilter = 'all';
let displayedActivityIds: Set<string> = new Set();
let currentAuthState: AuthState = {
  isAuthenticated: false,
  user: null,
  isConnected: false,
};

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

// ==================== AUTH FUNCTIONS ====================

/**
 * Get current auth state from background.
 */
async function refreshAuthState(): Promise<void> {
  try {
    const state = await sendMessage<AuthState>('getAuthState');
    currentAuthState = state;
    updateAuthUI(state);
  } catch (error) {
    console.error('Failed to get auth state:', error);
  }
}

/**
 * Update auth UI based on state.
 */
function updateAuthUI(state: AuthState): void {
  if (state.isAuthenticated && state.user) {
    // Show signed-in state
    authForm.style.display = 'none';
    authSignedIn.style.display = 'block';

    // Update user info (with defensive checks)
    const userName = state.user.name || 'User';
    const userEmail = state.user.email || '';
    userNameEl.textContent = userName;
    userEmailEl.textContent = userEmail;

    // Generate avatar initials (with fallback)
    const initials = userName
      .split(' ')
      .map(n => n[0])
      .filter(Boolean)
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?';
    userAvatarEl.textContent = initials;

    // Update connection status with detailed state
    updateConnectionStatus(state);

    // Enable tab controls
    connectSection.classList.add('authenticated');
  } else {
    // Show sign-in form
    authForm.style.display = 'block';
    authSignedIn.style.display = 'none';

    // Disable tab controls
    connectSection.classList.remove('authenticated');
  }

  // Hide any previous errors
  authError.style.display = 'none';
}

/**
 * Handle sign-in form submission.
 */
async function handleSignIn(e: Event): Promise<void> {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showAuthError('Please enter email and password');
    return;
  }

  // Show loading state
  signinBtn.classList.add('loading');
  signinBtn.setAttribute('disabled', 'true');
  authError.style.display = 'none';

  try {
    const response = await sendMessage<LoginResponse>('login', { email, password });

    if (response.success) {
      // Clear form
      emailInput.value = '';
      passwordInput.value = '';

      // Refresh auth state to update UI
      await refreshAuthState();
    } else {
      showAuthError(response.error || 'Login failed');
    }
  } catch (error) {
    showAuthError((error as Error).message || 'Connection error');
  } finally {
    signinBtn.classList.remove('loading');
    signinBtn.removeAttribute('disabled');
  }
}

/**
 * Handle sign-out button click.
 */
async function handleSignOut(): Promise<void> {
  try {
    await sendMessage('logout');
    await refreshAuthState();
  } catch (error) {
    console.error('Failed to sign out:', error);
  }
}

/**
 * Update connection status display with detailed state.
 */
function updateConnectionStatus(state: AuthState): void {
  // Use the detailed status message if available
  const statusMessage = state.statusMessage || (state.isConnected ? 'Connected to server' : 'Disconnected');
  connectionStatusEl.textContent = statusMessage;

  // Remove all state classes
  connectionStatusEl.classList.remove('online', 'offline', 'connecting', 'error');

  // Add appropriate class based on connection state
  const connState = state.connectionState || 'disconnected';
  switch (connState) {
    case 'connected':
      connectionStatusEl.classList.add('online');
      break;
    case 'connecting':
    case 'reconnecting':
      connectionStatusEl.classList.add('connecting');
      break;
    case 'failed':
      connectionStatusEl.classList.add('error');
      break;
    case 'offline':
    case 'disconnected':
    default:
      connectionStatusEl.classList.add('offline');
      break;
  }

  // Show reconnect attempt count if reconnecting
  if (state.reconnectAttempt && state.reconnectAttempt > 0 && connState === 'reconnecting') {
    connectionStatusEl.title = `Attempt ${state.reconnectAttempt}`;
  } else {
    connectionStatusEl.title = '';
  }
}

/**
 * Show authentication error.
 */
function showAuthError(message: string): void {
  authError.textContent = message;
  authError.style.display = 'block';
}

// ==================== TAB FUNCTIONS ====================

/**
 * Update tab UI based on status.
 */
function updateTabUI(status: Status): void {
  const connectedTab = status.tabs.find(t => t.connected);

  if (connectedTab) {
    statusDot.className = status.connected ? 'status-dot connected' : 'status-dot tab-connected';
    statusText.textContent = status.connected
      ? `Connected to "${truncate(connectedTab.title, 25)}"`
      : `Tab connected, waiting for server...`;

    connectSection.querySelector('.tab-selector')?.classList.add('hidden');
    connectedSection.style.display = 'block';

    // Enable inline buttons when connected
    if (showTabBtn) showTabBtn.disabled = false;
    if (disconnectInlineBtn) disconnectInlineBtn.disabled = false;
  } else {
    statusDot.className = 'status-dot';
    statusText.textContent = 'No tab connected';

    connectSection.querySelector('.tab-selector')?.classList.remove('hidden');
    connectedSection.style.display = 'none';

    // Disable inline buttons when not connected
    if (showTabBtn) showTabBtn.disabled = true;
    if (disconnectInlineBtn) disconnectInlineBtn.disabled = true;
  }

  renderTabList(status.tabs);
}

/**
 * Render the list of available tabs.
 */
function renderTabList(tabs: TabInfo[]): void {
  const validTabs = tabs.filter(tab => {
    if (!tab.url || tab.url === 'about:blank' || tab.url === 'chrome://newtab/') {
      return true;
    }
    return !tab.url.startsWith('chrome://') &&
           !tab.url.startsWith('chrome-extension://');
  });

  if (validTabs.length === 0) {
    tabList.innerHTML = '<div class="empty-state">No valid tabs available</div>';
    return;
  }

  const sortedTabs = [...validTabs].sort((a, b) => {
    if (a.connected && !b.connected) return -1;
    if (!a.connected && b.connected) return 1;
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return 0;
  });

  tabList.innerHTML = sortedTabs.map(tab => {
    let badge = '';
    if (tab.connected) {
      badge = '<span class="connected-badge">CONNECTED</span>';
    } else if (tab.active) {
      badge = '<span class="current-badge">CURRENT</span>';
    }

    return `
      <div class="tab-item ${tab.connected ? 'active' : ''}" data-tab-id="${tab.id}" data-tab-url="${tab.url || ''}">
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

  tabList.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', async () => {
      if (!currentAuthState.isAuthenticated) {
        showAuthError('Please sign in first');
        return;
      }
      const tabId = parseInt(item.getAttribute('data-tab-id')!, 10);
      const tabUrl = item.getAttribute('data-tab-url') || '';
      await connectToTab(tabId, tabUrl);
    });
  });
}

/**
 * Connect to a tab.
 */
async function connectToTab(tabId: number, tabUrl?: string): Promise<void> {
  try {
    await sendMessage('connectTab', { tabId, tabUrl });
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
    const tab = await chrome.tabs.get(status.tabId);
    await chrome.tabs.update(status.tabId, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    window.close();
  }
}

/**
 * Refresh status from background.
 */
async function refreshStatus(): Promise<void> {
  try {
    const status = await sendMessage<Status>('getStatus');
    updateTabUI(status);
  } catch (error) {
    console.error('Failed to get status:', error);
    statusText.textContent = 'Error loading status';
  }
}

// ==================== ACTIVITY LOG FUNCTIONS ====================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

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

async function refreshActivityLog(): Promise<void> {
  try {
    const response = await sendMessage<ActivityLogResponse>('getActivity', { limit: 5 });
    const activities = response?.activities ?? [];
    const total = response?.total ?? 0;

    const newIds = new Set(activities.map(e => e.id));
    const hasChanges = activities.length !== displayedActivityIds.size ||
      activities.some(e => !displayedActivityIds.has(e.id));

    if (!hasChanges && activities.length === allActivities.length) {
      return;
    }

    allActivities = activities;

    activityLog.innerHTML = activities.length > 0
      ? activities.map(e => renderActivityEntry(e, {
          animate: !displayedActivityIds.has(e.id)
        })).join('')
      : '';

    displayedActivityIds = newIds;

    if (total > 5) {
      seeMoreBtn.style.display = 'block';
      activityTotal.textContent = String(total);
    } else {
      seeMoreBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to fetch activity:', error);
    allActivities = [];
    activityLog.innerHTML = '';
    seeMoreBtn.style.display = 'none';
  }
}

async function fetchAllActivities(): Promise<void> {
  try {
    const response = await sendMessage<ActivityLogResponse>('getActivity');
    allActivities = response.activities;
    renderModalActivities();
  } catch (error) {
    console.error('Failed to fetch all activities:', error);
  }
}

function renderModalActivities(): void {
  const filtered = currentFilter === 'all'
    ? allActivities
    : allActivities.filter(e => e.type === currentFilter);

  modalActivityLog.innerHTML = filtered.map(e => renderActivityEntry(e, { animate: false })).join('');

  modalActivityLog.querySelectorAll('.activity-entry').forEach(entry => {
    entry.addEventListener('click', () => {
      entry.classList.toggle('expanded');
    });
  });
}

function openActivityModal(): void {
  activityModal.classList.add('open');
  fetchAllActivities();
}

function closeActivityModal(): void {
  activityModal.classList.remove('open');
}

async function clearActivity(): Promise<void> {
  try {
    await sendMessage('clearActivity');
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

function setFilter(filter: string): void {
  currentFilter = filter;
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
  });
  renderModalActivities();
}

// ==================== UTILITIES ====================

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + '...' : str;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== EVENT LISTENERS ====================

// Auth events
authForm.querySelector('form')?.addEventListener('submit', handleSignIn);
signinBtn.addEventListener('click', handleSignIn);
signoutBtn.addEventListener('click', handleSignOut);

// Tab events
focusBtn.addEventListener('click', focusConnectedTab);
disconnectBtn.addEventListener('click', disconnect);

// Inline user action buttons
showTabBtn?.addEventListener('click', async () => {
  const status = await sendMessage<Status>('getStatus');
  const connectedTab = status?.tabs?.find(t => t.connected);
  if (connectedTab?.id) {
    const tab = await chrome.tabs.get(connectedTab.id);
    await chrome.tabs.update(connectedTab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    window.close();
  }
});

disconnectInlineBtn?.addEventListener('click', async () => {
  await sendMessage('disconnectTab');
  await refreshStatus();
});

// Activity events
clearActivityBtn.addEventListener('click', clearActivity);
refreshActivityBtn.addEventListener('click', refreshActivityLog);
seeMoreBtn.addEventListener('click', openActivityModal);
modalClose.addEventListener('click', closeActivityModal);

activityModal.addEventListener('click', (e) => {
  if (e.target === activityModal) {
    closeActivityModal();
  }
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.getAttribute('data-filter') || 'all';
    setFilter(filter);
  });
});

// Handle Enter key in password field
passwordInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleSignIn(e);
  }
});

// ==================== INITIALIZATION ====================

async function init(): Promise<void> {
  // Load auth state first
  await refreshAuthState();

  // Then load tab status and activity
  await Promise.all([
    refreshStatus(),
    refreshActivityLog(),
  ]);
}

// Initialize
init();

// Refresh periodically
setInterval(refreshStatus, 2000);
setInterval(refreshActivityLog, 2000);
setInterval(refreshAuthState, 5000); // Check auth state less frequently
