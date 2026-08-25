/**
 * Public Supabase credentials for web/Android renderer (anon/publishable keys only).
 * Keep in sync with .env — these values are safe to expose in the client.
 */
(function () {
  'use strict';
  function safeAssign(name, fallback) {
    if (window[name]) return;
    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (desc && desc.writable === false) return;
    try {
      window[name] = fallback;
    } catch (_) { /* Electron preload exposes read-only copies */ }
  }
  const defaultUrl = 'https://vvjnkgdrhyxilnderjdy.supabase.co';
  const defaultKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2am5rZ2RyaHl4aWxuZGVyamR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTM2ODEsImV4cCI6MjA5NDg4OTY4MX0.Rb1OLJGXDToYZz-8h_gy2UNx_ou0P6BwGXc1ExFWSCU';
  safeAssign('SUPABASE_URL', defaultUrl);
  safeAssign('SUPABASE_ANON_KEY', defaultKey);
  safeAssign('MEDIAVAULT_SUPABASE_URL', window.SUPABASE_URL || defaultUrl);
  safeAssign('MEDIAVAULT_SUPABASE_ANON_KEY', window.SUPABASE_ANON_KEY || defaultKey);
  safeAssign('MEDIAVAULT_BACKEND_URL', 'https://meem-watch.vercel.app');
  safeAssign('MEEM_BACKEND_URL', 'https://meem-watch.vercel.app');

})();
