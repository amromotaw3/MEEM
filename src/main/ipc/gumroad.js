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
      const cleanKey = licenseKey.trim();
      const store = getStore();
      const appSession = store.getInMemorySession() || {};
      const userId = appSession.user?.id;
      const userEmail = appSession.user?.email;

      // 1. Enforce that the user is logged into their MEEM account before activating a key
      if (!userId && !userEmail) {
        return {
          success: false,
          valid: false,
          error: 'يرجى تسجيل الدخول إلى حسابك في MEEM أولاً لربط الاشتراك بحسابك وتفعيله تلقائياً على جميع أجهزتك.'
        };
      }

      // 2. Check if this license key is already bound to another active account in Supabase
      try {
        const { getSupabaseClient } = require('../supabaseRpc');
        const supabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (supabase) {
          const { data: boundCheck, error: checkErr } = await supabase.rpc('check_gumroad_license_bound', {
            p_license_key: cleanKey,
            p_user_id: userId || null
          });

          if (!checkErr && boundCheck && boundCheck.bound) {
            if (boundCheck.is_owner) {
              console.log(`[Gumroad IPC] Key ${cleanKey.slice(0, 8)}... is already active on current account.`);
              // If already active on this user's account, update local session and return valid
              if (!appSession.user) appSession.user = {};
              appSession.user.subscription_expires_at = boundCheck.expires_at;
              appSession.subscription_expires_at = boundCheck.expires_at;
              appSession.user.gumroad_license_key = cleanKey;
              store.saveInMemorySession(appSession);
              return {
                success: true,
                valid: true,
                expiresAt: boundCheck.expires_at,
                licenseInfo: { key: cleanKey, email: userEmail },
                message: 'الاشتراك مفعل ونشط بالفعل على هذا الحساب.'
              };
            } else {
              console.warn(`[Gumroad IPC] Key is active on another account: ${boundCheck.bound_email}`);
              return {
                success: false,
                valid: false,
                error: `هذا المفتاح مستخدم ومفعل بالفعل على حساب (${boundCheck.bound_email || 'حساب آخر'}). يرجى تسجيل الدخول بذلك الحساب لتفعيل الاشتراك تلقائياً على هذا الجهاز.`
              };
            }
          }
        }
      } catch (checkKeyErr) {
        console.warn('[Gumroad IPC] Check existing key warning:', checkKeyErr.message);
      }

      const verifyResult = await GumroadService.verifyLicenseKey(cleanKey, productId);

      if (!verifyResult || !verifyResult.success || !verifyResult.valid) {
        return verifyResult || { success: false, error: 'Verification failed' };
      }

      // 3. Update local in-memory session immediately
      if (!appSession.user) appSession.user = {};
      appSession.user.subscription_expires_at = verifyResult.expiresAt;
      appSession.subscription_expires_at = verifyResult.expiresAt;
      appSession.user.gumroad_license = verifyResult.licenseInfo;
      appSession.user.gumroad_license_key = cleanKey;
      store.saveInMemorySession(appSession);

      // 4. Securely persist to Supabase users_accounts via activate_user_subscription RPC
      try {
        const { getSupabaseClient } = require('../supabaseRpc');
        const supabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (supabase && userId) {
          const { data: dbRes, error: dbErr } = await supabase.rpc('activate_user_subscription', {
            p_user_id: userId,
            p_subscription_expires_at: verifyResult.expiresAt,
            p_gumroad_key: cleanKey
          });
          if (dbErr) {
            console.error('[Gumroad IPC] activate_user_subscription RPC failed:', dbErr.message);
          } else {
            console.log('[Gumroad IPC] Account subscription activated in cloud DB for user:', userId, dbRes);
          }
        }
      } catch (dbErr) {
        console.warn('[Gumroad IPC] Supabase activate warning:', dbErr.message);
      }

      // 5. Broadcast instant session update to all renderer windows
      try {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('session-refreshed', appSession);
            win.webContents.send('vip-status-updated', { isVIP: true, expiresAt: verifyResult.expiresAt });
          }
        });
      } catch (e) {}

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
      const userId = appSession.user?.id;
      const userEmail = appSession.user?.email;

      if (appSession.user) {
        delete appSession.user.gumroad_license;
        delete appSession.user.gumroad_license_key;
        appSession.user.subscription_expires_at = null;
      }
      appSession.subscription_expires_at = null;
      store.saveInMemorySession(appSession);

      try {
        const { getSupabaseClient } = require('../supabaseRpc');
        const supabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (supabase && (userId || userEmail)) {
          let q = supabase.from('users_accounts').update({
            subscription_expires_at: null,
            gumroad_license_key: null,
            updated_at: new Date().toISOString()
          });
          if (userId) q = q.eq('id', userId);
          else if (userEmail) q = q.eq('email', userEmail.trim().toLowerCase());
          await q;
        }
      } catch (dbErr) {}

      // Broadcast instant session update to all renderer windows
      try {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('session-refreshed', appSession);
            win.webContents.send('vip-status-updated', { isVIP: false, expiresAt: null });
          }
        });
      } catch (e) {}

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[Gumroad IPC] Handlers registered successfully.');
}

module.exports = { initGumroadIpc };
