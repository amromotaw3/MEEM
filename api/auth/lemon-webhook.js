const crypto = require('crypto');
const { supabase } = require('../utils/supabase');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'meem_lemon_secret_2026';
    const hmacHeader = req.headers['x-signature'];

    // Verify signature if header is provided
    if (hmacHeader && secret) {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
      const signature = Buffer.from(hmacHeader, 'utf8');
      if (digest.length !== signature.length || !crypto.timingSafeEqual(digest, signature)) {
        console.warn('[LemonWebhook] Invalid signature received');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const metaName = payload.meta?.event_name;
    const customData = payload.meta?.custom_data || {};
    const attributes = payload.data?.attributes || {};

    const userId = customData.user_id;
    const userEmail = customData.email || attributes.user_email;
    const productName = (attributes.first_order_item?.product_name || attributes.product_name || '').toLowerCase();

    console.log(`[LemonWebhook] Received event: ${metaName} for user: ${userId || userEmail} (Product: ${productName})`);

    if (!userId && !userEmail) {
      console.warn('[LemonWebhook] No user_id or email found in payload');
      return res.status(200).json({ status: 'ignored_no_user' });
    }

    // Calculate subscription expiry
    let expiresAt = null;

    if (metaName === 'subscription_cancelled' || metaName === 'subscription_expired') {
      expiresAt = new Date().toISOString();
    } else {
      // Handle paid orders / active subscriptions
      if (attributes.ends_at) {
        expiresAt = new Date(attributes.ends_at).toISOString();
      } else if (attributes.renews_at) {
        expiresAt = new Date(attributes.renews_at).toISOString();
      } else if (productName.includes('lifetime')) {
        expiresAt = new Date('2099-01-01T00:00:00.000Z').toISOString();
      } else if (productName.includes('yearly') || productName.includes('annual')) {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        expiresAt = d.toISOString();
      } else {
        // Default monthly: +30 days
        const d = new Date();
        d.setDate(d.getDate() + 30);
        expiresAt = d.toISOString();
      }
    }

    // Update Supabase database
    let updateQuery = supabase.from('users_accounts').update({
      subscription_expires_at: expiresAt,
      updated_at: new Date().toISOString()
    });

    if (userId) {
      updateQuery = updateQuery.eq('id', userId);
    } else if (userEmail) {
      updateQuery = updateQuery.eq('email', userEmail.trim().toLowerCase());
    }

    const { error: updateError } = await updateQuery;

    if (updateError) {
      console.error('[LemonWebhook] Database update failed:', updateError.message);
      return res.status(500).json({ error: 'Database update failed', details: updateError.message });
    }

    console.log(`[LemonWebhook] Successfully updated subscription for ${userId || userEmail} until ${expiresAt}`);
    return res.status(200).json({ success: true, expires_at: expiresAt });

  } catch (err) {
    console.error('[LemonWebhook] Handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
};
