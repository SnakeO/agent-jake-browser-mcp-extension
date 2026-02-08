/**
 * Pusher polyfills for Chrome extension service worker compatibility.
 * Service workers don't have window.location or localStorage.
 * Must be imported before creating Echo instances.
 */

import Pusher from 'pusher-js';

// Make Pusher available globally for Laravel Echo
(globalThis as Record<string, unknown>).Pusher = Pusher;

// Patch Pusher.Runtime for service worker compatibility
const originalGetProtocol = Pusher.Runtime.getProtocol;
Pusher.Runtime.getProtocol = function() {
  try {
    return originalGetProtocol.call(this);
  } catch {
    return 'ws:';
  }
};

const originalGetLocalStorage = Pusher.Runtime.getLocalStorage;
Pusher.Runtime.getLocalStorage = function() {
  try {
    return originalGetLocalStorage.call(this);
  } catch {
    return undefined;
  }
};
