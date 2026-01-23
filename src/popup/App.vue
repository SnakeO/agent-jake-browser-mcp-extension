<script setup lang="ts">
/**
 * Root Vue component for extension popup.
 * Uses Pinia stores for centralized state management.
 */
import { onMounted, onUnmounted } from 'vue';
import { useAuthStore, useStatusStore, useActivityStore } from './stores';
import AuthForm from './components/AuthForm.vue';
import UserCard from './components/UserCard.vue';
import TabSelector from './components/TabSelector.vue';
import ActivityLog from './components/ActivityLog.vue';
import ActivityModal from './components/ActivityModal.vue';

const auth = useAuthStore();
const status = useStatusStore();
const activity = useActivityStore();

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + '...' : str;
}

onMounted(() => {
  auth.startPolling();
  status.startPolling();
  activity.startPolling();
});

onUnmounted(() => {
  auth.stopPolling();
  status.stopPolling();
  activity.stopPolling();
});
</script>

<template>
  <div class="container">
    <!-- Auth Section -->
    <div class="auth-section">
      <AuthForm v-if="!auth.state.isAuthenticated" />
      <UserCard v-else />
    </div>

    <!-- Status Bar -->
    <div class="status">
      <div
        class="status-dot"
        :class="{
          connected: status.status.connected,
          'tab-connected': status.hasConnectedTab && !status.status.connected
        }"
      ></div>
      <span class="status-text">
        <template v-if="status.connectedTab">
          {{ status.status.connected
            ? `Connected to "${truncate(status.connectedTab.title, 25)}"`
            : 'Tab connected, waiting for server...'
          }}
        </template>
        <template v-else>
          No tab connected
        </template>
      </span>
    </div>

    <!-- Tab Connection Section -->
    <div class="section">
      <TabSelector />
    </div>

    <!-- Connected Tab Actions -->
    <div v-if="status.hasConnectedTab" class="section">
      <button class="btn btn-secondary" @click="status.focusTab">
        Focus Connected Tab
      </button>
      <button class="btn btn-danger" @click="status.disconnectTab">
        Disconnect
      </button>
    </div>

    <!-- Activity Log -->
    <ActivityLog />

    <!-- Activity Modal -->
    <ActivityModal />

    <!-- Footer -->
    <div class="footer">
      WebSocket: localhost:8765 · Reverb: localhost:8085 ·
      <a href="https://github.com/SnakeO/agent-jake-browser-mcp-extension" target="_blank">Docs</a>
    </div>
  </div>
</template>

<style scoped>
.container {
  padding: 20px;
  background: var(--bg-deep);
  min-height: 100vh;
}

.auth-section {
  margin-bottom: 20px;
}

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
  border: 1px solid var(--border-subtle);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: all 0.3s ease;
}

.status-dot.connected {
  background: var(--accent-success);
  box-shadow: var(--glow-success);
}

.status-dot.tab-connected {
  background: var(--accent-warning);
}

.status-text {
  font-size: 12px;
  color: var(--text-secondary);
  flex: 1;
}

.section {
  margin-bottom: 16px;
}

.btn {
  display: block;
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 8px;
}

.btn-secondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.btn-danger {
  background: var(--accent-danger);
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
}

.footer {
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
  font-family: var(--font-mono);
}

.footer a {
  color: var(--accent-primary);
  text-decoration: none;
  transition: color 0.15s ease;
}

.footer a:hover {
  color: var(--text-primary);
}
</style>
