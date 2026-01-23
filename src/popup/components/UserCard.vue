<script setup lang="ts">
/**
 * Signed-in user card with actions.
 */
import { computed } from 'vue';
import type { AuthUser } from '../types';

const props = defineProps<{
  user: AuthUser;
  connectionState?: string;
  statusMessage?: string;
  hasConnectedTab: boolean;
}>();

const emit = defineEmits<{
  logout: [];
  showTab: [];
  disconnect: [];
}>();

const initials = computed(() => {
  return props.user.name
    .split(' ')
    .map(n => n[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
});

const statusClass = computed(() => {
  const state = props.connectionState || 'disconnected';
  switch (state) {
    case 'connected': return 'online';
    case 'connecting':
    case 'reconnecting': return 'connecting';
    case 'failed': return 'error';
    default: return 'offline';
  }
});
</script>

<template>
  <div class="user-card">
    <div class="user-info">
      <div class="user-avatar">{{ initials }}</div>
      <div class="user-details">
        <div class="user-name">{{ user.name }}</div>
        <div class="user-email">{{ user.email }}</div>
      </div>
      <div class="user-actions-inline">
        <button
          class="btn-show-tab"
          :disabled="!hasConnectedTab"
          title="Show connected tab"
          @click="emit('showTab')"
        >
          Show Tab
        </button>
        <button
          class="btn-disconnect"
          :disabled="!hasConnectedTab"
          title="Disconnect from tab"
          @click="emit('disconnect')"
        >
          ×
        </button>
        <button
          class="btn-signout-icon"
          title="Sign out"
          @click="emit('logout')"
        >
          ⏻
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
  position: relative;
}

.user-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--accent-success), var(--accent-primary));
}

.user-info {
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-avatar {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 600;
  color: var(--bg-deepest);
  box-shadow: var(--glow-primary);
  text-transform: uppercase;
  flex-shrink: 0;
}

.user-details {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-email {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.user-actions-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.btn-show-tab {
  padding: 6px 10px;
  background: var(--accent-primary);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--bg-deepest);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.btn-show-tab:hover:not(:disabled) {
  box-shadow: var(--glow-primary);
}

.btn-show-tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.btn-disconnect {
  width: 24px;
  height: 24px;
  padding: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 14px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-disconnect:hover:not(:disabled) {
  background: var(--accent-danger-dim);
  border-color: var(--accent-danger);
  color: var(--accent-danger);
}

.btn-disconnect:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-signout-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-signout-icon:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
</style>
