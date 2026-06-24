const { supabase, getSuperAdminEmail } = require('../utils/supabase');

const isAdmin = async (userId) => {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('users_accounts')
      .select('role, email')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return false;
    return data.role === 'admin' || data.email.toLowerCase().trim() === getSuperAdminEmail().toLowerCase().trim();
  } catch (e) {
    return false;
  }
};

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { admin_id, action, payload } = req.body || {};

  if (!admin_id || !action || !payload) {
    return res.status(400).json({ error: 'admin_id, action, and payload are required' });
  }

  // 1. Strict Server-Side Admin Authentication
  const adminCheck = await isAdmin(admin_id);
  if (!adminCheck) {
    return res.status(403).json({ error: 'Unauthorized. Super Admin role required.' });
  }

  try {
    // 2. Action Dispatcher
    switch (action) {
      case 'ban-hardware': {
        const { hardware_id, reason } = payload;
        if (!hardware_id) {
          return res.status(400).json({ error: 'hardware_id is required' });
        }

        // Insert into blacklist
        const { data, error } = await supabase
          .from('hardware_blacklist')
          .upsert({
            hardware_id: hardware_id.trim(),
            reason: reason ? reason.trim() : 'No reason provided',
            is_banned: true,
            banned_at: new Date().toISOString()
          })
          .select('*')
          .single();

        if (error) throw error;

        // Also delete any existing sessions/bindings for this banned hardware
        await supabase
          .from('user_devices')
          .delete()
          .eq('hardware_id', hardware_id.trim());

        return res.status(200).json({ success: true, message: 'Hardware banned globally', data });
      }

      case 'unban-hardware': {
        const { hardware_id } = payload;
        if (!hardware_id) {
          return res.status(400).json({ error: 'hardware_id is required' });
        }

        const { error } = await supabase
          .from('hardware_blacklist')
          .delete()
          .eq('hardware_id', hardware_id.trim());

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'Hardware unbanned successfully' });
      }

      case 'update-device-limit': {
        const { target_user_id, max_devices } = payload;
        if (!target_user_id || max_devices === undefined) {
          return res.status(400).json({ error: 'target_user_id and max_devices are required' });
        }

        const limit = parseInt(max_devices);
        if (isNaN(limit) || limit < 1) {
          return res.status(400).json({ error: 'max_devices must be a positive integer' });
        }

        const { data, error } = await supabase
          .from('users_accounts')
          .update({ max_devices: limit })
          .eq('id', target_user_id)
          .select('id, email, max_devices')
          .single();

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'Device limit updated successfully', user: data });
      }

      case 'extend-subscription': {
        const { target_user_id, days } = payload;
        if (!target_user_id || !days) {
          return res.status(400).json({ error: 'target_user_id and days are required' });
        }

        // Fetch current expiration
        const { data: user, error: fetchErr } = await supabase
          .from('users_accounts')
          .select('subscription_expires_at')
          .eq('id', target_user_id)
          .single();

        if (fetchErr) throw fetchErr;

        let currentExp = new Date();
        if (user.subscription_expires_at && new Date(user.subscription_expires_at) > currentExp) {
          currentExp = new Date(user.subscription_expires_at);
        }

        const newExp = new Date(currentExp.getTime() + parseInt(days) * 24 * 60 * 60 * 1000).toISOString();

        const { data: updatedUser, error: updateErr } = await supabase
          .from('users_accounts')
          .update({ subscription_expires_at: newExp })
          .eq('id', target_user_id)
          .select('id, email, subscription_expires_at')
          .single();

        if (updateErr) throw updateErr;
        return res.status(200).json({ success: true, message: 'Subscription extended successfully', user: updatedUser });
      }

      default:
        return res.status(400).json({ error: `Unknown admin action: ${action}` });
    }
  } catch (err) {
    console.error(`[ADMIN-MUTATE] Action ${action} failed:`, err.message);
    return res.status(500).json({ error: 'Mutation failed', details: err.message });
  }
};
