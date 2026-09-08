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
    const payload = {
      license_key: cleanKey,
      increment_uses_count: false
    };

    const activeProductId = productId || this.defaultProductId || 'MEEMVIP';
    if (activeProductId) {
      let prodId = activeProductId;
      if (activeProductId.startsWith('http')) {
        try {
          const u = new URL(activeProductId);
          const parts = u.pathname.split('/').filter(Boolean);
          prodId = parts[parts.length - 1];
        } catch (e) {
          prodId = activeProductId;
        }
      }
      payload.product_id = prodId;
      payload.product_permalink = prodId;
    }

    try {
      console.log(`[GumroadService] Verifying license key: ${cleanKey.slice(0, 8)}...`);
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
        return {
          success: false,
          error: data?.message || 'Invalid license key'
        };
      }
    } catch (err) {
      console.error('[GumroadService] License verification error:', err.response?.data || err.message);
      const msg = err.response?.data?.message || err.message || 'Verification failed';
      return {
        success: false,
        error: msg
      };
    }
  }
}

module.exports = new GumroadService();
