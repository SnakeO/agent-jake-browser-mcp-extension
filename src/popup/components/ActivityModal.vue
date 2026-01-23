<script setup lang="ts">
/**
 * Full activity log modal with filters.
 */
import type { ActivityEntry, ActivityType } from '../types';
import ActivityEntryComponent from './ActivityEntry.vue';

const props = defineProps<{
  open: boolean;
  activities: ActivityEntry[];
  filter: 'all' | ActivityType;
}>();

const emit = defineEmits<{
  close: [];
  setFilter: [filter: 'all' | ActivityType];
}>();

const filters: Array<{ value: 'all' | ActivityType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'auth', label: 'Auth' },
  { value: 'connection', label: 'Connection' },
  { value: 'tab', label: 'Tab' },
  { value: 'tool', label: 'Tool' },
  { value: 'error', label: 'Error' },
];

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit('close');
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-overlay"
      @click="handleBackdropClick"
    >
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">Activity Log</div>
          <button class="modal-close" @click="emit('close')">×</button>
        </div>

        <div class="modal-filters">
          <button
            v-for="f in filters"
            :key="f.value"
            class="filter-btn"
            :class="{ active: filter === f.value }"
            @click="emit('setFilter', f.value)"
          >
            {{ f.label }}
          </button>
        </div>

        <div class="modal-body">
          <div v-if="activities.length === 0" class="empty-state">
            No activity found
          </div>
          <ActivityEntryComponent
            v-for="entry in activities"
            :key="entry.id"
            :entry="entry"
            :expandable="true"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  width: 100%;
  max-height: 80%;
  background: var(--bg-deep);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border: 1px solid var(--border-subtle);
  border-bottom: none;
  animation: modalSlideUp 0.25s ease-out;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
  transition: color 0.15s ease;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-filters {
  display: flex;
  gap: 6px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
}

.filter-btn {
  padding: 6px 12px;
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 20px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.filter-btn:hover {
  color: var(--text-primary);
}

.filter-btn.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: var(--bg-deepest);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>
