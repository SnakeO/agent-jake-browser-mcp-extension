/**
 * Vue composable for activity log management.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { ActivityEntry, ActivityLogResponse, ActivityType } from '../types';
import { sendMessage } from './useChrome';

export function useActivity() {
  const activities = ref<ActivityEntry[]>([]);
  const total = ref(0);
  const filter = ref<'all' | ActivityType>('all');
  const modalOpen = ref(false);

  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  const filtered = computed<ActivityEntry[]>(() => {
    if (filter.value === 'all') return activities.value;
    return activities.value.filter(a => a.type === filter.value);
  });

  const hasMore = computed<boolean>(() => {
    return total.value > 5;
  });

  async function refresh(limit = 5): Promise<void> {
    try {
      const response = await sendMessage<ActivityLogResponse>('getActivity', { limit });
      activities.value = response?.activities ?? [];
      total.value = response?.total ?? 0;
    } catch (e) {
      console.error('[useActivity] Failed to refresh:', e);
      activities.value = [];
      total.value = 0;
    }
  }

  async function fetchAll(): Promise<void> {
    try {
      const response = await sendMessage<ActivityLogResponse>('getActivity');
      activities.value = response?.activities ?? [];
      total.value = response?.total ?? 0;
    } catch (e) {
      console.error('[useActivity] Failed to fetch all:', e);
    }
  }

  async function clear(): Promise<void> {
    try {
      await sendMessage('clearActivity');
      await refresh();
    } catch (e) {
      console.error('[useActivity] Failed to clear:', e);
    }
  }

  function setFilter(newFilter: 'all' | ActivityType): void {
    filter.value = newFilter;
  }

  function openModal(): void {
    modalOpen.value = true;
    fetchAll();
  }

  function closeModal(): void {
    modalOpen.value = false;
  }

  onMounted(() => {
    refresh();
    refreshInterval = setInterval(() => refresh(), 2000);
  });

  onUnmounted(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  return {
    activities,
    total,
    filter,
    filtered,
    hasMore,
    modalOpen,
    refresh,
    fetchAll,
    clear,
    setFilter,
    openModal,
    closeModal,
  };
}
