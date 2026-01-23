/**
 * Vue composable for authentication state management.
 */

import { ref, onMounted, onUnmounted } from 'vue';
import type { AuthState, LoginResponse } from '../types';
import { sendMessage } from './useChrome';

export function useAuth() {
  const state = ref<AuthState>({
    isAuthenticated: false,
    user: null,
    isConnected: false,
  });
  const loading = ref(false);
  const error = ref<string | null>(null);

  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      state.value = await sendMessage<AuthState>('getAuthState');
    } catch (e) {
      console.error('[useAuth] Failed to refresh:', e);
    }
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await sendMessage<LoginResponse>('login', { email, password });

      if (result.success) {
        await refresh();
        return true;
      } else {
        error.value = result.error || 'Login failed';
        return false;
      }
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await sendMessage('logout');
      await refresh();
    } catch (e) {
      console.error('[useAuth] Failed to logout:', e);
    }
  }

  onMounted(() => {
    refresh();
    refreshInterval = setInterval(refresh, 5000);
  });

  onUnmounted(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  return {
    state,
    loading,
    error,
    login,
    logout,
    refresh,
  };
}
