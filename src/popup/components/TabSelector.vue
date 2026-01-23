<script setup lang="ts">
/**
 * Tab list for connecting to browser tabs.
 */
import type { TabInfo } from '../types';

const props = defineProps<{
  tabs: TabInfo[];
  authenticated: boolean;
}>();

const emit = defineEmits<{
  connect: [tabId: number, tabUrl: string];
}>();

function handleTabClick(tab: TabInfo) {
  if (!props.authenticated) return;
  emit('connect', tab.id, tab.url || '');
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + '...' : str;
}

const defaultFavicon = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23666%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>";
</script>

<template>
  <div class="tab-selector" :class="{ 'auth-required': !authenticated }">
    <div class="section-title">Connect to Tab</div>

    <div class="tab-list">
      <div v-if="tabs.length === 0" class="empty-state">
        No valid tabs available
      </div>

      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.connected }"
        @click="handleTabClick(tab)"
      >
        <img
          class="tab-favicon"
          :src="tab.favIconUrl || defaultFavicon"
          @error="($event.target as HTMLImageElement).src = defaultFavicon"
        >
        <span class="tab-title">{{ truncate(tab.title || 'Untitled', 30) }}</span>
        <span v-if="tab.connected" class="connected-badge">CONNECTED</span>
        <span v-else-if="tab.active" class="current-badge">CURRENT</span>
      </div>
    </div>

    <div v-if="!authenticated" class="auth-overlay">
      Sign in to connect
    </div>
  </div>
</template>

<style scoped>
.tab-selector {
  position: relative;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  letter-spacing: 0.8px;
}

.tab-list {
  max-height: 180px;
  overflow-y: auto;
}

.empty-state {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.tab-item:hover {
  background: var(--bg-elevated);
}

.tab-item.active {
  background: var(--accent-primary-dim);
  border-color: var(--accent-primary);
}

.tab-favicon {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  transition: box-shadow 0.15s ease;
}

.tab-item.active .tab-favicon {
  box-shadow: 0 0 0 2px var(--accent-success);
}

.tab-title {
  flex: 1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.connected-badge {
  font-size: 9px;
  padding: 3px 7px;
  background: var(--accent-success);
  color: var(--bg-deepest);
  border-radius: 20px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.current-badge {
  font-size: 9px;
  padding: 3px 7px;
  background: var(--accent-primary-dim);
  color: var(--accent-primary);
  border-radius: 20px;
  font-weight: 500;
  text-transform: uppercase;
}

.auth-required {
  opacity: 0.5;
  pointer-events: none;
}

.auth-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 12px;
  border-radius: var(--radius-md);
  opacity: 0.95;
}

.tab-selector:not(.auth-required) .auth-overlay {
  display: none;
}
</style>
