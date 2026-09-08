const PatreonService = require('../PatreonService');

function getStore() {
  return require('../store');
}

function initPatreonIpc(ipcMain) {
  ipcMain.handle('patreon-connect', async () => {
    try {
      console.log('[Patreon IPC] Starting Patreon connect flow...');
      const authResult = await PatreonService.startPatreonAuth();
      if (!authResult || !authResult.success) {
        return authResult || { success: false, error: 'Authorization failed' };
      }

      if (authResult.isPatron && authResult.expiresAt) {
        const store = getStore();
        const appSession = store.getInMemorySession() || {};
        const userId = appSession.user?.id;
        const userEmail = appSession.user?.email;

        // 1. Update local session & appData
        if (!appSession.user) appSession.user = {};
        appSession.user.subscription_expires_at = authResult.expiresAt;
        appSession.subscription_expires_at = authResult.expiresAt;
        appSession.user.patreon = authResult.patreonUser;
        store.saveInMemorySession(appSession);

        // 2. Sync to Supabase if client is configured
        try {
          const { getSupabaseClient } = require('../supabaseRpc');
          const supabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
          if (supabase) {
            let q = supabase.from('users_accounts').update({
              subscription_expires_at: authResult.expiresAt,
              updated_at: new Date().toISOString()
            });
            if (userId) q = q.eq('id', userId);
            else if (userEmail) q = q.eq('email', userEmail.trim().toLowerCase());
            await q;
            console.log('[Patreon IPC] Updated Supabase users_accounts with subscription_expires_at:', authResult.expiresAt);
          }
        } catch (dbErr) {
          console.warn('[Patreon IPC] Supabase update warning:', dbErr.message);
        }
      }

      return authResult;
    } catch (err) {
      console.error('[Patreon IPC] Error during patreon-connect:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('patreon-disconnect', async () => {
    try {
      PatreonService.clearPatreonData();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('patreon-status', async () => {
    try {
      const data = PatreonService.getSavedPatreonData();
      return { success: true, patreon: data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[Patreon IPC] Handlers registered successfully.');
}

module.exports = { initPatreonIpc };
