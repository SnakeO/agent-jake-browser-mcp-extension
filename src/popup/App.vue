<script setup lang="ts">
/**
 * Root Vue component for extension popup.
 * Uses Pinia stores for centralized state management.
 */
import { onMounted, onUnmounted } from 'vue';
import { useAuthStore, useStatusStore, useActivityStore } from './stores';
import AuthForm from './components/AuthForm.vue';
import UserCard from './components/UserCard.vue';
import ConnectionStatus from './components/ConnectionStatus.vue';
import TabSelector from './components/TabSelector.vue';
import ActivityLog from './components/ActivityLog.vue';
import ActivityModal from './components/ActivityModal.vue';

const auth = useAuthStore();
const status = useStatusStore();
const activity = useActivityStore();

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

    <!-- Connection Status Panel -->
    <ConnectionStatus />

    <!-- Tab Connection Section -->
    <div class="section">
      <TabSelector />
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
  margin-bottom: 16px;
}

.section {
  margin-top: 16px;
  margin-bottom: 16px;
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
