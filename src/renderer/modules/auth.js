/* global appData, currentProfile, persist, showToast, isEditingProfiles, isTransitioningAway, checkSubscriptionStatus */
/* global AVATARS, DEFAULT_AVATAR_SVG, hardwareIdCache, authFlowCompleted, _supabaseRendererClient, editingProfileId */
/* global ensureDefaultAddons, selectProfile, openProfileModal, scanLibrary, renderLibrary, renderSidebar, renderDownloadHistory */
/* global renderSocial, switchView, renderContinueWatchingDiscover, initStremioAddonsUI, initSubdlUI, initTraktUI, syncTraktWatchlistToLocal, syncTraktContinueWatching */
/* global isVaultUnlocked, isLocked, lockVault */

(function () {
  'use strict';

  // ---------- AUTH / PROFILE FLOW ----------
  let hardwareIdCacheLocal = null;
  let authFlowCompletedLocal = false;
  let _supabaseRendererClientLocal = null;
  let runAuthFlowPromise = null;
  let oauthCompletionLocked = false;

  const supabaseStorage = {
    getItem: async (key) => {
      try {
        if (window.api && typeof window.api.storageGet === 'function') {
          return await window.api.storageGet(key);
        }
      } catch (e) { console.warn('[SupabaseStorage] getItem failed:', e); }
      return window.localStorage.getItem(key);
    },
    setItem: async (key, value) => {
      try {
        if (window.api && typeof window.api.storageSet === 'function') {
          await window.api.storageSet(key, value);
          return;
        }
      } catch (e) { console.warn('[SupabaseStorage] setItem failed:', e); }
      window.localStorage.setItem(key, value);
    },
    removeItem: async (key) => {
      try {
        if (window.api && typeof window.api.storageRemove === 'function') {
          await window.api.storageRemove(key);
          return;
        }
      } catch (e) { console.warn('[SupabaseStorage] removeItem failed:', e); }
      window.localStorage.removeItem(key);
    }
  };

  function getSupabaseRendererClient() {
    if (window._supabaseRendererClientShared) {
      return window._supabaseRendererClientShared;
    }
    if (typeof window.getSupabaseRendererClient === 'function') {
      return window.getSupabaseRendererClient();
    }
    if (!window.supabase) throw new Error('Supabase not available');
    if (!_supabaseRendererClientLocal) {
      _supabaseRendererClientLocal = window.supabase.createClient(
        window.MEDIAVAULT_SUPABASE_URL || window.SUPABASE_URL,
        window.MEDIAVAULT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
            storage: supabaseStorage
          }
        }
      );
      window._supabaseRendererClientShared = _supabaseRendererClientLocal;
      window.getSupabaseRendererClient = getSupabaseRendererClient;

      // Auto-sync refreshed session to main process
      _supabaseRendererClientLocal.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          console.log('[AUTH] onAuthStateChange event in modules/auth.js:', event);
          await window.api.invoke('cloud-sync-user-session', {
            userId: session.user.id,
            email: session.user.email,
            username: session.user.user_metadata?.username || session.user.user_metadata?.name || '',
            session: {
              access_token: session.access_token,
              refresh_token: session.refresh_token
            }
          }).catch(err => console.error('[AUTH] Failed to sync session on auth state change:', err));
        }
      });
    }
    return _supabaseRendererClientLocal;
  }

  async function finalizeLogout() {
    try {
      console.log('[LOGOUT] Starting final logout cleanup...');
      if (window.supabase) {
        try {
          const client = getSupabaseRendererClient();
          await client.auth.signOut();
          if (window._supabaseRendererClientShared) window._supabaseRendererClientShared = null;
          _supabaseRendererClientLocal = null;
          console.log('[LOGOUT] Supabase session signed out');
        } catch (e) {
          console.warn('[LOGOUT] Supabase signOut error (non-critical):', e.message);
        }
      }
      
      try {
        const clearResult = await window.api.invoke('clear-session');
        console.log('[LOGOUT] Local session cleared:', clearResult);
      } catch (e) {
        console.warn('[LOGOUT] Local session clear error:', e.message);
      }
      
      localStorage.clear();
      appData.user = null;
      appData.authenticated = false;
      // Do not call persist() here to avoid overwriting the clean logout state with cached renderer data.
      
      console.log('[LOGOUT] Clearing app data and reloading...');
      await new Promise(r => setTimeout(r, 500));
      window.location.href = window.location.pathname;
    } catch (err) {
      console.error('[LOGOUT] Error during final logout:', err);
      showToast('Error during logout: ' + err.message);
    }
  }

  async function performLogout() {
    try {
      console.log('[LOGOUT] User triggered logout. Displaying confirmation modal...');
      const email = appData.user?.email;
      if (!email) {
        console.log('[LOGOUT] No user email found. Performing instant local logout.');
        await finalizeLogout();
        return;
      }

      const modal = document.getElementById('modal-account-logout');
      if (modal) {
        modal.style.display = 'flex';
      } else {
        await finalizeLogout();
      }
    } catch (err) {
      console.error('[LOGOUT] Failed to show logout confirmation modal:', err);
      showToast('Failed to initialize logout: ' + err.message);
    }
  }

  async function getHardwareIdForClient() {
    if (hardwareIdCacheLocal) return hardwareIdCacheLocal;
    try {
      if (window.api) {
        if (typeof window.api.getHardwareId === 'function') {
          const id = await window.api.getHardwareId();
          if (id && String(id).trim() && id !== 'web-unknown') {
            hardwareIdCacheLocal = String(id).trim();
            return hardwareIdCacheLocal;
          }
        }
        if (typeof window.api.invoke === 'function') {
          const id = await window.api.invoke('get-hardware-id');
          if (id && String(id).trim()) {
            hardwareIdCacheLocal = String(id).trim();
            return hardwareIdCacheLocal;
          }
        }
      }
    } catch (e) { console.warn('[AUTH] getHardwareId failed', e); }
    hardwareIdCacheLocal = 'unknown-device';
    return hardwareIdCacheLocal;
  }

  function isMobileClient() {
    return !!(window.Capacitor || (window.api && typeof window.api.isMobile === 'function' && window.api.isMobile()));
  }

  function getOAuthRedirectUrl() {
    return 'https://mediavault-five.vercel.app/auth/callback?source=mobile';
  }

  async function startOAuthLogin(provider, msgEl) {
    const client = getSupabaseRendererClient();
    const redirectUrl = getOAuthRedirectUrl();
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true
      }
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Could not start OAuth login');

    sessionStorage.setItem('mv_oauth_pending', '1');
    oauthCompletionLocked = false;

    if (isMobileClient()) {
      setAuthMessage(msgEl, provider === 'google'
        ? 'Opening Chrome to sign in with Google… You will return to MediaVault automatically.'
        : 'Opening browser for Discord… You will return to MediaVault automatically.', true);
    } else {
      // Show waiting message with a fallback manual input area
      const providerName = provider === 'google' ? 'Google' : 'Discord';
      msgEl.innerHTML = `
        <div style="margin-top: 10px; text-align: center;">
          <div class="spinner" style="display:inline-block; margin-bottom: 8px;"></div>
          <div>Waiting for ${providerName} login...</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 12px; margin-bottom: 8px; line-height: 1.4;">
            If the app didn't open automatically after logging in, copy the final URL from your browser address bar and paste it below:
          </div>
          <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
            <input type="text" id="manual-oauth-url" placeholder="Paste callback URL here (mediavault://... or localhost:3000...)" style="
              flex: 1;
              background: rgba(255,255,255,0.06);
              border: 1px solid rgba(255,255,255,0.15);
              border-radius: 6px;
              padding: 6px 10px;
              font-size: 11px;
              color: #fff;
              outline: none;
            " />
            <button id="manual-oauth-btn" class="btn" style="
              padding: 6px 12px;
              font-size: 11px;
              background: #5865F2;
              border: none;
              border-radius: 6px;
              color: white;
              cursor: pointer;
            ">Submit</button>
          </div>
        </div>
      `;

      // Attach event listener for the manual login fallback
      const submitBtn = msgEl.querySelector('#manual-oauth-btn');
      const inputEl = msgEl.querySelector('#manual-oauth-url');
      if (submitBtn && inputEl) {
        submitBtn.onclick = async () => {
          const rawVal = inputEl.value.trim();
          if (!rawVal) return;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Verifying...';
          // Convert localhost:3000 links to mediavault:// protocol if needed
          let formattedUrl = rawVal;
          if (rawVal.includes('localhost:3000') || rawVal.includes('127.0.0.1:3000')) {
            const hashIndex = rawVal.indexOf('#');
            const searchIndex = rawVal.indexOf('?');
            const paramStart = hashIndex !== -1 ? hashIndex : searchIndex;
            if (paramStart !== -1) {
              formattedUrl = 'mediavault://callback' + rawVal.substring(paramStart);
            }
          }
          try {
            const handled = await handleOAuthDeepLink(formattedUrl);
            if (!handled) {
              showToast('❌ Invalid token or callback URL.');
              submitBtn.disabled = false;
              submitBtn.textContent = 'Submit';
            }
          } catch (err) {
            showToast('❌ Verification failed: ' + err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
          }
        };
      }
    }

    await window.api.cloudOAuthLogin(data.url);
  }

  function isAuthCallbackUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    return urlStr.includes('mediavault://callback') ||
      urlStr.includes('mediavault://auth') ||
      urlStr.includes('com.mediavault.app://callback') ||
      (urlStr.includes('/auth/callback') && (urlStr.includes('code=') || urlStr.includes('access_token=')));
  }

  function parseAuthCallbackParams(urlStr) {
    if (urlStr.includes('#')) {
      return new URLSearchParams(urlStr.split('#')[1]);
    }
    if (urlStr.includes('?')) {
      return new URLSearchParams(urlStr.split('?').slice(1).join('?'));
    }
    return new URLSearchParams();
  }

  async function closeOAuthBrowser() {
    try {
      const Browser = window.Capacitor?.Plugins?.Browser;
      if (Browser && typeof Browser.close === 'function') {
        await Browser.close();
      }
    } catch (e) { /* browser may already be closed */ }
  }

  async function proceedAfterAuthenticatedLogin() {
    appData.authenticated = true;
    ensureDefaultAddons();
    persist();

    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.remove();

    if (checkSubscriptionStatus()) return;
    startPeriodicSessionCheck();

    if (appData.profiles.length === 1) {
      selectProfile(appData.profiles[0].id);
    } else if (appData.profiles.length > 1) {
      const picker = document.getElementById('profile-picker');
      if (picker) {
        picker.style.display = 'flex';
        picker.classList.add('modal-active');
      }
      try { document.body.classList.add('modal-open'); } catch (e) { }
      renderProfilePicker();
    } else {
      const picker = document.getElementById('profile-picker');
      if (picker) {
        picker.style.display = 'flex';
        picker.classList.add('modal-active');
      }
      try { document.body.classList.add('modal-open'); } catch (e) { }
      renderProfilePicker();
      if (typeof window.openProfileModal === 'function') window.openProfileModal();
    }
  }

  async function completeOAuthLogin(user, session) {
    if (oauthCompletionLocked) return;
    oauthCompletionLocked = true;

    try {
      const syncResult = await window.api.invoke('cloud-sync-user-session', {
        userId: user.id,
        email: user.email,
        username: user.user_metadata?.name || user.user_metadata?.full_name || user.user_metadata?.username || '',
        session: session?.access_token ? {
          access_token: session.access_token,
          refresh_token: session.refresh_token
        } : null
      });

      if (syncResult && syncResult.success) {
        const onlineData = await window.api.loadData().catch(() => null);
        if (onlineData && onlineData.authenticated) {
          appData = { ...appData, ...onlineData };
        } else {
          appData.user = syncResult.user || user;
          appData.profiles = normalizeProfiles(syncResult.profiles || []);
        }
      } else {
        console.warn('[AUTH] OAuth sync session failed:', syncResult?.error);
        appData.user = user;
        appData.profiles = [];
      }

      await proceedAfterAuthenticatedLogin();
    } catch (err) {
      oauthCompletionLocked = false;
      throw err;
    }
  }

  let oauthDeepLinkInFlight = false;

  async function handleOAuthDeepLink(urlStr) {
    if (!isAuthCallbackUrl(urlStr)) return false;
    if (oauthDeepLinkInFlight) return true;

    oauthDeepLinkInFlight = true;
    // Redact auth secrets — the callback URL carries access_token / refresh_token / provider_token.
    console.log('[AUTH] Processing OAuth callback:', String(urlStr).replace(/((?:access|refresh|provider|provider_refresh)_token|code|id_token)=[^&#\s]+/gi, '$1=***'));

    try {
      await closeOAuthBrowser();

      const params = parseAuthCallbackParams(urlStr);
      const oauthError = params.get('error') || params.get('error_description');
      if (oauthError) {
        sessionStorage.removeItem('mv_oauth_pending');
        throw new Error(oauthError === 'access_denied' ? 'Sign-in was cancelled.' : oauthError);
      }

      const code = params.get('code');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      if (!code && !accessToken) {
        console.warn('[AUTH] OAuth callback URL has no code or access_token');
        return false;
      }

      const client = getSupabaseRendererClient();
      let sessionData;

      if (code) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw error;
        sessionData = data;
      } else {
        const { data, error } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || ''
        });
        if (error) throw error;
        sessionData = data;
      }

      if (type === 'recovery') {
        const modal = document.getElementById('modal-password-recovery');
        if (modal) modal.style.display = 'flex';
        return true;
      }

      const user = sessionData?.user;
      if (!user?.id) throw new Error('OAuth completed but no user was returned');

      await completeOAuthLogin(user, sessionData?.session);
      sessionStorage.removeItem('mv_oauth_pending');
      if (typeof showToast === 'function') showToast('Successfully logged in!');
      return true;
    } catch (err) {
      console.error('[AUTH] OAuth deep link failed:', err);
      sessionStorage.removeItem('mv_oauth_pending');
      oauthCompletionLocked = false;
      const msgEl = document.getElementById('auth-msg');
      if (msgEl) setAuthMessage(msgEl, 'Login failed: ' + (err.message || err));
      return false;
    } finally {
      oauthDeepLinkInFlight = false;
    }
  }

  function registerOAuthDeepLinkHandlers() {
    if (window.__oauthDeepLinkRegistered) return;
    window.__oauthDeepLinkRegistered = true;
    window.handleOAuthDeepLink = handleOAuthDeepLink;

    if (window.api && typeof window.api.onDeepLink === 'function') {
      window.api.onDeepLink(async (url) => {
        const oauthHandled = await handleOAuthDeepLink(url);
        if (!oauthHandled && typeof window.handleAppDeepLink === 'function') {
          window.handleAppDeepLink(url);
        }
      });
    }

    window.addEventListener('mediavault-deep-link', async (e) => {
      const url = e?.detail?.url;
      if (!url) return;
      const oauthHandled = await handleOAuthDeepLink(url);
      if (!oauthHandled && typeof window.handleAppDeepLink === 'function') {
        window.handleAppDeepLink(url);
      }
    });
  }

  registerOAuthDeepLinkHandlers();

  function showBannedOverlay(reason, hwId) {
    const existing = document.getElementById('banned-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'banned-overlay';
    overlay.style = 'position:fixed;inset:0;background:#050008;color:#fff;display:flex;align-items:center;justify-content:center;z-index:9999999;padding:30px;flex-direction:column;font-family:\'Inter\', sans-serif;overflow:hidden;';
    
    overlay.innerHTML = `
      <!-- Animated orbs (same as splash) -->
      <div style="position:absolute;top:-20%;left:-20%;width:80%;height:80%;background:radial-gradient(circle,rgba(168,85,247,0.35) 0%,transparent 70%);filter:blur(80px);animation:splashOrbit 8s infinite ease-in-out;pointer-events:none;"></div>
      <div style="position:absolute;bottom:-20%;right:-20%;width:80%;height:80%;background:radial-gradient(circle,rgba(79,70,229,0.3) 0%,transparent 70%);filter:blur(80px);animation:splashOrbit 12s infinite ease-in-out reverse;pointer-events:none;"></div>
      <div style="position:absolute;top:20%;right:-30%;width:70%;height:70%;background:radial-gradient(circle,rgba(139,92,246,0.25) 0%,transparent 70%);filter:blur(90px);animation:splashOrbit 10s infinite linear;pointer-events:none;"></div>

      <div style="max-width:500px;width:100%;text-align:center;background:rgba(20,10,10,0.55);border:1px solid rgba(239,68,68,0.2);border-radius:24px;padding:40px;box-shadow:0 20px 50px rgba(0,0,0,0.8),0 0 40px rgba(239,68,68,0.1);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);position:relative;overflow:hidden;z-index:1;">
        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#ef4444,#b91c1c);"></div>
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;box-shadow:0 0 20px rgba(239,68,68,0.2);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:12px;color:#ef4444;text-shadow:0 0 10px rgba(239,68,68,0.3);">Access Restricted</h1>
        <p style="font-size:15px;color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:24px;">This device is permanently blocked from the MediaVault network due to a hardware restriction or security violation.</p>
        
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:16px;margin-bottom:20px;text-align:left;">
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Ban Reason</div>
          <div style="font-size:14px;color:#fca5a5;font-weight:500;">${reason || 'Violation of service terms.'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:12px;margin-bottom:4px;">Device Signature</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);font-family:monospace;word-break:break-all;">${hwId || 'Unknown'}</div>
        </div>
        
        <p style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.5;">If you believe this restriction is an error, please contact support with your device signature above.</p>
      </div>
    `;
    
    document.body.appendChild(overlay);

    window.addEventListener('keydown', (e) => {
      if (['Escape', 'Tab', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    }, { capture: true });

    document.body.style.overflow = 'hidden';

    if (window.hideSplash) window.hideSplash();
  }

  function checkSubscriptionStatus() {
    const sub = appData.user?.subscription_expires_at || appData.subscription_expires_at || null;
    if (!sub) return false; // No subscription info - allow access (free/local users)
    const now = new Date();
    const expDate = new Date(sub);
    if (expDate > now) return false; // Still active
    showSubscriptionExpiredOverlay(sub);
    return true;
  }

  function startPeriodicSessionCheck() {
    if (window.periodicSessionCheckInterval) {
      clearInterval(window.periodicSessionCheckInterval);
    }
    window.periodicSessionCheckInterval = setInterval(async () => {
      if (!appData.authenticated) {
        clearInterval(window.periodicSessionCheckInterval);
        window.periodicSessionCheckInterval = null;
        return;
      }
      try {
        const resp = await window.api.loadData();
        if (resp) {
          if (resp.banned) {
            console.warn('[AUTH] Device or account banned during periodic check.');
            clearInterval(window.periodicSessionCheckInterval);
            window.periodicSessionCheckInterval = null;
            showBannedOverlay(resp.banReason || 'Your account has been suspended.', hardwareIdCacheLocal || 'Unknown');
            return;
          }
          if (resp.authenticated === false) {
            console.warn('[AUTH] Session expired or unauthenticated during periodic check.');
            clearInterval(window.periodicSessionCheckInterval);
            window.periodicSessionCheckInterval = null;
            return;
          }
          if (resp.user) {
            appData.user = resp.user;
            if (checkSubscriptionStatus()) {
              clearInterval(window.periodicSessionCheckInterval);
              window.periodicSessionCheckInterval = null;
              return;
            }
          }
        }
      } catch (err) {
        console.warn('[AUTH] Periodic session check failed:', err.message);
      }
    }, 15000);
  }

  function showSubscriptionExpiredOverlay(expirationDate) {
    const existing = document.getElementById('subscription-expired-overlay');
    if (existing) existing.remove();

    let formattedDate = expirationDate;
    try {
      formattedDate = new Date(expirationDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {}

    const overlay = document.createElement('div');
    overlay.id = 'subscription-expired-overlay';
    overlay.style = 'position:fixed;inset:0;background:#050008;color:#fff;display:flex;align-items:center;justify-content:center;z-index:9999998;padding:30px;flex-direction:column;font-family:\'Inter\', sans-serif;overflow:hidden;';
    
    overlay.innerHTML = `
      <!-- Animated orbs (same as splash) -->
      <div style="position:absolute;top:-20%;left:-20%;width:80%;height:80%;background:radial-gradient(circle,rgba(168,85,247,0.35) 0%,transparent 70%);filter:blur(80px);animation:splashOrbit 8s infinite ease-in-out;pointer-events:none;"></div>
      <div style="position:absolute;bottom:-20%;right:-20%;width:80%;height:80%;background:radial-gradient(circle,rgba(79,70,229,0.3) 0%,transparent 70%);filter:blur(80px);animation:splashOrbit 12s infinite ease-in-out reverse;pointer-events:none;"></div>
      <div style="position:absolute;top:20%;right:-30%;width:70%;height:70%;background:radial-gradient(circle,rgba(139,92,246,0.25) 0%,transparent 70%);filter:blur(90px);animation:splashOrbit 10s infinite linear;pointer-events:none;"></div>

      <div style="max-width:520px;width:100%;text-align:center;background:rgba(15,10,30,0.6);border:1px solid rgba(139,92,246,0.2);border-radius:24px;padding:45px 40px;box-shadow:0 20px 60px rgba(0,0,0,0.8),0 0 40px rgba(139,92,246,0.1);backdrop-filter:blur(25px);-webkit-backdrop-filter:blur(25px);position:relative;overflow:hidden;z-index:1;">
        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#8b5cf6,#6366f1,#a855f7);"></div>
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;box-shadow:0 0 20px rgba(139,92,246,0.2);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:12px;color:#a855f7;text-shadow:0 0 10px rgba(139,92,246,0.3);">Subscription Expired</h1>
        <p style="font-size:15px;color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:24px;">Your subscription has ended. Please renew to continue using MediaVault.</p>
        
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:16px;margin-bottom:20px;text-align:left;">
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Expiration Date</div>
          <div style="font-size:14px;color:#c084fc;font-weight:500;">${formattedDate}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:12px;margin-bottom:4px;">Account Email</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);font-family:monospace;word-break:break-all;">${appData.user?.email || 'Unknown'}</div>
        </div>
        
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <button id="sub-expired-logout" style="padding:12px 28px;border-radius:12px;border:1px solid rgba(139,92,246,0.3);background:rgba(139,92,246,0.15);color:#c084fc;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;font-family:'Inter',sans-serif;">
            <i class="fas fa-sign-out-alt" style="margin-right:6px;"></i> Logout
          </button>
          <button id="sub-expired-exit" style="padding:12px 28px;border-radius:12px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.1);color:#fca5a5;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;font-family:'Inter',sans-serif;">
            <i class="fas fa-power-off" style="margin-right:6px;"></i> Exit App
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);

    overlay.querySelector('#sub-expired-logout').onclick = async () => {
      overlay.remove();
      await finalizeLogout();
    };
    overlay.querySelector('#sub-expired-exit').onclick = () => {
      if (window.api && window.api.closeWindow) {
        window.api.closeWindow();
      } else {
        window.close();
      }
    };

    window.addEventListener('keydown', (e) => {
      if (document.getElementById('subscription-expired-overlay')) {
        if (['Escape', 'Tab', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
      }
    }, { capture: true });

    document.body.style.overflow = 'hidden';

    if (window.hideSplash) window.hideSplash();
  }

  let authMode = 'login';

  function formatAuthMessage(respOrErr) {
    if (!respOrErr) return 'Something went wrong';
    let msg = '';
    if (typeof respOrErr === 'string') msg = respOrErr;
    else if (respOrErr.message) msg = respOrErr.message;
    else if (respOrErr.error) {
      msg = typeof respOrErr.error === 'string' ? respOrErr.error : (respOrErr.error.message || JSON.stringify(respOrErr.error));
    } else {
      msg = 'Request failed';
    }
    if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
      return 'Could not reach the server. Check your internet connection and try again.';
    }
    if (/access blocked|disallowed_useragent|403|embedded browser/i.test(msg)) {
      return 'Google sign-in must open in Chrome. Please try again — do not use an in-app browser.';
    }
    return msg;
  }

  function setAuthMessage(msgEl, text, isSuccess) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.classList.add('visible');
    msgEl.classList.toggle('success', !!isSuccess);
    requestAnimationFrame(() => {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function clearAuthMessage(msgEl) {
    if (!msgEl) return;
    msgEl.textContent = '';
    msgEl.classList.remove('visible', 'success');
  }

  function setAuthSubmitLoading(overlay, loading) {
    const btn = overlay?.querySelector('#auth-submit');
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset.prevLabel = btn.textContent;
      btn.innerHTML = '<span class="auth-spinner"></span>Please wait…';
    } else {
      btn.textContent = btn.dataset.prevLabel || (authMode === 'register' ? 'Create account' : 'Sign in');
    }
  }

  function showAuthOverlay() {
    const picker = document.getElementById('profile-picker');
    if (picker) picker.style.display = 'none';

    if (document.getElementById('auth-overlay')) return;
    authMode = 'login';
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML = `
      <div class="auth-orbs" aria-hidden="true"></div>
      <div class="auth-card" role="dialog" aria-labelledby="auth-title">
        <div class="auth-brand">
          <div class="auth-logo" aria-hidden="true"></div>
          <h2 id="auth-title" class="auth-title">Welcome to MEEM</h2>
          <p class="auth-subtitle">Sign in to sync profiles, continue watching, and unlock your library across devices.</p>
        </div>
        <div class="auth-tabs" role="tablist">
          <button type="button" class="auth-tab active" data-mode="login" role="tab" aria-selected="true">Sign in</button>
          <button type="button" class="auth-tab" data-mode="register" role="tab" aria-selected="false">Create account</button>
        </div>
        <form id="auth-form" novalidate>
          <div class="auth-field" id="auth-username-field" style="display: none;">
            <label class="auth-label" for="auth-username">Username</label>
            <div class="auth-input-wrap">
              <i class="fa-regular fa-user" aria-hidden="true"></i>
              <input id="auth-username" class="auth-input" type="text" autocomplete="username" placeholder="Your username">
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="auth-email">Email</label>
            <div class="auth-input-wrap">
              <i class="fa-regular fa-envelope" aria-hidden="true"></i>
              <input id="auth-email" class="auth-input" type="email" autocomplete="email" placeholder="you@example.com" required>
            </div>
          </div>
          <div class="auth-field">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <label class="auth-label" for="auth-password">Password</label>
              <a href="#" id="auth-forgot-password" style="font-size: 12px; color: rgba(255, 255, 255, 0.7); text-decoration: none;">Forgot Password?</a>
            </div>

            <div class="auth-input-wrap">
              <i class="fa-solid fa-lock" aria-hidden="true"></i>
              <input id="auth-password" class="auth-input" type="password" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}" placeholder="••••••••" required>
            </div>
          </div>
          <button type="submit" id="auth-submit" class="auth-submit">Sign in</button>
        </form>
        <div id="auth-msg" class="auth-msg" role="alert"></div>
        <div class="auth-separator" aria-hidden="true"><span>or</span></div>
        <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">
          <button id="oauth-google" class="auth-oauth btn google-btn"><svg aria-hidden="true" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24c0-1.55-.15-3.24-.47-4.78H24v9.03h12.72c-.55 2.87-2.22 5.3-4.72 6.96l7.33 5.68C43.6 36.42 46.5 30.73 46.5 24z"/><path fill="#FBBC05" d="M10.54 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.33-5.68c-2.11 1.42-4.8 2.3-8.56 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google</button>
          <button id="oauth-discord" class="auth-oauth btn discord-btn"><i class="fab fa-discord" aria-hidden="true" style="margin-left:4px;"></i> Continue with Discord</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const msgEl = overlay.querySelector('#auth-msg');
    const form = overlay.querySelector('#auth-form');
    const tabsContainer = overlay.querySelector('.auth-tabs');
    const tabs = overlay.querySelectorAll('.auth-tab');
    const submitBtn = overlay.querySelector('#auth-submit');
    const passwordInput = overlay.querySelector('#auth-password');

    // OAuth button handler (Discord)
    const oauthBtn = overlay.querySelector('#oauth-discord');
    if (oauthBtn) {
      oauthBtn.onclick = async () => {
        clearAuthMessage(msgEl);
        try {
          await startOAuthLogin('discord', msgEl);
        } catch (e) {
          console.error('[AUTH] OAuth start failed', e);
          setAuthMessage(msgEl, formatAuthMessage(e));
        }
      };
    }

    // Google OAuth handler
    const oauthGoogleBtn = overlay.querySelector('#oauth-google');
    if (oauthGoogleBtn) {
      oauthGoogleBtn.onclick = async () => {
        clearAuthMessage(msgEl);
        try {
          await startOAuthLogin('google', msgEl);
        } catch (e) {
          console.error('[AUTH] Google OAuth start failed', e);
          setAuthMessage(msgEl, formatAuthMessage(e));
        }
      };
    }

    const forgotPasswordLink = overlay.querySelector('#auth-forgot-password');
    if (forgotPasswordLink) {
      forgotPasswordLink.onclick = async (e) => {
        e.preventDefault();
        const email = overlay.querySelector('#auth-email').value.trim();
        if (!email) {
          setAuthMessage(msgEl, 'Please enter your email address first.');
          return;
        }
        clearAuthMessage(msgEl);
        try {
          const client = getSupabaseRendererClient();
          const { error } = await client.auth.resetPasswordForEmail(email);
          if (error) throw error;
          setAuthMessage(msgEl, 'Password reset email sent!', true);
        } catch (error) {
          console.error('[AUTH] Reset password failed', error);
          setAuthMessage(msgEl, formatAuthMessage(error));
        }
      };
    }

    tabs.forEach((tab) => {
      tab.onclick = () => {
        authMode = tab.dataset.mode === 'register' ? 'register' : 'login';
        tabs.forEach((t) => {
          const active = t.dataset.mode === authMode;
          t.classList.toggle('active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        
        const usernameField = overlay.querySelector('#auth-username-field');
        if (usernameField) usernameField.style.display = authMode === 'register' ? 'block' : 'none';
        if (forgotPasswordLink) forgotPasswordLink.style.display = authMode === 'register' ? 'none' : 'block';

        submitBtn.textContent = authMode === 'register' ? 'Create account' : 'Sign in';
        passwordInput.autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
        clearAuthMessage(msgEl);
      };
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      if (authMode === 'register') handleAuthRegister();
      else handleAuthLogin();
    };

    if (window.hideSplash) window.hideSplash();
  }

  async function handleAuthLogin() {
    const overlay = document.getElementById('auth-overlay');
    const email = overlay.querySelector('#auth-email').value.trim();
    const password = overlay.querySelector('#auth-password').value;
    const msgEl = overlay.querySelector('#auth-msg');
    clearAuthMessage(msgEl);
    if (!email || !password) { setAuthMessage(msgEl, 'Email and password are required'); return; }
    setAuthSubmitLoading(overlay, true);
    try {
      const hwId = await getHardwareIdForClient();
      console.log('[AUTH] Attempting sign in with email, hardware ID:', hwId);

      let result;
      if (window.api && typeof window.api.cloudLogin === 'function') {
        result = await window.api.cloudLogin(email, password);
      } else {
        const backend = (window.MEDIAVAULT_BACKEND_URL || 'https://mediavault-five.vercel.app').replace(/\/$/, '');
        const response = await fetch(`${backend}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, hardware_id: hwId })
        });
        result = await response.json();
        if (!response.ok && !result.error) {
          throw new Error(`Login failed (HTTP ${response.status})`);
        }
      }

      if (result.error) {
        // The RPCs return the underlying cause in `details` (SQLERRM). Surface it to
        // the console for debugging while keeping the user-facing message clean.
        console.error('[AUTH] Login failed:', result.error, result.details ? '| details: ' + result.details : '');
        const loginErr = new Error(result.error);
        if (result.details) loginErr.details = result.details;
        throw loginErr;
      }
      
      console.log('[AUTH] API login success. User ID:', result.user?.id);
      
      if (!result.user || !result.user.id) {
        throw new Error('Invalid response: no user data returned');
      }
      
      // Store session in main process
      console.log('[AUTH] Syncing session with main process...');
      const syncResult = await window.api.invoke('cloud-sync-user-session', { 
        userId: result.user.id, 
        email: email, 
        username: result.user.username || '',
        session: result.session ? {
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token
        } : null
      });
      
      console.log('[AUTH] Sync result:', syncResult);
      
      if (syncResult && syncResult.success) {
        console.log('[AUTH] Sync session success. Fetching full profiles from main process...');
        const onlineData = await window.api.loadData().catch(() => null);
        if (onlineData && onlineData.authenticated) {
          appData = { ...appData, ...onlineData };
        } else {
          appData.user = syncResult.user || result.user;
          appData.profiles = normalizeProfiles(syncResult.profiles || []);
        }
      } else {
        console.warn('[AUTH] Email login sync session failed:', syncResult?.error);
        appData.user = result.user;
        appData.profiles = [];
      }

      appData.authenticated = true;
      ensureDefaultAddons();

      persist();
      if (overlay) overlay.remove();
      
      if (checkSubscriptionStatus()) return;
      startPeriodicSessionCheck();

      if (appData.profiles.length === 1) {
        selectProfile(appData.profiles[0].id);
      } else if (appData.profiles.length > 1) {
        document.getElementById('profile-picker').style.display = 'flex';
        document.getElementById('profile-picker').classList.add('modal-active');
        try { document.body.classList.add('modal-open'); } catch (e) { }
        renderProfilePicker();
      } else {
        console.log('[AUTH] No profiles found. Opening create profile modal...');
        document.getElementById('profile-picker').style.display = 'flex';
        document.getElementById('profile-picker').classList.add('modal-active');
        try { document.body.classList.add('modal-open'); } catch (e) { }
        renderProfilePicker();
        window.openProfileModal();
      }
    } catch (e) {
      console.error('[AUTH] Login error', e);
      const errorMsg = formatAuthMessage(e);
      setAuthMessage(msgEl, errorMsg);
      // Ensure overlay stays visible for user to see error and retry
      if (overlay) {
        overlay.style.display = 'flex';
      }
    } finally {
      setAuthSubmitLoading(overlay, false);
    }
  }

  async function handleAuthRegister() {
    const overlay = document.getElementById('auth-overlay');
    const email = overlay.querySelector('#auth-email').value.trim();
    const password = overlay.querySelector('#auth-password').value;
    const username = overlay.querySelector('#auth-username')?.value.trim() || '';
    const msgEl = overlay.querySelector('#auth-msg');
    clearAuthMessage(msgEl);
    if (!email || !password) { setAuthMessage(msgEl, 'Email and password are required'); return; }
    if (password.length < 6) { setAuthMessage(msgEl, 'Password must be at least 6 characters'); return; }
    setAuthSubmitLoading(overlay, true);
    try {
      // Register through the SAME backend that login uses: handle_register ->
      // public.users_accounts with a bcrypt password_hash. Previously this used
      // client.auth.signUp(), which created the account in auth.users ONLY, so the
      // subsequent login (handle_secure_login, which checks users_accounts) failed
      // with "Invalid email or password" — the user could never sign in after
      // creating an account (notably on Android). cloudRegister keeps both the
      // register and login paths consistent on Windows and Android.
      console.log('[AUTH] Attempting registration via cloudRegister...');

      let result;
      if (window.api && typeof window.api.cloudRegister === 'function') {
        result = await window.api.cloudRegister(email, password);
      } else {
        const backend = (window.MEDIAVAULT_BACKEND_URL || 'https://mediavault-five.vercel.app').replace(/\/$/, '');
        const response = await fetch(`${backend}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, username })
        });
        result = await response.json();
        if (!response.ok && !result.error) {
          throw new Error(`Registration failed (HTTP ${response.status})`);
        }
      }

      if (result && result.error) {
        console.error('[AUTH] Registration failed:', result.error, result.details ? '| details: ' + result.details : '');
        const regErr = new Error(result.error);
        if (result.details) regErr.details = result.details;
        throw regErr;
      }

      console.log('[AUTH] Registration success. Auto-logging in...');
      setAuthMessage(msgEl, 'Account created — signing you in…', true);
      authMode = 'login';
      await handleAuthLogin();
    } catch (e) {
      console.error('[AUTH] Register error', e);
      setAuthMessage(msgEl, formatAuthMessage(e) || 'Registration failed');
    } finally {
      setAuthSubmitLoading(overlay, false);
    }
  }

  async function runAuthFlow() {
    if (runAuthFlowPromise) return runAuthFlowPromise;
    runAuthFlowPromise = (async () => {
      try {
        const hw = await getHardwareIdForClient();
        console.log('[AUTH] Device hardware ID resolved:', hw);

        let localData = null;
        try {
          localData = await window.api.loadData();
          if (localData) {
            appData = { ...appData, ...localData };
          }
        } catch (e) {
          console.error('[AUTH] Initial loadData failed:', e);
        }

        let resp = null;

        // ── Fast-path: main process already authenticated via hardware-ID ──
        // If loadData() returned authenticated:true it means the device is
        // recognised in Supabase by its hardware ID.  We don't need a Supabase
        // JWT in the renderer to boot the app; skip the getSession() dance and
        // use the already-verified data directly.
        if (localData && localData.authenticated) {
          console.log('[AUTH] Hardware-ID session already authenticated. Skipping renderer Supabase check.');
          resp = localData;

          // Even on fast-path we still need the JWT injected into the renderer
          // Supabase client so that RLS-protected tables (collection_messages,
          // list_members, etc.) accept our requests (401 fix).
          if (
            localData._supabaseSession &&
            localData._supabaseSession.access_token &&
            window.supabase &&
            typeof window.supabase.createClient === 'function'
          ) {
            try {
              const client = getSupabaseRendererClient();
              const { data: existingSession } = await client.auth.getSession();
              if (!existingSession?.session?.access_token) {
                console.log('[AUTH] Fast-path: restoring JWT into renderer Supabase client...');
                const { error: setErr } = await client.auth.setSession(localData._supabaseSession);
                if (setErr) {
                  console.warn('[AUTH] Fast-path setSession failed:', setErr.message);
                  localData._supabaseSession = null;
                  try {
                    await client.auth.signOut().catch(() => {});
                    const current = await window.api.loadData();
                    if (current) {
                      current._supabaseSession = null;
                      await window.api.saveData(current);
                      console.log('[AUTH] Invalid session cleared from local storage.');
                    }
                  } catch (clearErr) {
                    console.warn('[AUTH] Failed to clear invalid session:', clearErr);
                  }
                } else {
                  console.log('[AUTH] Fast-path: renderer JWT restored successfully.');
                }
              }
            } catch (sessionErr) {
              console.warn('[AUTH] Fast-path session restore error:', sessionErr.message);
            }
          }
        }

        const isOnline = navigator.onLine;
        if (!resp && isOnline && window.supabase && typeof window.supabase.createClient === 'function') {

          try {
            const client = getSupabaseRendererClient();
            let session = null;
            
            const { data: sessionData } = await client.auth.getSession();
            if (sessionData && sessionData.session) {
              session = sessionData.session;
            } else if (localData && localData._supabaseSession && localData._supabaseSession.access_token) {
              console.log('[AUTH] No active renderer session, attempting to restore from localData._supabaseSession');
              const { data: setSessionData, error: setSessionError } = await client.auth.setSession(localData._supabaseSession);
              if (!setSessionError && setSessionData && setSessionData.session) {
                console.log('[AUTH] Successfully restored Supabase session from disk.');
                session = setSessionData.session;
              } else {
                console.warn('[AUTH] Failed to restore Supabase session from disk:', setSessionError?.message || setSessionError);
                localData._supabaseSession = null;
                try {
                  await client.auth.signOut().catch(() => {});
                  const current = await window.api.loadData();
                  if (current) {
                    current._supabaseSession = null;
                    await window.api.saveData(current);
                    console.log('[AUTH] Invalid session cleared from local storage.');
                  }
                } catch (clearErr) {
                  console.warn('[AUTH] Failed to clear invalid session:', clearErr);
                }
              }
            }

            if (session) {
               console.log('[AUTH] Valid Supabase session found:', session.user.id);
               
               const syncRes = await window.api.invoke('cloud-sync-user-session', { 
                 userId: session.user.id, 
                 email: session.user.email, 
                 username: session.user.user_metadata?.username || '',
                 session: {
                   access_token: session.access_token,
                   refresh_token: session.refresh_token
                 }
               }).catch(() => null);

               const onlineData = await window.api.loadData().catch(() => null);
               if (onlineData && onlineData.authenticated) { 
                 resp = onlineData; 
               } else {
                 resp = {
                   ...(localData || {}),
                   authenticated: true,
                   user: syncRes?.user || session.user,
                   profiles: onlineData?.profiles || localData?.profiles || []
                 };
               }
            }
          } catch (authErr) {
            console.warn('[AUTH] Supabase verification failed, falling back to local offline mode:', authErr);
          }
        }

        if (resp?.banned || localData?.banned) {
          showBannedOverlay(resp?.banReason || localData?.banReason || 'This device is banned', hardwareIdCacheLocal || 'Unknown');
          return;
        }

        if (!resp || !resp.authenticated) {
          if (appData.authenticated) {
            console.log('[AUTH] User authenticated via concurrent flow. Using appData.');
            resp = {
              user: appData.user,
              profiles: appData.profiles,
              activeProfileId: appData.activeProfileId,
              authenticated: true
            };
          } else if (localData && localData.profiles && localData.profiles.length > 0) {
            console.log('[AUTH] Offline Mode active. Loading local profiles.');
            resp = {
              ...localData,
              authenticated: true
            };
          } else {
            resp = localData;
          }
        }

        if (resp?.authenticated) {
          appData.user = resp.user || { email: 'offline@mediavault.local' };
          appData.profiles = normalizeProfiles(resp.profiles || []);
          appData.activeProfileId = resp.activeProfileId || (resp.profiles?.[0]?.id || null);
          appData.authenticated = true;
          ensureDefaultAddons();

          persist();
          authFlowCompletedLocal = true;

          if (checkSubscriptionStatus()) return;
          startPeriodicSessionCheck();
          
          const isChatWin = new URLSearchParams(window.location.search).get('mvWindow') === 'chat';
          if (isChatWin) {
            const profileToSelect = appData.profiles.find(p => p.id === appData.activeProfileId) || appData.profiles[0];
            if (profileToSelect) {
              window.selectProfile(profileToSelect.id, true);
            } else {
              console.error('[AUTH] No profiles found for chat window!');
              if (window.hideSplash) window.hideSplash();
            }
          } else if (appData.profiles.length === 1) {
            selectProfile(appData.profiles[0].id, true);
          } else {
            document.getElementById('profile-picker').style.display = 'flex';
            document.getElementById('profile-picker').classList.add('modal-active');
            try { document.body.classList.add('modal-open'); } catch (e) {}
            renderProfilePicker();
            if (appData.profiles.length === 0) {
              window.openProfileModal();
            }
          }
          return;
        }

        authFlowCompletedLocal = true;
        showAuthOverlay();
      } catch (e) {
        console.error('[AUTH] runAuthFlow error', e);
        authFlowCompletedLocal = true;
        showAuthOverlay();
      }
    })();
    return runAuthFlowPromise;
  }

  async function updateOfflineStatusIndicator() {
    if (typeof window.updateOfflineStatusIndicator === 'function') {
      window.updateOfflineStatusIndicator();
      return;
    }
    const isOnline = navigator.onLine;
    const indicator = document.getElementById('btn-offline-status');
    if (indicator) {
      if (isOnline) {
        indicator.style.setProperty('display', 'none', 'important');
      } else {
        indicator.style.removeProperty('display');
        indicator.style.display = 'flex';
      }
    }
  }

  window.addEventListener('online', updateOfflineStatusIndicator);
  window.addEventListener('offline', updateOfflineStatusIndicator);

  function initSidebarHoverTrigger() {
    const wrapper = document.querySelector('.sidebar-wrapper');
    const sidebarNav = document.getElementById('sidebar');
    if (wrapper && sidebarNav) {
      wrapper.addEventListener('mouseenter', () => {
        sidebarNav.classList.add('hovered');
      });
      wrapper.addEventListener('mouseleave', () => {
        sidebarNav.classList.remove('hovered');
      });
      sidebarNav.addEventListener('mouseenter', () => {
        sidebarNav.classList.add('hovered');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateOfflineStatusIndicator();
    initSidebarHoverTrigger();
    const indicator = document.getElementById('btn-offline-status');
    if (indicator) {
      indicator.onclick = () => {
        const modal = document.getElementById('modal-offline');
        if (modal) modal.style.display = 'flex';
      };
    }
  });

  setTimeout(() => {
    updateOfflineStatusIndicator();
    initSidebarHoverTrigger();
    const indicator = document.getElementById('btn-offline-status');
    if (indicator) {
      indicator.onclick = () => {
        const modal = document.getElementById('modal-offline');
        if (modal) modal.style.display = 'flex';
      };
    }
  }, 1000);


  // PROFILE PICKER & LOCK CODE
  function applyProfilePickerBackdrop(url) {
    const picker = document.getElementById('profile-picker');
    if (!picker) return;
    if (url) {
      const imgUrl = window.localImg(url);
      const bg = `linear-gradient(to bottom, rgba(5,5,8,0.35) 0%, rgba(5,5,8,0.75) 60%, rgba(5,5,8,0.97) 100%), url('${imgUrl}')`;
      picker.style.setProperty('background-image', bg, 'important');
      picker.style.setProperty('background-size', 'cover', 'important');
      picker.style.setProperty('background-position', 'center top', 'important');
      picker.style.setProperty('background-repeat', 'no-repeat', 'important');
      picker.style.setProperty('background-color', '#050508', 'important');
    } else {
      picker.style.removeProperty('background-image');
      picker.style.removeProperty('background-size');
      picker.style.removeProperty('background-position');
      picker.style.removeProperty('background-repeat');
      picker.style.removeProperty('background-color');
    }
  }


  function renderProfilePicker() {
    const picker = document.getElementById('profile-picker');
    if (typeof authFlowCompletedLocal !== 'undefined' && !authFlowCompletedLocal) {
      console.log('[AUTH] renderProfilePicker deferred until auth completion');
      return;
    }
    if (picker && picker.style.display === 'none') {
      window.isTransitioningAway = false;
      window.isEditingProfiles = false;
    }
    const list = document.getElementById('profile-list');
    const addBtn = document.getElementById('btn-add-profile');

    if (!list) return;

    list.querySelectorAll('.profile-item').forEach(el => el.remove());
    if (addBtn) addBtn.classList.remove('fade-out', 'selected');

    let activeProf = appData.profiles.find(p => p.id === appData.activeProfileId);
    if (!activeProf || !activeProf.banner) {
      activeProf = appData.profiles.find(p => p.banner) || appData.profiles[0];
    }

    const unifiedBanner = appData.globalBanner || (activeProf && activeProf.banner) || null;
    applyProfilePickerBackdrop(unifiedBanner);
    if (picker) picker.style.transition = 'background 0.5s ease';

    appData.profiles.forEach(p => {
      const card = document.createElement('div');
      card.className = 'profile-card profile-item';
      card.dataset.profileId = p.id;
      card.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:15px; cursor:pointer; position:relative;';
      card.onclick = () => {
        if (window.isEditingProfiles) {
          window.openProfileModal(p.id);
        } else {
          selectProfile(p.id);
        }
      };

      const disableDelete = appData.profiles.length <= 1;
      const avatarSrc = p.avatar ? window.localImg(p.avatar) : 'imgs/avatars/default.jpg';
      
      const escapeHTML = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

      card.innerHTML = `
        <div class="profile-actions" style="position:absolute; top:-10px; right:-10px; display:flex; gap:5px; opacity:${window.isEditingProfiles ? '1' : '0'}; pointer-events:${window.isEditingProfiles ? 'auto' : 'none'}; display:${window.isEditingProfiles ? 'flex' : 'none'}; transition:all 0.2s; z-index:10;">
          <button class="profile-edit-btn" title="Edit Profile" style="background:#4F46E5; color:#fff; border:none; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${disableDelete ? '' : `
          <button class="profile-delete-btn" title="Delete Profile" style="background:#EF4444; color:#fff; border:none; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`}
        </div>
        <div class="profile-avatar-box" style="width: 150px; height: 150px; border-radius: 50%; background: #222; overflow: hidden; position: relative;">
          <img src="${avatarSrc}" alt="${escapeHTML(p.name)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.onerror=null; this.src='imgs/avatars/default.jpg';">
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
          <span class="profile-name" style="color:#fff; font-size:1.1rem; font-weight:600; text-shadow:0 2px 5px rgba(0,0,0,0.8);">${escapeHTML(p.name)}</span>
          <div class="profile-age-badge" style="font-size:11px; color:rgba(255,255,255,0.7); background:rgba(0,0,0,0.5); padding:3px 10px; border-radius:12px; font-weight:600; display: ${window.isEditingProfiles ? 'none' : 'block'};">Max Age: ${p.max_age_rating || 18}</div>
        </div>
      `;

      const editBtn = card.querySelector('.profile-edit-btn');
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          window.openProfileModal(p.id);
        };
      }

      const delBtn = card.querySelector('.profile-delete-btn');
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete the profile "${p.name}"?`)) {
            const profileName = p.name;
            const profileId = p.id;
            appData.profiles = appData.profiles.filter(x => x.id !== p.id);
            if (appData.activeProfileId === p.id) appData.activeProfileId = appData.profiles[0].id;

            await window.api.invoke('delete-profile-data', profileName);

            try {
              if (window.supabase) {
                const client = getSupabaseRendererClient();
                await client.rpc('delete_profile', { profile_id: profileId });
              }
            } catch (err) {
              console.error('Failed to delete profile from cloud:', err);
            }

            persist();
            renderProfilePicker();
          }
        };
      }
      if (addBtn) list.insertBefore(card, addBtn);
      else list.appendChild(card);
    });

    if (picker) picker.style.display = 'flex';

    const editContainer = document.getElementById('edit-profiles-container');
    if (editContainer) {
      const shouldShow = !window.isTransitioningAway;
      editContainer.style.opacity = shouldShow ? '1' : '0';
      editContainer.style.pointerEvents = shouldShow ? 'auto' : 'none';
      editContainer.style.display = shouldShow ? 'flex' : 'none';
    }

    if (window.hideSplash) window.hideSplash();
  }

  function selectProfile(id, skipAnimation = false) {
    const profile = appData.profiles.find(p => p.id === id);
    if (!profile) return;

    // Immediately apply selected banner (or global fallback)
    const selBanner = profile.banner || appData.globalBanner || null;
    applyProfilePickerBackdrop(selBanner);

    window.isTransitioningAway = true;
    const editContainer = document.getElementById('edit-profiles-container');
    if (editContainer) {
      editContainer.style.opacity = '0';
      editContainer.style.pointerEvents = 'none';
      editContainer.style.display = 'none';
    }

    const picker = document.getElementById('profile-picker');
    const header = picker ? picker.querySelector('h1') : null;
    const allCards = Array.from(document.querySelectorAll('#profile-list .profile-card'));

    if (!skipAnimation && picker) {
      if (header) {
        header.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        header.style.opacity = '0';
        header.style.transform = 'translateY(-20px)';
      }

      allCards.forEach(card => {
        if (card.dataset.profileId === id) {
          card.classList.add('selected');
          const cardRect = card.getBoundingClientRect();
          const pickerRect = picker.getBoundingClientRect();
          const deltaX = (pickerRect.width / 2) - (cardRect.left + cardRect.width / 2);
          const deltaY = (pickerRect.height / 2) - (cardRect.top + cardRect.height / 2);

          card.style.transition = 'all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)';
          card.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.5)`;
          const name = card.querySelector('span');
          if (name) name.style.opacity = '0';
          const actions = card.querySelector('.profile-actions');
          if (actions) actions.style.display = 'none';
          const ageBadge = card.querySelector('.profile-age-badge');
          if (ageBadge) ageBadge.style.display = 'none';
        } else {
          card.style.transition = 'all 0.5s ease';
          card.classList.add('fade-out');
          card.style.opacity = '0';
          card.style.transform = 'scale(0.8) blur(5px)';
        }
      });
    }

    const performSelection = async () => {
      try {
        window.isEditingProfiles = false;
        const toggleBtn = document.getElementById('btn-toggle-edit-profiles');
        if (toggleBtn) {
          const label = toggleBtn.querySelector('.btn-label');
          const icon = toggleBtn.querySelector('i');
          if (label) label.textContent = 'Edit Profiles';
          else toggleBtn.textContent = 'Edit Profiles';
          if (icon) icon.className = 'fas fa-user-edit';
          toggleBtn.classList.remove('editing-active');
          toggleBtn.style.background = '';
        }
        appData.activeProfileId = id;
        currentProfile = profile;
        window.currentProfile = profile;
        isVaultUnlocked = false;
        if (typeof updateVaultUI === 'function') updateVaultUI();
        
        if (window.api && window.api.getProfilePlayback) {
          try {
            const pbData = await window.api.getProfilePlayback(profile.id);
            if (pbData) {
              currentProfile.playback = currentProfile.playback || {};
              for (const k in pbData) {
                currentProfile.playback[k] = {
                  ...currentProfile.playback[k],
                  ...pbData[k]
                };
              }
            }
          } catch (e) {
            console.warn('[PROFILES] Failed to hydrate playback from cloud:', e);
          }
        }

        const closeProfilePickerOverlay = () => {
          const pk = document.getElementById('profile-picker');
          if (pk) {
            pk.style.display = 'none';
            pk.classList.remove('modal-active');
          }
          try { document.body.classList.remove('modal-open'); } catch (e) {}
        };

        closeProfilePickerOverlay();

        if (!skipAnimation) {
          setTimeout(() => {
            if (header) {
              header.style.opacity = '';
              header.style.transform = '';
            }
            allCards.forEach(c => {
              c.classList.remove('selected', 'fade-out');
              c.style.transform = '';
              c.style.opacity = '';
              const name = c.querySelector('span');
              if (name) name.style.opacity = '';
              const actions = c.querySelector('.profile-actions');
              if (actions) actions.style.display = 'none';
            });
          }, 400);
        }

        renderProfileWidget();

        if (checkSubscriptionStatus()) return;
        startPeriodicSessionCheck();

        await scanLibrary();

        renderLibrary();
        renderSidebar();
        renderDownloadHistory();
        renderSocial();
        
        if (currentView !== 'player') {
          switchView('discover');
          renderContinueWatchingDiscover();
        }

        if (window.hideSplash) window.hideSplash();

        showToast(`Welcome back, ${profile.name}!`);
        initStremioAddonsUI();
        if (typeof initSubdlUI === 'function') {
          initSubdlUI();
        }
        if (typeof initTraktUI === 'function') {
          initTraktUI().then(() => {
            syncTraktWatchlistToLocal();
            syncTraktContinueWatching();
          });
        }

      } catch (err) {
        console.error('[PROFILES] selectProfile failed:', err);
        const closeProfilePickerOverlay = () => {
          const pk = document.getElementById('profile-picker');
          if (pk) {
            pk.style.display = 'none';
            pk.classList.remove('modal-active');
          }
          try { document.body.classList.remove('modal-open'); } catch (e) {}
        };
        closeProfilePickerOverlay();

        showToast('Could not load profile: ' + (err.message || 'unknown error'));
        if (window.hideSplash) window.hideSplash();
      }
    };

    if (skipAnimation) {
      performSelection();
    } else {
      setTimeout(performSelection, 1200);
    }
  }

  function showMobileOnboarding() {
    if (window.api?.isElectron) return;

    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.style = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);padding:20px;text-align:center;color:#fff;';

    overlay.innerHTML = `
      <div style="max-width:400px; background: rgba(30,30,45,0.95); padding: 30px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
        <div style="font-size:60px;margin-bottom:20px;">🚀</div>
        <h2 style="font-size:24px;margin-bottom:15px;font-weight:800;">Welcome to MediaVault</h2>
        <p style="opacity:0.7;line-height:1.6;margin-bottom:25px;">Ready to build your cinematic library? Let's name your mobile storage folder.</p>
        
        <div style="text-align:left; margin-bottom: 25px;">
           <label style="font-size:12px; opacity:0.5; margin-bottom:8px; display:block;">Library Name</label>
           <input id="mobile-root-input" type="text" value="MediaVault" style="width:100%; height:50px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:15px; color:#fff; padding:0 15px; font-weight:600;">
           <p style="font-size:11px; opacity:0.4; margin-top:8px;">Note: On mobile, files are saved to your system Downloads under this folder name.</p>
        </div>

        <button id="btn-mobile-start" class="btn-primary" style="width:100%;height:50px;border-radius:15px;font-weight:700;">Start Building</button>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#btn-mobile-start').onclick = async () => {
      const btn = overlay.querySelector('#btn-mobile-start');
      btn.textContent = 'Requesting Permission...';
      btn.disabled = true;

      try {
        const hasPerms = await window.api.invoke('request-filesystem-permissions');
        if (!hasPerms) {
          showToast('Storage permission is required for MediaVault to work.');
          btn.textContent = 'Retry Permissions';
          btn.disabled = false;
          return;
        }

        const rootName = overlay.querySelector('#mobile-root-input')?.value || 'MEEM';
        appData.mobileRoot = rootName;
        appData.firstRun = false;
        persist();
        overlay.remove();
        showToast('Library ready: ' + rootName);
      } catch (err) {
        console.error('[Onboarding] Permission error:', err);
        showToast('Failed to request permissions.');
        btn.textContent = 'Start Building';
        btn.disabled = false;
      }
    };
  }

  function renderProfileWidget() {
    if (!currentProfile) return;

    if (appData.globalBanner) {
      document.body.style.backgroundImage = `linear-gradient(to top, var(--bg-main) 0%, rgba(18,18,28,0.7) 100%), url('${window.localImg(appData.globalBanner)}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'top center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
    }

    const avatarUrl = window.localImg(currentProfile.avatar) || 'imgs/avatars/default.jpg';
    const titleAvatar = document.getElementById('current-profile-avatar');
    if (titleAvatar) {
      titleAvatar.src = avatarUrl;
      titleAvatar.onerror = () => { titleAvatar.onerror = null; titleAvatar.src = DEFAULT_AVATAR_SVG; };
    }

    const mainAvatar = document.getElementById('current-profile-avatar-main');
    if (mainAvatar) {
      mainAvatar.src = avatarUrl;
      mainAvatar.onerror = () => { mainAvatar.onerror = null; mainAvatar.src = DEFAULT_AVATAR_SVG; };
    }

    Array.from(document.querySelectorAll('.current-profile-avatar-main-dynamic')).forEach(img => {
      img.src = avatarUrl;
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
    });

    const mobileGlobalAvatar = document.getElementById('mobile-profile-avatar');
    if (mobileGlobalAvatar) {
      mobileGlobalAvatar.src = avatarUrl;
      mobileGlobalAvatar.onerror = () => { mobileGlobalAvatar.onerror = null; mobileGlobalAvatar.src = DEFAULT_AVATAR_SVG; };
    }

    const msAvatar = document.getElementById('myspace-avatar-img');
    if (msAvatar) {
      msAvatar.src = avatarUrl;
      msAvatar.onerror = () => { msAvatar.onerror = null; msAvatar.src = DEFAULT_AVATAR_SVG; };
    }
    const msName = document.getElementById('myspace-profile-name');
    if (msName) msName.textContent = currentProfile.name;

    const sidebarName = document.getElementById('sidebar-profile-name');
    if (sidebarName) {
      sidebarName.textContent = currentProfile.name;
    }

    const subEl = document.getElementById('myspace-subscription');
    const subPill = document.getElementById('myspace-sub-pill');
    if (subEl) {
      const sub = appData.user?.subscription_expires_at || appData.subscription_expires_at || null;
      const isPremium = sub && new Date(sub) > new Date();
      if (isPremium) {
        subEl.textContent = 'Premium';
        if (subPill) {
          const icon = subPill.querySelector('i');
          if (icon) icon.style.color = 'var(--accent)';
          subPill.style.boxShadow = '0 0 10px rgba(99, 102, 241, 0.15)';
        }
      } else {
        subEl.textContent = 'Free Tier';
        if (subPill) {
          const icon = subPill.querySelector('i');
          if (icon) icon.style.color = 'rgba(255,255,255,0.3)';
          subPill.style.boxShadow = 'none';
        }
      }
    }
    const ageEl = document.getElementById('myspace-age-rating');
    if (ageEl) {
      const maxAge = currentProfile.max_age_rating || 18;
      ageEl.textContent = maxAge >= 18 ? 'Adult (18+)' : `Under ${maxAge}`;
    }

    let widget = document.getElementById('sidebar-profile-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'sidebar-profile-widget';
      widget.className = 'profile-btn-sidebar';
      widget.onclick = () => renderProfilePicker();
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.insertBefore(widget, sidebar.firstChild);
    }
    widget.style.display = 'none';

    // Also update the settings page account banner whenever profile widget is refreshed
    try {
      const avatarSrc = window.localImg ? window.localImg(currentProfile.avatar) : (currentProfile.avatar || 'imgs/appicon-w.png');
      const displayName = (appData.user?.user_metadata?.username || appData.user?.user_metadata?.display_name || appData.user?.user_metadata?.full_name || currentProfile?.name || 'My Account');
      const displayEmail = appData.user?.email || `Profile: ${currentProfile.name}`;

      const settingsAvatar = document.getElementById('settings-user-avatar');
      if (settingsAvatar) {
        settingsAvatar.src = avatarSrc || 'imgs/appicon-w.png';
        settingsAvatar.onerror = () => { settingsAvatar.onerror = null; settingsAvatar.src = 'imgs/appicon-w.png'; };
      }
      const settingsName = document.getElementById('settings-user-name');
      if (settingsName) settingsName.textContent = displayName;
      const settingsEmail = document.getElementById('settings-user-email');
      if (settingsEmail) settingsEmail.textContent = displayEmail;

      const bannerUrl = currentProfile.banner || appData.globalBanner;
      const coverEl = document.querySelector('#settings-account-banner .settings-account-cover');
      if (coverEl && bannerUrl && window.localImg) {
        coverEl.style.backgroundImage = `linear-gradient(135deg, rgba(99,102,241,0.7), rgba(168,85,247,0.7)), url('${window.localImg(bannerUrl)}')`;
        coverEl.style.backgroundSize = 'cover';
        coverEl.style.backgroundPosition = 'center';
      }

      const sub = appData.user?.subscription_expires_at || appData.subscription_expires_at;
      const isPremium = sub && new Date(sub) > new Date();
      const proBadge = document.querySelector('#settings-account-banner .account-tag-badge.active');
      if (proBadge) proBadge.innerHTML = isPremium ? '<i class="fas fa-shield-alt"></i> PRO Active' : '<i class="fas fa-user"></i> Free Tier';
    } catch (e) { /* ignore */ }
  }

  function compressImageFile(file, maxWidth) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function openProfileModal(id = null) {
    editingProfileId = id;
    const profile = id ? appData.profiles.find(p => p.id === id) : null;

    const modalTitle = document.getElementById('inline-profile-title') || document.querySelector('#profile-modal h2');
    const confirmBtn = document.getElementById('profile-confirm');
    const nameInput = document.getElementById('profile-name-input');

    if (modalTitle) modalTitle.textContent = id ? 'Edit Profile' : 'Create Profile';
    if (confirmBtn) confirmBtn.textContent = id ? 'Save Changes' : 'Create';
    if (nameInput) nameInput.value = profile ? profile.name : '';

    const ageInput = document.getElementById('profile-age-input');
    if (ageInput) {
      ageInput.value = (profile && typeof profile.max_age_rating !== 'undefined') ? profile.max_age_rating : '18';
    }

    selectedAvatar = profile ? profile.avatar : AVATARS[0];

    const picker = document.getElementById('profile-picker');
    if (picker) {
      picker.style.display = 'flex';
      picker.classList.add('modal-active');
      try { document.body.classList.add('modal-open'); } catch (e) { /* ignore */ }
    }
    const modal = document.getElementById('profile-editor-inline');
    if (modal) {
      const pMain = document.getElementById('profile-picker-main');
      if (pMain) pMain.style.display = 'none';
      modal.style.display = 'flex';
    }
    const selector = document.getElementById('avatar-selector');
    if (!selector) return;

    selector.innerHTML = '';

    AVATARS.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'avatar-opt' + (url === selectedAvatar ? ' selected' : '');
      img.style.borderRadius = '50%';
      img.style.objectFit = 'cover';
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = url;
        const targetId = editingProfileId;
        const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
        if (prof) {
          prof.avatar = url;
          persist();
          renderProfilePicker();
          renderProfileWidget();
          renderAccount();
        }
      };
      selector.appendChild(img);
    });

    if (selectedAvatar && !AVATARS.includes(selectedAvatar)) {
      const img = document.createElement('img');
      img.src = window.localImg(selectedAvatar);
      img.className = 'avatar-opt selected';
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = profile.avatar;
        const targetId = editingProfileId;
        const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
        if (prof) {
          prof.avatar = selectedAvatar;
          persist();
          renderProfilePicker();
          renderProfileWidget();
          renderAccount();
        }
      };
      selector.appendChild(img);
    }

    const uploadBtn = document.createElement('div');
    uploadBtn.id = 'btn-upload-avatar';
    uploadBtn.className = 'avatar-opt upload-opt';
    uploadBtn.title = 'Upload Custom Avatar';
    uploadBtn.innerHTML = `
      <div class="upload-vibe">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>`;
    uploadBtn.onclick = async () => {
      let pathOrDataUrl = null;
      if (window.api?.isElectron) {
        try {
          pathOrDataUrl = await window.api.invoke('select-user-avatar');
        } catch (err) {
          console.error('[Avatar Upload Error]', err);
          showToast('Failed to select avatar.');
          return;
        }
      } else {
        pathOrDataUrl = await new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) { resolve(null); return; }
            try {
              const dataUrl = await compressImageFile(file, 300);
              resolve(dataUrl);
            } catch (err) {
              console.error('[Avatar Upload Error]', err);
              showToast('Failed to process image.');
              resolve(null);
            }
          };
          input.click();
        });
      }

      if (!pathOrDataUrl) return;

      try {
        if (window.supabase) {
          showToast('Uploading avatar to cloud...', 'info');
          const client = getSupabaseRendererClient();
          
          let blob;
          if (pathOrDataUrl.startsWith('data:')) {
            const res = await fetch(pathOrDataUrl);
            blob = await res.blob();
          } else {
            const res = await fetch(window.localImg(pathOrDataUrl));
            blob = await res.blob();
          }

          const fileName = `avatar_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
          
          const { data, error } = await client.storage.from('avatars').upload(fileName, blob, {
            cacheControl: '3600',
            upsert: false,
            contentType: blob.type || 'image/jpeg'
          });
          
          if (error) {
            console.error('Supabase upload error:', error);
            showToast('Cloud upload failed, using local copy.');
            setSelectedAvatar(pathOrDataUrl);
          } else {
            const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(fileName);
            const publicUrl = publicUrlData.publicUrl;
            setSelectedAvatar(publicUrl);
            const targetId = editingProfileId;
            const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
            if (prof) { prof.avatar = publicUrl; persist(); }
            showToast('Avatar uploaded successfully!');
          }
        } else {
          setSelectedAvatar(pathOrDataUrl);
          showToast('Avatar saved locally!');
        }
      } catch (err) {
        console.error('[Avatar Upload Error]', err);
        showToast('Failed to upload avatar.');
        setSelectedAvatar(pathOrDataUrl);
      }
    };
    
    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.id = 'btn-avatar-from-favs';
    favBtn.className = 'avatar-opt fav-opt';
    favBtn.title = 'Choose from favorites';
    favBtn.setAttribute('aria-label', 'Choose avatar from favorites');
    favBtn.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-size:12px;color:rgba(255,255,255,0.9)"><i class="fas fa-search" style="font-size:18px"></i><div style="font-size:10px;margin-top:4px">Browse</div></div>`;
    favBtn.onclick = () => openFavoritesAvatarModal('avatar');

    selector.appendChild(favBtn);
    selector.appendChild(uploadBtn);

    if (nameInput) nameInput.focus();
  }

  function renderAccount() {
    const view = document.getElementById('view-account'); if (!view) return;
    const isCloud = appData.authenticated || appData.user;

    const activeProf = appData.profiles?.find(p => p.id === appData.activeProfileId) || currentProfile;
    const bannerUrl = activeProf?.banner || appData.globalBanner;
    const bannerContainer = view.querySelector('#account-banner-container');
    if (bannerContainer) {
      if (bannerUrl) {
        bannerContainer.style.backgroundImage = `url('${window.localImg(bannerUrl)}')`;
        bannerContainer.style.display = 'block';
      } else {
        bannerContainer.style.backgroundImage = '';
        bannerContainer.style.display = 'none';
      }
    }
    view.style.removeProperty('background-image');
    
    const emailDisplay = view.querySelector('#account-page-email');
    const usernameDisplay = view.querySelector('#account-page-name');
    const avatarImg = view.querySelector('#account-page-avatar img');
    const subDisplay = view.querySelector('#account-page-sub');

    const ageSelect = view.querySelector('#account-age-rating');
    if (ageSelect && currentProfile) {
      ageSelect.value = typeof currentProfile.max_age_rating !== 'undefined' ? currentProfile.max_age_rating : '18';
    }

    if (emailDisplay) emailDisplay.textContent = appData.user?.email || (isCloud ? 'Cloud Account' : 'Local Account');
    if (usernameDisplay) usernameDisplay.textContent = appData.user?.user_metadata?.username || appData.user?.user_metadata?.display_name || appData.user?.user_metadata?.full_name || currentProfile?.name || 'Master Account';
    
    if (avatarImg) {
      avatarImg.src = window.localImg(currentProfile?.avatar) || 'imgs/avatars/default.jpg';
      avatarImg.onerror = () => { avatarImg.onerror = null; avatarImg.src = DEFAULT_AVATAR_SVG; };
    }

    const linkedProviderEl = view.querySelector('#account-linked-provider');
    if (linkedProviderEl) {
      const identities = appData.user?.identities || [];
      const providers = identities.map(id => id.provider).filter(Boolean);
      const appMeta = appData.user?.app_metadata || {};
      const metaProvider = appMeta.provider || appMeta.providers?.[0];
      const allProviders = [...new Set([...providers, metaProvider])].filter(Boolean);
      if (allProviders.length) {
        const providerBadges = allProviders.map(p => {
          const icon = p === 'google' ? '<svg style="width:14px;height:14px;vertical-align:middle;margin-right:4px;" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.5 29.6 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.9 0 20-7.9 20-21 0-1.4-.1-2.7-.5-4z"/></svg>'
                       : p === 'discord' ? '<i class="fab fa-discord" style="margin-right:4px;color:#5865F2;"></i>'
                       : '<i class="fas fa-link" style="margin-right:4px;"></i>';
          return `<span style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600;">${icon}${p.charAt(0).toUpperCase()+p.slice(1)}</span>`;
        }).join(' ');
        linkedProviderEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);margin-right:8px;">Connected with</span>' + providerBadges;
        linkedProviderEl.style.display = 'flex';
        linkedProviderEl.style.alignItems = 'center';
        linkedProviderEl.style.flexWrap = 'wrap';
        linkedProviderEl.style.gap = '6px';
        linkedProviderEl.style.marginTop = '6px';
      } else {
        linkedProviderEl.style.display = 'none';
      }
    }
    
    const subExpires = view.querySelector('#account-page-sub-expires');
    if (subDisplay) {
      const sub = appData.user?.subscription_expires_at || appData.subscription_expires_at || null;
      const isPremium = sub && new Date(sub) > new Date();
      if (isPremium) {
        subDisplay.textContent = 'Premium';
        subDisplay.style.color = 'var(--accent)';
        if (subExpires) {
          try {
            subExpires.textContent = new Date(sub).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
          } catch (e) {
            subExpires.textContent = sub;
          }
          subExpires.style.color = '#a855f7';
        }
      } else {
        subDisplay.textContent = 'Free Tier';
        subDisplay.style.color = 'var(--text-muted)';
        if (subExpires) {
          subExpires.textContent = 'Not Active';
          subExpires.style.color = 'var(--text-muted)';
        }
      }
    }

    const btnLogout = view.querySelector('#account-page-logout');
    if (btnLogout) btnLogout.onclick = performLogout;

    const btnUpdateUsername = view.querySelector('#account-update-username-btn');
    const inputUsername = view.querySelector('#account-new-username');
    if (btnUpdateUsername && inputUsername) {
      btnUpdateUsername.onclick = async () => {
        const newName = inputUsername.value;
        if (newName && newName.trim()) {
          try {
            const client = getSupabaseRendererClient();
            const { data, error } = await client.auth.updateUser({
              data: { username: newName.trim(), display_name: newName.trim(), full_name: newName.trim() }
            });
            if (error) throw error;
            
            appData.user.user_metadata = data.user.user_metadata || appData.user.user_metadata || {};
            appData.user.user_metadata.username = newName.trim();
            appData.user.user_metadata.display_name = newName.trim();
            usernameDisplay.textContent = newName.trim();
            inputUsername.value = '';
            persist();
            showToast('Username updated successfully');
            renderAccount();
          } catch (err) {
            showToast('Update failed: ' + err.message);
          }
        }
      };
    }

    const btnUpdateAge = view.querySelector('#account-update-age-btn');
    const selectAge = view.querySelector('#account-age-rating');
    if (btnUpdateAge && selectAge) {
      btnUpdateAge.onclick = async () => {
        if (!currentProfile) return;
        const newRating = parseInt(selectAge.value, 10);
        
        currentProfile.max_age_rating = newRating;
        const profile = appData.profiles.find(p => p.id === currentProfile.id);
        if (profile) {
          profile.max_age_rating = newRating;
        }
        
        persist();
        showToast('Age rating restrictions updated successfully');
        
        // Force refresh all grids/views
        if (typeof window.renderMovies === 'function') window.renderMovies();
        if (typeof window.renderShows === 'function') window.renderShows();
        if (typeof window.renderWatchlist === 'function') window.renderWatchlist();
        if (typeof window.renderContinueWatchingDiscover === 'function') window.renderContinueWatchingDiscover();
        
        const discHero = document.getElementById('discover-hero');
        if (discHero) {
          const activeCat = document.querySelector('.discover-sidebar .nav-btn.active');
          if (activeCat) activeCat.click();
        }
      };
    }

    const btnSwitchProfile = view.querySelector('#account-page-switch-profile');
    if (btnSwitchProfile) {
      btnSwitchProfile.onclick = () => {
        renderProfilePicker();
      };
    }

    const btnResetPassword = view.querySelector('#account-reset-password-btn');
    if (btnResetPassword) {
      btnResetPassword.onclick = async () => {
        try {
          const client = getSupabaseRendererClient();
          if (!appData.user?.email) throw new Error('No email associated with this account');
          
          btnResetPassword.disabled = true;
          const label = btnResetPassword.querySelector('span');
          const icon = btnResetPassword.querySelector('i');
          if (icon) icon.className = 'fas fa-spinner fa-spin';
          if (label) label.textContent = 'Sending...';
          
          const { error } = await client.auth.resetPasswordForEmail(appData.user.email);
          if (error) throw error;
          
          showToast('Reset code sent! Check your inbox.');
          const modal = document.getElementById('modal-password-reset-otp');
          if (modal) modal.style.display = 'flex';
        } catch (err) {
          showToast('Failed to send reset email: ' + err.message);
        } finally {
          btnResetPassword.disabled = false;
          const label = btnResetPassword.querySelector('span');
          const icon = btnResetPassword.querySelector('i');
          if (icon) icon.className = 'fas fa-key';
          if (label) label.textContent = 'Reset Password';
        }
      };
    }

    const btnUpdateEmail = view.querySelector('#account-update-email-btn');
    const inputEmail = view.querySelector('#account-new-email');
    if (btnUpdateEmail && inputEmail) {
      btnUpdateEmail.onclick = async () => {
        const newEmail = inputEmail.value.trim();
        if (newEmail && newEmail.includes('@')) {
          try {
            const client = getSupabaseRendererClient();
            btnUpdateEmail.disabled = true;
            btnUpdateEmail.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
            
            const { error } = await client.auth.updateUser({
              email: newEmail
            });
            if (error) throw error;
            
            showToast('Verification code sent to your new email.');
            inputEmail.value = '';
            
            const modal = document.getElementById('modal-email-change-otp');
            if (modal) {
              modal.dataset.newEmail = newEmail;
              modal.style.display = 'flex';
            }
          } catch (err) {
            showToast('Failed to update email: ' + err.message);
          } finally {
            btnUpdateEmail.disabled = false;
            btnUpdateEmail.innerHTML = 'Update Email';
          }
        } else {
          showToast('Please enter a valid email address.');
        }
      };
    }

    // Fetch and bind allow_invitations toggle
    const allowInvitesCheckbox = view.querySelector('#account-allow-invites');
    if (allowInvitesCheckbox && isCloud) {
      allowInvitesCheckbox.disabled = true;
      (async () => {
        try {
          const res = await window.api.invoke('cloud-get-allow-invitations');
          if (res.success) {
            allowInvitesCheckbox.checked = res.allow_invitations;
          }
        } catch (e) {
          console.warn('[ACCOUNT] Failed to load allow_invitations:', e);
        } finally {
          allowInvitesCheckbox.disabled = false;
        }
      })();

      allowInvitesCheckbox.onclick = async () => {
        const isChecked = allowInvitesCheckbox.checked;
        allowInvitesCheckbox.disabled = true;
        try {
          const res = await window.api.invoke('cloud-set-allow-invitations', { allowInvitations: isChecked });
          if (!res.success) throw new Error(res.error || 'Update failed');
          showToast(isChecked ? 'Invitations enabled' : 'Invitations disabled');
        } catch (e) {
          showToast('Failed to save settings: ' + e.message);
          allowInvitesCheckbox.checked = !isChecked; // revert
        } finally {
          allowInvitesCheckbox.disabled = false;
        }
      };
    }
  }

  function createFavModal() {
    if (document.getElementById('fav-avatar-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'fav-avatar-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.style.zIndex = '2000020';
    modal.style.cssText += 'background: var(--bg-base) !important;';
    modal.innerHTML = `
      <div class="acoustic-waves-bg">
        <div class="wave wave1"></div>
        <div class="wave wave2"></div>
        <div class="wave wave3"></div>
      </div>
      <div class="modal-card tmdb-search-modal" style="width: 100%; height: 100%; max-width: none; background: transparent; border: none; box-shadow: none; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; z-index: 10;">
        <button class="modal-close-custom" id="fav-modal-close" style="position: fixed; top: 40px; left: 40px; width: 50px; height: 50px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 100; transition: all 0.3s;">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div class="search-container" style="width: 1000px; max-width: 90vw; text-align: center;">
          <h2 style="font-size: 3rem; font-weight: 800; color: #fff; margin-bottom: 40px; letter-spacing: -1.5px;">Choose Asset</h2>
          
          <div class="search-box" style="width: 100%; max-width: none; margin-bottom: 40px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.15); border-radius: 30px; height: 90px; padding: 0 15px 0 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 15px;">
            <i class="fas fa-search" style="font-size: 30px; color: var(--accent); margin-right: 10px;"></i>
            <input type="text" id="fav-search-input" placeholder="Search movies, shows or anime..." style="font-size: 24px; font-weight: 700; flex: 1; background: transparent; border: none; outline: none; color: #fff;">
            
            <button id="btn-upload-custom-banner" style="display: none; align-items: center; gap: 8px; background: var(--accent); color: #000; border: none; border-radius: 20px; padding: 10px 20px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.3s; margin-right: 15px;">
              <i class="fas fa-upload"></i> Upload custom banner
            </button>

            <div id="fav-search-source" style="display: none;"></div>
          </div>

          <div id="fav-main-container" style="width: 100%; min-height: 500px; height: 60vh; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.15); border-radius: 30px; overflow: hidden; position: relative; display: flex; flex-direction: column;">
            <div id="fav-back-btn" style="display: none; align-items: center; gap: 10px; padding: 20px 30px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: background 0.3s; z-index: 10;">
              <i class="fas fa-arrow-left" style="color: var(--accent);"></i>
              <span style="font-weight: 700; font-size: 1.1rem;">Back to List</span>
            </div>
            <div id="fav-results-list" class="tmdb-result-grid" style="flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; padding: 30px; align-items: start;"></div>
            <div id="fav-media-grid" class="tmdb-result-grid" style="display: none; flex: 1; overflow: hidden; position: relative; width: 100%; height: 100%;"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const closeBtn = document.getElementById('fav-modal-close');
    const backBtn = document.getElementById('fav-back-btn');
    const searchInput = document.getElementById('fav-search-input');
    const uploadCustomBannerBtn = document.getElementById('btn-upload-custom-banner');

    if (closeBtn) {
      closeBtn.onclick = () => { 
        if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
        modal.style.display = 'none'; 
        modal.classList.remove('modal-active');
        try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
      };
    }
    if (backBtn) {
      backBtn.onclick = () => {
        const resultsList = document.getElementById('fav-results-list');
        const mediaGrid = document.getElementById('fav-media-grid');
        if (resultsList) resultsList.style.display = 'grid';
        if (mediaGrid) mediaGrid.style.display = 'none';
        backBtn.style.display = 'none';
      };
    }

    let searchTimeout = null;
    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const val = e.target.value;
        searchTimeout = setTimeout(() => {
          const resultsList = document.getElementById('fav-results-list');
          const mediaGrid = document.getElementById('fav-media-grid');
          if (resultsList) resultsList.style.display = 'grid';
          if (mediaGrid) mediaGrid.style.display = 'none';
          if (backBtn) backBtn.style.display = 'none';
          populateFavResults(val);
        }, 500);
      };
    }

    if (uploadCustomBannerBtn) {
      uploadCustomBannerBtn.onclick = async () => {
        let pathOrDataUrl = null;
        if (window.api?.isElectron) {
          try {
            pathOrDataUrl = await window.api.invoke('select-user-banner');
          } catch (err) {
            console.error('[Banner Upload Error]', err);
            showToast('Failed to select banner.');
            return;
          }
        } else {
          pathOrDataUrl = await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
              const file = e.target.files?.[0];
              if (!file) { resolve(null); return; }
              try {
                const dataUrl = await compressImageFile(file, 1200);
                resolve(dataUrl);
              } catch (err) {
                console.error('[Banner Upload Error]', err);
                showToast('Failed to process image.');
                resolve(null);
              }
            };
            input.click();
          });
        }

        if (!pathOrDataUrl) return;

        try {
          if (window.supabase) {
            showToast('Uploading banner to cloud...', 'info');
            const client = getSupabaseRendererClient();
            
            let blob;
            if (pathOrDataUrl.startsWith('data:')) {
              const res = await fetch(pathOrDataUrl);
              blob = await res.blob();
            } else {
              const res = await fetch(window.localImg(pathOrDataUrl));
              blob = await res.blob();
            }

            const fileName = `banners/banner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
            
            const { data, error } = await client.storage.from('avatars').upload(fileName, blob, {
              cacheControl: '3600',
              upsert: false,
              contentType: blob.type || 'image/jpeg'
            });
            
            if (error) {
              console.error('Supabase upload error:', error);
              showToast('Cloud upload failed, using local copy.');
              setSelectedBanner(pathOrDataUrl);
            } else {
              const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(fileName);
              const publicUrl = publicUrlData.publicUrl;
              let safePath = pathOrDataUrl.replace(/\\/g, "/");
              let localUrl;
              const hasSeparators = safePath.includes('/') || safePath.includes('\\');
              if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith("/") || !hasSeparators) {
                if (safePath.match(/^[a-zA-Z]:/)) {
                  localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                } else if (safePath.startsWith("/")) {
                  localUrl = "media-img:///" + encodeURI(safePath.slice(1)).replace(/#/g, "%23").replace(/\?/g, "%3F");
                } else {
                  localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                }
              } else {
                localUrl = "local-file://" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
              }
              localStorage.setItem('cache_banner_' + publicUrl, localUrl);
              setSelectedBanner(publicUrl);
              showToast('Banner uploaded successfully!');
              
              const m = document.getElementById('fav-avatar-modal');
              if (m) {
                if (m._bannerCleanup) { m._bannerCleanup(); m._bannerCleanup = null; }
                m.style.display = 'none';
                m.classList.remove('modal-active');
                try { document.body.classList.remove('modal-open'); } catch (e) {}
              }
            }
          } else {
            setSelectedBanner(pathOrDataUrl);
            showToast('Banner saved locally!');
            
            const m = document.getElementById('fav-avatar-modal');
            if (m) {
              if (m._bannerCleanup) { m._bannerCleanup(); m._bannerCleanup = null; }
              m.style.display = 'none';
              m.classList.remove('modal-active');
              try { document.body.classList.remove('modal-open'); } catch (e) {}
            }
          }
        } catch (err) {
          console.error('[Banner Upload Error]', err);
          showToast('Failed to upload banner.');
          setSelectedBanner(pathOrDataUrl);
          
          const m = document.getElementById('fav-avatar-modal');
          if (m) {
            if (m._bannerCleanup) { m._bannerCleanup(); m._bannerCleanup = null; }
            m.style.display = 'none';
            m.classList.remove('modal-active');
            try { document.body.classList.remove('modal-open'); } catch (e) {}
          }
        }
      };
    }
  }

  function openFavoritesAvatarModal(mode = 'avatar') {
    if (mode === 'banner' && window.AppCapabilities && !window.AppCapabilities.can('banner-search')) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Banner search requires Cinemeta or TMDB add-on to be installed');
      }
      return;
    }
    window.currentFavModalMode = mode;
    createFavModal();
    const title = document.querySelector('#fav-avatar-modal h2');
    if (title) title.textContent = mode === 'avatar' ? 'Choose Avatar' : 'Choose Banner';
    
    const uploadBtn = document.getElementById('btn-upload-custom-banner');
    if (uploadBtn) {
      uploadBtn.style.display = mode === 'banner' ? 'flex' : 'none';
    }

    // Dynamic re-binding of DOM listeners to ensure the active file context's callbacks are triggered
    const modal = document.getElementById('fav-avatar-modal');
    if (modal) {
      const closeBtn = document.getElementById('fav-modal-close');
      if (closeBtn) {
        closeBtn.onclick = () => { 
          if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
          modal.style.display = 'none'; 
          modal.classList.remove('modal-active');
          try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
        };
      }

      const backBtn = document.getElementById('fav-back-btn');
      if (backBtn) {
        backBtn.onclick = () => {
          const resultsList = document.getElementById('fav-results-list');
          const mediaGrid = document.getElementById('fav-media-grid');
          if (resultsList) resultsList.style.display = 'grid';
          if (mediaGrid) mediaGrid.style.display = 'none';
          backBtn.style.display = 'none';
        };
      }

      const searchInput = document.getElementById('fav-search-input');
      if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = (e) => {
          clearTimeout(searchInput._searchTimeout);
          const val = e.target.value;
          searchInput._searchTimeout = setTimeout(() => {
            const resultsList = document.getElementById('fav-results-list');
            const mediaGrid = document.getElementById('fav-media-grid');
            if (resultsList) resultsList.style.display = 'grid';
            if (mediaGrid) mediaGrid.style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
            populateFavResults(val);
          }, 500);
        };
      }

      const uploadCustomBannerBtn = document.getElementById('btn-upload-custom-banner');
      if (uploadCustomBannerBtn) {
        uploadCustomBannerBtn.onclick = async () => {
          let pathOrDataUrl = null;
          if (window.api?.isElectron) {
            try {
              pathOrDataUrl = await window.api.invoke('select-user-banner');
            } catch (err) {
              console.error('[Banner Upload Error]', err);
              showToast('Failed to select banner.');
              return;
            }
          } else {
            pathOrDataUrl = await new Promise((resolve) => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = async (e) => {
                const file = e.target.files?.[0];
                if (!file) { resolve(null); return; }
                try {
                  const dataUrl = await compressImageFile(file, 1200);
                  resolve(dataUrl);
                } catch (err) {
                  console.error('[Banner Upload Error]', err);
                  showToast('Failed to process image.');
                  resolve(null);
                }
              };
              input.click();
            });
          }

          if (!pathOrDataUrl) return;

          try {
            if (window.supabase) {
              showToast('Uploading banner to cloud...', 'info');
              const client = getSupabaseRendererClient();
              
              let blob;
              if (pathOrDataUrl.startsWith('data:')) {
                const res = await fetch(pathOrDataUrl);
                blob = await res.blob();
              } else {
                const res = await fetch(window.localImg(pathOrDataUrl));
                blob = await res.blob();
              }

              const fileName = `banners/banner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
              
              const { data, error } = await client.storage.from('avatars').upload(fileName, blob, {
                cacheControl: '3600',
                upsert: false,
                contentType: blob.type || 'image/jpeg'
              });
              
              if (error) {
                console.error('Supabase upload error:', error);
                showToast('Cloud upload failed, using local copy.');
                setSelectedBanner(pathOrDataUrl);
              } else {
                const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(fileName);
                const publicUrl = publicUrlData.publicUrl;
                let safePath = pathOrDataUrl.replace(/\\/g, "/");
                let localUrl;
                const hasSeparators = safePath.includes('/') || safePath.includes('\\');
                if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith("/") || !hasSeparators) {
                  if (safePath.match(/^[a-zA-Z]:/)) {
                    localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                  } else if (safePath.startsWith("/")) {
                    localUrl = "media-img:///" + encodeURI(safePath.slice(1)).replace(/#/g, "%23").replace(/\?/g, "%3F");
                  } else {
                    localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                  }
                } else {
                  localUrl = "local-file://" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                }
                localStorage.setItem('cache_banner_' + publicUrl, localUrl);
                setSelectedBanner(publicUrl);
                showToast('Banner uploaded successfully!');
                
                if (modal) {
                  if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
                  modal.style.display = 'none';
                  modal.classList.remove('modal-active');
                  try { document.body.classList.remove('modal-open'); } catch (e) {}
                }
              }
            } else {
              setSelectedBanner(pathOrDataUrl);
              showToast('Banner saved locally!');
              
              if (modal) {
                if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
                modal.style.display = 'none';
                modal.classList.remove('modal-active');
                try { document.body.classList.remove('modal-open'); } catch (e) {}
              }
            }
          } catch (err) {
            console.error('[Banner Upload Error]', err);
            showToast('Failed to upload banner.');
            setSelectedBanner(pathOrDataUrl);
            
            if (modal) {
              if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
              modal.style.display = 'none';
              modal.classList.remove('modal-active');
              try { document.body.classList.remove('modal-open'); } catch (e) {}
            }
          }
        };
      }
    }

    populateFavResults('');
    const m = document.getElementById('fav-avatar-modal'); if (m) {
      document.querySelectorAll('body > .modal-overlay.modal-active').forEach(el => el.classList.remove('modal-active'));
      m.classList.add('modal-active');
      m.style.display = 'flex';
      try { document.body.classList.add('modal-open'); } catch (e) { /* ignore */ }
      setTimeout(() => { m.style.opacity = '1'; }, 10);
    }
  }

  async function searchUnified(query) {
    try {
      const q = (query || '').trim();
      if (!q) return [];
      console.log('[Unified Search] Searching for:', q);
      const result = await window.api.unifiedSearch(q);
      return result?.results || [];
    } catch (err) {
      console.error('[Search Error]', err);
      return [];
    }
  }

  async function populateFavResults(filter) {
    const list = document.getElementById('fav-results-list');
    const grid = document.getElementById('fav-media-grid');
    if (!list || !grid) return;
    list.innerHTML = '';
    grid.innerHTML = '';

    const q = (filter || '').trim();
    let results = [];

    const escapeHTML = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

    if (!q) {
      const isBannerMode = window.currentFavModalMode === 'banner';
      list.innerHTML = `
        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 400px; opacity: 0.6;">
          <div style="background: rgba(109, 40, 217, 0.1); width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 25px;">
            <i class="fas ${isBannerMode ? 'fa-image' : 'fa-search-plus'}" style="font-size: 40px; color: var(--accent);"></i>
          </div>
          <h3 style="font-size: 1.8rem; font-weight: 800; color: #fff; margin-bottom: 10px;">${isBannerMode ? 'Find a Movie or Show' : 'Start your search'}</h3>
          <p style="color: rgba(255,255,255,0.5); font-weight: 500;">${isBannerMode ? 'Search for a title to find beautiful banners' : 'Search Jikan or TMDB'}</p>
        </div>
      `;
      return;
    } else {
      list.innerHTML = '<div style="grid-column: 1 / -1; padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--accent);"></i></div>';
      try {
        if (window.currentFavModalMode === 'avatar') {
          try {
            const al = await window.api.invoke('anilist-search', q);
            if (al && al.length) {
              const chars = al.filter(r => r.type === 'character');
              if (chars.length) results = chars;
              else results = al;
            } else {
              const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=15`);
              const data = await res.json();
              results = (data.data || []).map(c => ({
                id: c.mal_id,
                title: c.name,
                poster: c.images?.webp?.image_url || c.images?.jpg?.image_url,
                source: 'jikan',
                type: 'character'
              }));
            }
          } catch (e) {
            try {
              const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=15`);
              const data = await res.json();
              results = (data.data || []).map(c => ({
                id: c.mal_id,
                title: c.name,
                poster: c.images?.webp?.image_url || c.images?.jpg?.image_url,
                source: 'jikan',
                type: 'character'
              }));
            } catch (err2) {
              results = [];
            }
          }
        } else if (window.currentFavModalMode === 'banner') {
          if (window.AppCapabilities && !window.AppCapabilities.can('banner-search')) {
            list.innerHTML = `<div style="grid-column: 1 / -1; padding:40px; text-align:center; color:rgba(255,255,255,0.6);">
              <i class="fas fa-plug-circle-xmark" style="font-size:2.5rem; color:var(--accent); margin-bottom:15px; display:block;"></i>
              Banner search requires Cinemeta or TMDB add-on to be installed.
            </div>`;
            return;
          }
          const res = await window.api.invoke('cinemeta-search', q);
          results = res?.results || [];
        } else {
          results = await searchUnified(q);
        }
        if (!results.length) {
          list.innerHTML = `<div style="grid-column: 1 / -1; padding:40px; text-align:center; color:rgba(255,255,255,0.4);">No matches found for "${escapeHTML(q)}" on Jikan/TMDB.</div>`;
          return;
        }
        list.innerHTML = '';
      } catch (err) {
        list.innerHTML = '<div style="grid-column: 1 / -1; padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Search failed.</div>';
        return;
      }
    }

    results.forEach(item => {
      const title = item.title || item.name || item.name_en || item.title_english || '';
      const el = document.createElement('div');
      el.className = 'fav-list-item';
      el.style = 'cursor:pointer; text-align:center; padding:15px; border-radius:24px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1); display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';

      el.onmouseenter = () => {
        el.style.transform = 'translateY(-8px) scale(1.03)';
        el.style.background = 'rgba(255,255,255,0.08)';
        el.style.borderColor = 'var(--accent)';
        el.style.boxShadow = '0 15px 35px rgba(0,0,0,0.4)';
      };
      el.onmouseleave = () => {
        el.style.transform = 'translateY(0) scale(1)';
        el.style.background = 'rgba(255,255,255,0.04)';
        el.style.borderColor = 'rgba(255,255,255,0.08)';
        el.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
      };

      const poster = item.poster || item.poster_path || 'imgs/no-backdrop.png';
      el.innerHTML = `
        <div style="width: 100%; aspect-ratio: 2/3; overflow: hidden; border-radius: 16px; margin-bottom: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); position: relative;">
          <img src="${window.localImg(poster)}" alt="${escapeHTML(title)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='imgs/no-backdrop.png'">
          <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%); pointer-events: none;"></div>
        </div>
        <div style="font-size: 13.5px; font-weight: 800; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; padding: 0 5px; min-height: 2.6em; text-shadow: 0 2px 10px rgba(0,0,0,0.5);">${escapeHTML(title)}</div>
      `;
      
      el.onclick = () => {
        if (window.currentFavModalMode === 'avatar' && (item.type === 'character' || item.source === 'jikan' || item.source === 'anilist')) {
          const src = item.poster || item.poster_path || item.image;
          if (src) {
            setSelectedAvatar(src.startsWith('http') ? src : window.localImg(src));
            showToast('Avatar updated');
            const _m = document.getElementById('fav-avatar-modal');
            if (_m) { _m.style.display = 'none'; _m.classList.remove('modal-active'); }
            try { document.body.classList.remove('modal-open'); } catch (e) { }
            return;
          }
        }
        const resultsList = document.getElementById('fav-results-list');
        const mediaGrid = document.getElementById('fav-media-grid');
        const backBtn = document.getElementById('fav-back-btn');
        if (resultsList) resultsList.style.display = 'none';
        if (mediaGrid) mediaGrid.style.display = 'grid';
        if (backBtn) backBtn.style.display = 'flex';
        if (mediaGrid) mediaGrid.innerHTML = '<div style="grid-column: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--accent); margin-bottom:15px;"></i><div>Fetching cinematic assets...</div></div>';
        fetchFavoriteAssets(item, mediaGrid);
      };
      list.appendChild(el);
    });
  }

  async function fetchKitsuAvatars(item) {
    try {
      let kitsuId = item.kitsuId || item.kitsu_id;
      const title = item.title || item.name || item.name_en || item.title_english || '';

      if (!kitsuId && title) {
        const kSearch = await window.api.invoke('kitsu-search', title);
        if (kSearch?.results?.length > 0) {
          kitsuId = kSearch.results[0].id;
        }
      }

      if (!kitsuId) return [];

      const cast = await window.api.invoke('kitsu-cast', kitsuId);
      if (cast && cast.length) {
        return cast.filter(c => c.profile_path || c.image).map(c => ({
          src: c.profile_path || c.image,
          label: (c.character || c.name) + (c.role ? ` • ${c.role}` : ''),
          type: 'avatar'
        }));
      }
    } catch (err) {
      console.error('[Kitsu Error]', err);
    }
    return [];
  }

  async function fetchFavoriteAssets(item, targetGrid) {
    try {
      let type = item.media_type || item.type || (item.title ? 'movie' : 'tv');
      let id = item.tmdbId || item.id;
      const isAnime = (type === 'anime' || item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || item.kitsuId || item.kitsu_id || item.kitsu || item.mal_id || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:'))));
      const searchTitle = item.title || item.name || item.name_en || item.title_english || '';

      const isAvatarMode = window.currentFavModalMode === 'avatar';

      targetGrid.innerHTML = '';
      const searchSource = document.getElementById('fav-search-source');
      if (searchSource) searchSource.style.display = 'none';

      // Initialize Grid
      if (isAvatarMode) {
        if (!targetGrid.classList.contains('fav-avatar-mode')) targetGrid.classList.add('fav-avatar-mode');
        targetGrid.style.display = 'flex';
        targetGrid.style.flexDirection = 'row';
        targetGrid.style.flexWrap = 'nowrap';
        targetGrid.style.overflowX = 'auto';
        targetGrid.style.overflowY = 'hidden';
        targetGrid.style.scrollSnapType = 'x mandatory';
        targetGrid.style.gap = '12px';
        targetGrid.style.padding = '12px';
        targetGrid.style.webkitOverflowScrolling = 'touch';
        targetGrid.style.scrollBehavior = 'smooth';
        targetGrid.style.alignItems = 'center';
        targetGrid.style.width = '100%';
        targetGrid.style.minWidth = '100%';
        if (targetGrid.parentElement) targetGrid.parentElement.style.overflow = 'hidden';
      } else {
        if (targetGrid.classList.contains('fav-avatar-mode')) targetGrid.classList.remove('fav-avatar-mode');
        targetGrid.style.display = 'flex';
        targetGrid.style.flexDirection = 'row';
        targetGrid.style.flexWrap = 'nowrap';
        targetGrid.style.overflowX = 'auto';
        targetGrid.style.overflowY = 'hidden';
        targetGrid.style.scrollSnapType = 'x mandatory';
        targetGrid.style.gap = '0px';
        targetGrid.style.width = '100%';
        targetGrid.style.height = '100%';
        targetGrid.style.padding = '0px';
        targetGrid.style.webkitOverflowScrolling = 'touch';
        targetGrid.style.scrollBehavior = 'smooth';
        targetGrid.style.scrollbarWidth = 'none';
        targetGrid.style.msOverflowStyle = 'none';
        
        const styleId = 'fav-media-grid-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = '#fav-media-grid::-webkit-scrollbar { display: none; }';
          document.head.appendChild(style);
        }
        if (targetGrid.parentElement) targetGrid.parentElement.style.overflow = 'hidden';
      }

      let items = [];

      let tmdbId = item.tmdbId || item.id;
      let tmdbType = item.media_type || item.type || (item.title ? 'movie' : 'tv');

      if (!tmdbId && searchTitle) {
        try {
          const tSearch = await window.api.invoke('tmdb-search-discover', searchTitle).catch(() => null);
          if (tSearch?.results?.length) {
            tmdbId = tSearch.results[0].id;
            tmdbType = tSearch.results[0].media_type || tmdbType;
          }
        } catch (e) {
          console.error('[TMDB ID Resolve Error]', e);
        }
      }

      if (isAvatarMode) {
        try {
          let animeChars = [];
          if (isAnime && searchTitle) {
            const cleanTitle = searchTitle.replace(/\s+(2|II|III|IV|V|Season\s+\d+|S\d+|[0-9]+)$/i, '').trim();
            const alSearch = await window.api.invoke('anilist-search', cleanTitle).catch(() => []);
            const mediaMatch = alSearch.find(r => r.type === 'media' || r.type === 'anime');
            if (mediaMatch) {
              animeChars = await window.api.invoke('anilist-media-assets', mediaMatch.id).catch(() => []);
            }
          }

          if (animeChars && animeChars.length) {
            items.push(...animeChars);
          }
        } catch (e) {
          console.error('[Avatar Resolve Error]', e);
        }
      }

      if (!isAvatarMode) {
        let fanartId = item.tmdbId;
        if (!fanartId && item.source !== 'jikan' && item.source !== 'anilist') {
          fanartId = item.id;
        }
        let fanartType = item.media_type || item.type || (item.title ? 'movie' : 'tv');

        const isImdbTvShow = fanartId && String(fanartId).startsWith('tt') && (fanartType === 'series' || fanartType === 'tv');

        if ((!fanartId || isImdbTvShow) && searchTitle) {
          try {
            if (item.source === 'jikan' && item.id) {
              const external = await window.api.invoke('map-mal-id', item.id);
              if (external) {
                fanartId = external.tvdb || external.tmdb || null;
                fanartType = external.tvdb ? 'tv' : 'movies';
              }
            }
            
            if (!fanartId || isImdbTvShow) {
              let targetId = fanartId;
              let targetType = fanartType;

              if (!targetId) {
                const res = await window.api.invoke('cinemeta-search', searchTitle);
                if (res?.results?.length) {
                  const match = res.results[0];
                  targetId = match.id;
                  targetType = match.type || 'movie';
                }
              }

              if (targetId && (targetType === 'series' || targetType === 'tv')) {
                const details = await window.api.invoke('cinemeta-details', { id: targetId, type: targetType }).catch(() => null);
                if (details?.meta) {
                  fanartId = details.meta.tvdb_id || details.meta.tmdb_id || details.meta.moviedb_id || targetId;
                  fanartType = 'tv';
                }
              } else if (targetId) {
                fanartId = targetId;
                fanartType = targetType;
              }
            }
          } catch (e) { console.error('[ID Resolve Error]', e); }
        }

        if (fanartId) {
          try {
            const fanart = await window.api.invoke('fanart-images', fanartType, fanartId).catch(() => null);

            if (fanart) {
              const bgs = fanart.moviebackground || fanart.tvbackground || fanart.showbackground || [];
              bgs.forEach(bg => items.push({ src: bg.url, label: 'Fanart.tv Background', type: 'banner' }));
              
              // Excluded because they are narrow strips (1000x185) that stretch poorly
              // const banners = fanart.moviebanner || fanart.tvbanner || [];
              // banners.forEach(bg => items.push({ src: bg.url, label: 'Fanart.tv Banner', type: 'banner' }));
              
              const thumbs = fanart.moviethumb || fanart.tvthumb || [];
              thumbs.forEach(bg => items.push({ src: bg.url, label: 'Fanart.tv Thumbnail', type: 'banner' }));
            }
          } catch (e) { console.error('[Banner Fetch Error]', e); }
        }

        const tmdbEnabled = appData.tmdbEnabled !== false;
        const tmdbKey = appData.tmdbKey || '14cc163152a514d455d31590ab8d4d8c';
        if (tmdbEnabled && tmdbKey) {
          try {
            let actualTmdbId = tmdbId;
            let actualTmdbType = tmdbType;

            // Resolve IMDB ID to TMDB ID if needed
            if (!actualTmdbId && item.id && String(item.id).startsWith('tt')) {
              actualTmdbId = item.id;
            }

            if (actualTmdbId && String(actualTmdbId).startsWith('tt')) {
              const findUrl = `https://api.themoviedb.org/3/find/${actualTmdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
              const findResp = await fetch(findUrl).then(r => r.json()).catch(() => null);
              if (findResp) {
                const movie = findResp.movie_results?.[0];
                const tv = findResp.tv_results?.[0];
                if (movie) {
                  actualTmdbId = movie.id;
                  actualTmdbType = 'movie';
                } else if (tv) {
                  actualTmdbId = tv.id;
                  actualTmdbType = 'tv';
                }
              }
            }

            if (actualTmdbId && !String(actualTmdbId).startsWith('tt')) {
              const tmdbTypeClean = (actualTmdbType === 'series' || actualTmdbType === 'tv') ? 'tv' : 'movie';
              const cleanTmdbId = String(actualTmdbId).replace('tmdb:', '');
              const res = await fetch(`https://api.themoviedb.org/3/${tmdbTypeClean}/${cleanTmdbId}/images?api_key=${tmdbKey}`);
              const data = await res.json();
              if (data && data.backdrops && data.backdrops.length) {
                data.backdrops.slice(0, 15).forEach(bg => {
                   items.push({ src: `https://image.tmdb.org/t/p/w1280${bg.file_path}`, label: 'TMDB Backdrop', type: 'banner' });
                });
              }
            }
          } catch (e) {
            console.error('[TMDB Banner Fetch Error]', e);
          }
        }
      }

      if (items.length === 0 || !isAvatarMode) {
        if (item.banner && !isAvatarMode) {
          items.push({ src: window.localImg(item.banner), label: 'Original Banner', type: 'banner' });
        }
        const mainPoster = item.poster || item.poster_path;
        if (mainPoster && isAvatarMode) {
          items.push({ src: window.localImg(mainPoster), label: 'Main Poster', type: 'avatar' });
        }
      }
      
      items = items.filter((v, i, a) => a.findIndex(t => t.src === v.src) === i).slice(0, 60);

      if (!items.length) {
        targetGrid.innerHTML = '<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4); grid-column:1/-1;">Could not find extra assets.</div>';
        return;
      }

      items.forEach(it => {
        const isAvatar = it.type === 'avatar';

        if (isAvatar) {
          const slide = document.createElement('div');
          const basis = window.innerWidth < 480 ? '64%' : '36%';
          slide.style = `flex:0 0 ${basis}; scroll-snap-align:center; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:8px; box-sizing:border-box;`;

          const avatarWrap = document.createElement('div');
          const avatarSize = window.innerWidth < 420 ? 120 : 160;
          avatarWrap.style = `width:${avatarSize}px; height:${avatarSize}px; border-radius:50%; overflow:hidden; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; box-shadow: 0 12px 30px rgba(0,0,0,0.4);`;

          const img = document.createElement('img');
          img.src = window.localImg(it.src);
          img.style = 'width:100%; height:100%; object-fit:cover; object-position:center center; display:block;';
          img.onerror = () => { img.style.opacity = '0'; };
          avatarWrap.appendChild(img);

          const nameEl = document.createElement('div');
          nameEl.style = 'margin-top:10px; font-size:1rem; font-weight:800; color:#fff; text-align:center; min-height:2.2em;';
          nameEl.textContent = it.label || '';

          const selectBtn = document.createElement('button');
          selectBtn.className = 'btn-primary';
          selectBtn.style = 'margin-top:10px; padding:10px 16px; border-radius:12px; font-weight:700;';
          selectBtn.textContent = 'Select Avatar';
          selectBtn.onclick = () => {
            setSelectedAvatar(it.src);
            showToast('Avatar updated');
            const _m = document.getElementById('fav-avatar-modal');
            if (_m?._bannerCleanup) { _m._bannerCleanup(); _m._bannerCleanup = null; }
            if (_m) _m.style.display = 'none';
          };

          slide.appendChild(avatarWrap);
          slide.appendChild(nameEl);
          slide.appendChild(selectBtn);
          targetGrid.appendChild(slide);
        } else {
          const slide = document.createElement('div');
          const slideBasis = window.innerWidth < 480 ? '90%' : '100%';
          slide.style = `flex: 0 0 ${slideBasis}; height: 100%; scroll-snap-align: center; position: relative; display: flex; align-items: center; justify-content: center; background: transparent; padding: 12px; box-sizing: border-box;`;

          const tile = document.createElement('div');
          tile.className = 'fav-media-tile';
          tile.style = `width: 100%; max-width: ${window.innerWidth < 480 ? '92vw' : '900px'}; aspect-ratio: 16/9; border-radius: 16px; position: relative; overflow: hidden; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.2); box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1);`;

          const imgEl = document.createElement('img');
          imgEl.src = window.localImg(it.src);
          imgEl.style = 'width:100%; height:100%; object-fit:cover; display:block;';
          imgEl.onerror = () => { imgEl.style.opacity = '0.3'; };
          tile.appendChild(imgEl);

          const selectOverlay = document.createElement('div');
          selectOverlay.style = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.1); transition: background 0.3s;';

          const selectBtn = document.createElement('button');
          selectBtn.className = 'btn-primary';
          selectBtn.style = 'padding:14px 28px; border-radius:14px; font-weight:800; font-size:1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); transform: translateY(0); transition: all 0.2s;';
          selectBtn.innerHTML = '<i class="fas fa-check-circle" style="margin-right:8px;"></i> Apply This Banner';

          selectBtn.onmouseenter = () => { selectBtn.style.transform = 'scale(1.05)'; };
          selectBtn.onmouseleave = () => { selectBtn.style.transform = 'scale(1)'; };

          selectBtn.onclick = () => {
            setSelectedBanner(it.src);
            showToast('Banner applied');
            
            // Show checkmark on the button and highlight it in green
            selectBtn.innerHTML = '<i class="fas fa-check-circle" style="margin-right:8px; color: #22C55E;"></i> Applied';
            selectBtn.style.background = 'rgba(16, 185, 129, 0.2)';
            selectBtn.style.borderColor = '#10B981';
            selectBtn.style.color = '#10B981';
            selectBtn.disabled = true;

            setTimeout(() => {
              const _m = document.getElementById('fav-avatar-modal');
              if (_m?._bannerCleanup) { _m._bannerCleanup(); _m._bannerCleanup = null; }
              if (_m) {
                _m.style.display = 'none';
                _m.classList.remove('modal-active');
                try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
              }
            }, 1000);
          };


          selectOverlay.appendChild(selectBtn);
          tile.appendChild(selectOverlay);

          slide.appendChild(tile);
          targetGrid.appendChild(slide);
        }
      });

      if (!isAvatarMode && items.length > 1) {
        let currentSlideIndex = 0;
        const slides = targetGrid.querySelectorAll(':scope > div');

        const scrollToSlide = (index) => {
          if (index < 0) index = slides.length - 1;
          if (index >= slides.length) index = 0;
          currentSlideIndex = index;

          const slideWidth = targetGrid.offsetWidth;
          targetGrid.scrollTo({
            left: index * slideWidth,
            behavior: 'smooth'
          });
          updateDots();
        };

        const keyHandler = (e) => {
          const modal = document.getElementById('fav-avatar-modal');
          if (!modal || modal.style.display === 'none') return;
          if (e.key === 'ArrowRight') { e.preventDefault(); scrollToSlide(currentSlideIndex + 1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToSlide(currentSlideIndex - 1); }
        };

        document.addEventListener('keydown', keyHandler);

        const leftBtn = document.createElement('button');
        const rightBtn = document.createElement('button');
        leftBtn.className = 'fav-carousel-arrow';
        rightBtn.className = 'fav-carousel-arrow';
        leftBtn.innerHTML = '&#9664;';
        rightBtn.innerHTML = '&#9654;';
        leftBtn.style = rightBtn.style = 'position:absolute; top:50%; transform:translateY(-50%); width:48px; height:48px; border-radius:24px; background:rgba(0,0,0,0.5); color:#fff; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:30;';
        leftBtn.style.left = '12px';
        rightBtn.style.right = '12px';
        leftBtn.style.display = 'flex';
        rightBtn.style.display = 'flex';
        
        if (window.innerWidth < 480) {
          leftBtn.style.width = leftBtn.style.height = '44px';
          leftBtn.style.borderRadius = '22px';
          rightBtn.style.width = rightBtn.style.height = '44px';
          rightBtn.style.borderRadius = '22px';
          leftBtn.style.left = '8px';
          rightBtn.style.right = '8px';
          leftBtn.style.opacity = '0.95';
        }
        leftBtn.onclick = () => scrollToSlide(currentSlideIndex - 1);
        rightBtn.onclick = () => scrollToSlide(currentSlideIndex + 1);
        targetGrid.parentElement.appendChild(leftBtn);
        targetGrid.parentElement.appendChild(rightBtn);
        
        const resizeHandler = () => {
          if (window.innerWidth < 480) {
            leftBtn.style.width = leftBtn.style.height = '44px';
            leftBtn.style.borderRadius = '22px';
            rightBtn.style.width = rightBtn.style.height = '44px';
            rightBtn.style.borderRadius = '22px';
            leftBtn.style.left = '8px';
            rightBtn.style.right = '8px';
          } else {
            leftBtn.style.width = leftBtn.style.height = '48px';
            leftBtn.style.borderRadius = '24px';
            rightBtn.style.width = rightBtn.style.height = '48px';
            rightBtn.style.borderRadius = '24px';
            leftBtn.style.left = '12px';
            rightBtn.style.right = '12px';
          }
        };
        window.addEventListener('resize', resizeHandler);

        const counter = document.createElement('div');
        counter.style = 'position:absolute; bottom:20px; left:50%; transform:translateX(-50%); display:flex; gap:8px; z-index:20; padding:6px 12px; background:rgba(0,0,0,0.4); border-radius:20px; backdrop-filter:blur(8px);';
        slides.forEach((_, i) => {
          const dot = document.createElement('div');
          dot.style = `width:8px; height:8px; border-radius:50%; background:${i === 0 ? '#fff' : 'rgba(255,255,255,0.3)'}; transition:all 0.3s; cursor:pointer;`;
          dot.onclick = () => scrollToSlide(i);
          counter.appendChild(dot);
        });
        targetGrid.parentElement.style.position = 'relative';
        targetGrid.parentElement.appendChild(counter);

        const updateDots = () => {
          const dots = counter.children;
          for (let i = 0; i < dots.length; i++) {
            dots[i].style.background = i === currentSlideIndex ? '#fff' : 'rgba(255,255,255,0.3)';
            dots[i].style.transform = i === currentSlideIndex ? 'scale(1.4)' : 'scale(1)';
          }
        };

        let isInternalScroll = false;
        targetGrid.onscroll = () => {
          if (isInternalScroll) return;
          const index = Math.round(targetGrid.scrollLeft / targetGrid.offsetWidth);
          if (index !== currentSlideIndex) {
            currentSlideIndex = index;
            updateDots();
          }
        };

        const cleanup = () => {
          document.removeEventListener('keydown', keyHandler);
          targetGrid.onscroll = null;
          if (counter.parentElement) counter.remove();
          if (leftBtn.parentElement) leftBtn.remove();
          if (rightBtn.parentElement) rightBtn.remove();
          window.removeEventListener('resize', resizeHandler);
        };
        const modal = document.getElementById('fav-avatar-modal');
        if (modal) {
          if (modal._bannerCleanup) modal._bannerCleanup();
          modal._bannerCleanup = cleanup;
        }
      }
    } catch (err) {
      console.error('fetchFavoriteAssets error', err);
      targetGrid.innerHTML = '<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Error fetching assets.</div>';
    }
  }

  function setSelectedAvatar(url) {
    selectedAvatar = url;
    const selector = document.getElementById('avatar-selector'); if (selector) {
      selector.querySelectorAll('.avatar-opt.custom-avatar').forEach(el => el.remove());
      selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));

      const img = document.createElement('img');
      img.src = window.localImg(url);
      img.className = 'avatar-opt selected custom-avatar';
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = url;
        const targetId = editingProfileId;
        const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
        if (prof) {
          prof.avatar = url;
          persist();
          renderProfilePicker();
          renderProfileWidget();
          renderAccount();
        }
      };

      const upload = selector.querySelector('#btn-upload-avatar');
      if (upload) selector.insertBefore(img, upload);
      else selector.appendChild(img);
    }

    const targetId = editingProfileId;
    const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
    if (prof) {
      prof.avatar = url;
      persist();
      renderProfilePicker();
      renderProfileWidget();
      renderAccount();
    }
  }

  function setSelectedBanner(url) {
    appData.globalBanner = url;
    if (Array.isArray(appData.profiles)) {
      appData.profiles.forEach((p) => { p.banner = url; });
    }
    applyProfilePickerBackdrop(url);
    persist();
    renderProfilePicker();
    renderProfileWidget();
    renderAccount();
    if (typeof window.updateSettingsBanner === 'function') {
      window.updateSettingsBanner();
    }
  }
  function migrateToProfiles() {
    if (appData.profiles.length > 0) {
      // Ensure all existing profiles have custom_lists property for offline mode support
      appData.profiles.forEach(profile => {
        if (!profile.custom_lists) {
          profile.custom_lists = [];
        }
      });
      return;
    }

    // Check if we have legacy data worth migrating
    const hasData = (appData.playback && Object.keys(appData.playback).length) ||
      (appData.watchlist && appData.watchlist.length) ||
      (appData.pinned && appData.pinned.length);

    if (!hasData) return;

    // Create first profile from legacy data ONLY if data exists
    const legacyProfile = {
      id: 'p1_' + Date.now(),
      name: 'Main',
      avatar: AVATARS[0],
      playback: appData.playback || {},
      watchlist: appData.watchlist || [],
      pinned: appData.pinned || [],
      vaultPin: appData.vaultPin,
      lockedItems: appData.lockedItems || [],
      custom_lists: appData.custom_lists || []
    };
    appData.profiles = [legacyProfile];
    appData.activeProfileId = legacyProfile.id;

    // Cleanup root legacy fields
    delete appData.playback; delete appData.watchlist; delete appData.pinned; delete appData.vaultPin; delete appData.lockedItems; delete appData.custom_lists;
    console.log('[PROFILES] Migrated legacy data to Main profile');
  }

  // Bind key functions to window
  window.migrateToProfiles = migrateToProfiles;
  window.runAuthFlow = runAuthFlow;
  window.performLogout = performLogout;
  window.finalizeLogout = finalizeLogout;
  window.getHardwareIdForClient = getHardwareIdForClient;
  window.showBannedOverlay = showBannedOverlay;
  window.checkSubscriptionStatus = checkSubscriptionStatus;
  window.showSubscriptionExpiredOverlay = showSubscriptionExpiredOverlay;
  window.showAuthOverlay = showAuthOverlay;
  window.renderProfilePicker = renderProfilePicker;
  window.selectProfile = selectProfile;
  window.showMobileOnboarding = showMobileOnboarding;
  window.renderProfileWidget = renderProfileWidget;
  window.openProfileModal = openProfileModal;
  window.renderAccount = renderAccount;
  window.openFavoritesAvatarModal = openFavoritesAvatarModal;
  window.setSelectedAvatar = setSelectedAvatar;
  window.setSelectedBanner = setSelectedBanner;

  // Set up event listeners for profiles
  document.addEventListener('DOMContentLoaded', () => {
    const btnAddProfile = document.getElementById('btn-add-profile');
    if (btnAddProfile) btnAddProfile.onclick = () => window.openProfileModal();

    const globalBannerBtn = document.getElementById('btn-fav-banner');
    if (globalBannerBtn) {
      const canBanner = window.AppCapabilities ? window.AppCapabilities.can('banner-search') : true;
      globalBannerBtn.style.display = canBanner ? 'flex' : 'none';
      globalBannerBtn.onclick = () => openFavoritesAvatarModal('banner');
    }

    const btnToggleEdit = document.getElementById('btn-toggle-edit-profiles');
    if (btnToggleEdit) {
      btnToggleEdit.onclick = () => {
        window.isEditingProfiles = !window.isEditingProfiles;
        const bannerBtn = document.getElementById('btn-fav-banner');
        const label = btnToggleEdit.querySelector('.btn-label');
        const icon = btnToggleEdit.querySelector('i');
        const canBanner = window.AppCapabilities ? window.AppCapabilities.can('banner-search') : true;
        if (window.isEditingProfiles) {
          if (label) label.textContent = 'Done Editing';
          else btnToggleEdit.textContent = 'Done Editing';
          if (icon) icon.className = 'fas fa-check';
          btnToggleEdit.classList.add('editing-active');
          if (bannerBtn) bannerBtn.style.display = canBanner ? 'flex' : 'none';
        } else {
          if (label) label.textContent = 'Edit Profiles';
          else btnToggleEdit.textContent = 'Edit Profiles';
          if (icon) icon.className = 'fas fa-user-edit';
          btnToggleEdit.classList.remove('editing-active');
          if (bannerBtn) bannerBtn.style.display = canBanner ? 'flex' : 'none';
        }
        renderProfilePicker();
      };
    }

    const btnIntroStart = document.getElementById('btn-intro-start');
    if (btnIntroStart) {
      btnIntroStart.onclick = () => {
        const intro = document.getElementById('intro-screen');
        if (intro) intro.style.display = 'none';
        window.openProfileModal();
      };
    }

    const cancelBtn = document.getElementById('profile-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        const editor = document.getElementById('profile-editor-inline');
        if (editor) editor.style.display = 'none';
        const pickerMain = document.getElementById('profile-picker-main');
        if (pickerMain) pickerMain.style.display = 'flex';
        const picker = document.getElementById('profile-picker');
        if (picker) {
          picker.style.display = 'flex';
          picker.classList.add('modal-active');
          try { document.body.classList.add('modal-open'); } catch (e) { /* ignore */ }
        }
        if (appData.profiles.length === 0) {
          renderProfilePicker();
        }
      };
    }

    const confirmBtn = document.getElementById('profile-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        const nameInput = document.getElementById('profile-name-input');
        const name = nameInput ? nameInput.value.trim() : '';

        if (!name) {
          showToast('Please enter a name');
          if (nameInput) nameInput.focus();
          return;
        }

        const duplicate = appData.profiles.find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== editingProfileId);
        if (duplicate) {
          showToast('A profile with this name already exists');
          return;
        }

        const originalText = confirmBtn.textContent;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

        try {
          const ageInput = document.getElementById('profile-age-input');
          const maxAgeRating = parseInt(ageInput?.value || '18', 10);

          if (editingProfileId) {
            const profile = appData.profiles.find(p => p.id === editingProfileId);
            if (profile) {
              const oldName = profile.name;
              if (oldName !== name) {
                await window.api.invoke('rename-profile-folders', oldName, name);
              }
              profile.name = name;
              profile.avatar = selectedAvatar;
              profile.max_age_rating = maxAgeRating;
              if (!profile.banner && appData.globalBanner) profile.banner = appData.globalBanner;
              if (profile.id === appData.activeProfileId) {
                currentProfile = profile;
                renderProfileWidget();
              }
            }
          } else {
            const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'prof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const newProfile = {
              id: newId,
              name: name,
              avatar: selectedAvatar,
              max_age_rating: maxAgeRating,
              banner: appData.globalBanner || null,
              playback: {},
              watchlist: [],
              pinned: [],
              vaultPin: null,
              lockedItems: []
            };

            await window.api.invoke('ensure-profile-folders', name);
            appData.profiles.push(newProfile);

            if (appData.profiles.length === 1) {
              appData.activeProfileId = newId;
            }
          }

          const modal = document.getElementById('profile-editor-inline');
          if (modal) {
            modal.style.display = 'none';
          }
          const pickerMain = document.getElementById('profile-picker-main');
          if (pickerMain) pickerMain.style.display = 'flex';
          const intro = document.getElementById('intro-screen');
          if (intro) intro.style.display = 'none';
          renderProfilePicker();
          persist();

          if (!editingProfileId) {
            showToast(`Profile "${name}" created successfully!`);
          }
        } catch (err) {
          console.error('[PROFILES] Error saving profile:', err);
          showToast('Error: ' + err.message);
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = originalText;
        }
      };
    }
  });

})();
