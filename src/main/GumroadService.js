const axios = require('axios');

function getStore() {
  return require('./store');
}

class GumroadService {
  constructor() {
    this.apiUrl = 'https://api.gumroad.com/v2/licenses/verify';
  }

  getSavedLicense() {
    try {
      const data = getStore().getInMemorySession() || {};
      return data.gumroad_license || null;
    } catch (e) {
      return null;
    }
  }

  saveLicense(licenseData) {
    try {
      const store = getStore();
      const current = store.getInMemorySession() || {};
      current.gumroad_license = licenseData;
      store.saveInMemorySession(current);
    } catch (e) {
      console.warn('[GumroadService] Failed to save license data:', e.message);
    }
  }

  clearLicense() {
    try {
      const store = getStore();
      const current = store.getInMemorySession() || {};
      delete current.gumroad_license;
      store.saveInMemorySession(current);
    } catch (e) {}
  }

  /**
   * Verifies a Gumroad License Key
   * @param {string} licenseKey - The license key entered by user
   * @param {string} [productId] - Optional Gumroad product ID or permalink
   */
  async verifyLicenseKey(licenseKey, productId = null) {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { success: false, error: 'Please enter a valid license key' };
    }

    const cleanKey = licenseKey.trim();

    // The Gumroad product_id for MEEM VIP (from API error message)
    const MEEM_PRODUCT_ID = 'hGdj3GQzGMSQE9e27Vt_Qw==';

    // Candidate permalinks to test against Gumroad
    const candidates = [];
    if (productId) {
      let cleanProd = String(productId).trim();
      if (cleanProd.startsWith('http')) {
        try {
          const u = new URL(cleanProd);
          const parts = u.pathname.split('/').filter(Boolean);
          cleanProd = parts[parts.length - 1];
        } catch (_) {}
      }
      candidates.push(cleanProd);
    }
    candidates.push('MEEMVIP', 'meemvip', 'MEEM-VIP', 'meem-vip', 'meem_vip', 'MEEM_VIP');

    // Remove duplicates
    const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));

    let lastError = 'That license does not exist for the provided product.';

    for (const permalink of uniqueCandidates) {
      try {
        const payload = {
          product_permalink: permalink,
          product_id: MEEM_PRODUCT_ID,
          license_key: cleanKey,
          increment_uses_count: false
        };

        console.log(`[GumroadService] Verifying license with permalink: "${permalink}" (key: ${cleanKey.slice(0, 8)}...)...`);
        const response = await axios.post(this.apiUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });

        const data = response.data;
        if (data && data.success) {
          const purchase = data.purchase || {};

          if (purchase.subscription_cancelled_at || purchase.subscription_failed_at || purchase.refunded || purchase.chargebacked || purchase.disputed) {
            return {
              success: false,
              error: 'This subscription has been cancelled, refunded, or payment failed.'
            };
          }

          let expiresAt = null;
          if (purchase.subscription_ended_at) {
            expiresAt = new Date(purchase.subscription_ended_at).toISOString();
          } else if (purchase.recurrence === 'monthly') {
            const d = new Date(purchase.created_at || Date.now());
            d.setDate(d.getDate() + 32);
            expiresAt = d.toISOString();
          } else if (purchase.recurrence === 'yearly') {
            const d = new Date(purchase.created_at || Date.now());
            d.setFullYear(d.getFullYear() + 1);
            d.setDate(d.getDate() + 5);
            expiresAt = d.toISOString();
          } else {
            // Lifetime / one-time purchase
            expiresAt = new Date('2099-01-01T00:00:00.000Z').toISOString();
          }

          const licenseInfo = {
            licenseKey: cleanKey,
            productName: purchase.product_name || 'MEEM VIP',
            productId: purchase.product_id || '',
            permalink: permalink,
            email: purchase.email || '',
            recurrence: purchase.recurrence || 'lifetime',
            expiresAt,
            verifiedAt: new Date().toISOString()
          };

          this.saveLicense(licenseInfo);

          return {
            success: true,
            valid: true,
            expiresAt,
            licenseInfo
          };
        } else {
          lastError = data?.message || lastError;
        }
      } catch (err) {
        lastError = err.response?.data?.message || err.message || lastError;
        console.warn(`[GumroadService] Attempt with "${permalink}" failed:`, lastError);
      }
    }

    return {
      success: false,
      error: lastError
    };
  }
}

module.exports = new GumroadService();
