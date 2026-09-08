const GumroadService = require('../GumroadService');

function getStore() {
  return require('../store');
}

function initGumroadIpc(ipcMain) {
  ipcMain.handle('gumroad-verify-license', async (event, payload) => {
    try {
      const licenseKey = typeof payload === 'string' ? payload : payload?.licenseKey;
      const productId = payload?.productId || null;

      if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.trim()) {
        return { success: false, error: 'Please enter a valid license key' };
      }

      console.log('[Gumroad IPC] Verifying license key...');
      const verifyResult = await GumroadService.verifyLicenseKey(licenseKey, productId);

      if (!verifyResult || !verifyResult.success || !verifyResult.valid) {
        return verifyResult || { success: false, error: 'Verification failed' };
      }

      const store = getStore();
      const appSession = store.getInMemorySession() || {};

      // 1. Update local session
      if (!appSession.user) appSession.user = {};
      appSession.user.subscription_expires_at = verifyResult.expiresAt;
      appSession.subscription_expires_at = verifyResult.expiresAt;
      appSession.user.gumroad_license = verifyResult.licenseInfo;
      store.saveInMemorySession(appSession);

      // 2. Sync to Supabase users_accounts if configured and user is logged in
      try {
        const { getSupabaseClient } = require('../supabaseRpc');
        const supabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (supabase) {
          const userId = appSession.user?.id;
          const userEmail = appSession.user?.email || verifyResult.licenseInfo?.email;

          if (userId || userEmail) {
            let q = supabase.from('users_accounts').update({
              subscription_expires_at: verifyResult.expiresAt,
              updated_at: new Date().toISOString()
            });
            if (userId) q = q.eq('id', userId);
            else if (userEmail) q = q.eq('email', userEmail.trim().toLowerCase());
            await q;
            console.log('[Gumroad IPC] Synced subscription_expires_at to Supabase:', verifyResult.expiresAt);
          }
        }
      } catch (dbErr) {
        console.warn('[Gumroad IPC] Supabase update warning:', dbErr.message);
      }

      return verifyResult;
    } catch (err) {
      console.error('[Gumroad IPC] Error in gumroad-verify-license:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('gumroad-status', async () => {
    try {
      const license = GumroadService.getSavedLicense();
      return { success: true, license };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('gumroad-disconnect', async () => {
    try {
      GumroadService.clearLicense();
      const store = getStore();
      const appSession = store.getInMemorySession() || {};
      if (appSession.user) {
        delete appSession.user.gumroad_license;
      }
      store.saveInMemorySession(appSession);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[Gumroad IPC] Handlers registered successfully.');
}

module.exports = { initGumroadIpc };
