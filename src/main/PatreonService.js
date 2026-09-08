const { BrowserWindow, session } = require('electron');
const axios = require('axios');

function getStore() {
  return require('./store');
}

const PATREON_CLIENT_ID = 'WDDXAWGxjUvo4iaynJCyWdVuNz-I5cAqPlsC1FwjL6CAe77y_4cqTQk7phhdkVrU';
const PATREON_CLIENT_SECRET = 'VZkmH-jFOukKCGr8uPJDCqk58icZ0w_PaFzYb8tC7vVMgv9O3-zDhGJiq1oTPdQs';
const PATREON_REDIRECT_URI = 'https://mediavault-five.vercel.app/auth/callback';

class PatreonService {
  constructor() {
    this.clientId = PATREON_CLIENT_ID;
    this.clientSecret = PATREON_CLIENT_SECRET;
    this.redirectUri = PATREON_REDIRECT_URI;
  }

  getSavedPatreonData() {
    try {
      const data = getStore().getInMemorySession() || {};
      return data.patreon || null;
    } catch (e) {
      return null;
    }
  }

  savePatreonData(patreonData) {
    try {
      const store = getStore();
      const current = store.getInMemorySession() || {};
      current.patreon = patreonData;
      store.saveInMemorySession(current);
    } catch (e) {
      console.warn('[PatreonService] Failed to save patreon data:', e.message);
    }
  }

  clearPatreonData() {
    try {
      const store = getStore();
      const current = store.getInMemorySession() || {};
      delete current.patreon;
      store.saveInMemorySession(current);
    } catch (e) {}
  }

  async startPatreonAuth() {
    return new Promise(async (resolve, reject) => {
      let isResolved = false;
      let authWin = null;

      try {
        const partition = 'persist:patreon_oauth_session';
        const patreonSession = session.fromPartition(partition);

        authWin = new BrowserWindow({
          width: 520,
          height: 720,
          minWidth: 420,
          minHeight: 600,
          title: 'Connect Patreon — MEEM',
          autoHideMenuBar: true,
          center: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            session: patreonSession
          }
        });

        const authUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${this.clientId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent('identity identity.memberships')}`;

        authWin.loadURL(authUrl);

        const checkRedirect = async (targetUrl) => {
          if (isResolved || !targetUrl) return;

          try {
            if (targetUrl.startsWith(this.redirectUri)) {
              const parsed = new URL(targetUrl);
              const code = parsed.searchParams.get('code');
              const error = parsed.searchParams.get('error');

              if (error) {
                isResolved = true;
                if (authWin && !authWin.isDestroyed()) authWin.close();
                resolve({ success: false, error: `Patreon error: ${error}` });
                return;
              }

              if (code) {
                isResolved = true;
                if (authWin && !authWin.isDestroyed()) authWin.close();

                // Exchange code for access token
                console.log('[PatreonService] Exchanging code for token...');
                const tokenRes = await axios.post(
                  'https://www.patreon.com/api/oauth2/token',
                  new URLSearchParams({
                    code,
                    grant_type: 'authorization_code',
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    redirect_uri: this.redirectUri
                  }).toString(),
                  {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 10000
                  }
                );

                const tokenData = tokenRes.data;
                const accessToken = tokenData.access_token;
                if (!accessToken) {
                  resolve({ success: false, error: 'No access token received from Patreon' });
                  return;
                }

                // Query user identity and memberships
                console.log('[PatreonService] Fetching member identity & pledges...');
                const identityUrl = 'https://www.patreon.com/api/oauth2/v2/identity?include=memberships.currently_entitled_tiers,memberships.campaign&fields[user]=email,first_name,full_name,image_url&fields[member]=patron_status,currently_entitled_amount_cents,lifetime_support_cents,next_charge_date';

                const identityRes = await axios.get(identityUrl, {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'User-Agent': 'MEEM-App'
                  },
                  timeout: 10000
                });

                const identityData = identityRes.data;
                const userAttr = identityData?.data?.attributes || {};
                const included = identityData?.included || [];

                // Check active memberships
                const memberObj = included.find(item => item.type === 'member');
                const memberAttr = memberObj?.attributes || {};
                const patronStatus = memberAttr.patron_status; // 'active_patron', 'former_patron', etc.
                const isActive = patronStatus === 'active_patron' || memberAttr.currently_entitled_amount_cents > 0;

                let expiresAt = null;
                if (isActive) {
                  if (memberAttr.next_charge_date) {
                    const nextDate = new Date(memberAttr.next_charge_date);
                    // Add 2 days grace period
                    nextDate.setDate(nextDate.getDate() + 2);
                    expiresAt = nextDate.toISOString();
                  } else {
                    const defaultExp = new Date();
                    defaultExp.setDate(defaultExp.getDate() + 32);
                    expiresAt = defaultExp.toISOString();
                  }
                }

                const patreonInfo = {
                  patreonUserId: identityData?.data?.id,
                  email: userAttr.email || '',
                  name: userAttr.full_name || userAttr.first_name || 'Patron',
                  avatar: userAttr.image_url || '',
                  patronStatus: patronStatus || 'none',
                  isPatron: isActive,
                  expiresAt,
                  connectedAt: new Date().toISOString()
                };

                this.savePatreonData(patreonInfo);

                resolve({
                  success: true,
                  isPatron: isActive,
                  patronStatus,
                  expiresAt,
                  patreonUser: patreonInfo
                });
              }
            }
          } catch (err) {
            console.error('[PatreonService] Auth verification error:', err.message);
            if (authWin && !authWin.isDestroyed()) authWin.close();
            if (!isResolved) {
              isResolved = true;
              resolve({ success: false, error: err.response?.data?.error || err.message });
            }
          }
        };

        authWin.webContents.on('will-redirect', (event, url) => checkRedirect(url));
        authWin.webContents.on('will-navigate', (event, url) => checkRedirect(url));
        authWin.webContents.on('did-navigate', (event, url) => checkRedirect(url));
        authWin.webContents.on('did-finish-load', () => {
          if (authWin && !authWin.isDestroyed()) {
            checkRedirect(authWin.webContents.getURL());
          }
        });

        authWin.on('closed', () => {
          authWin = null;
          if (!isResolved) {
            isResolved = true;
            resolve({ success: false, cancelled: true });
          }
        });

      } catch (err) {
        console.error('[PatreonService] Failed to open Patreon window:', err);
        if (authWin && !authWin.isDestroyed()) authWin.close();
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      }
    });
  }
}

module.exports = new PatreonService();
