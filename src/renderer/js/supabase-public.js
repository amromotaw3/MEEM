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
  const defaultKey = 'sb_publishable_hCdzzszncTGjIBGZYuoTNg_LZSnuHAw';
  safeAssign('SUPABASE_URL', defaultUrl);
  safeAssign('SUPABASE_ANON_KEY', defaultKey);
  safeAssign('MEDIAVAULT_SUPABASE_URL', window.SUPABASE_URL || defaultUrl);
  safeAssign('MEDIAVAULT_SUPABASE_ANON_KEY', window.SUPABASE_ANON_KEY || defaultKey);
  safeAssign('MEDIAVAULT_BACKEND_URL', 'https://mediavault-five.vercel.app');

})();
