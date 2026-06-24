const { supabase, getSuperAdminEmail } = require('../utils/supabase');

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let { hardware_id } = req.query || {};

  // Use default hardware ID for mobile devices if not provided
  if (!hardware_id || !hardware_id.trim()) {
    hardware_id = 'mobile-device-default';
  }

  try {
    const cleanHardwareId = hardware_id.trim();

    // 1. Blacklist check
    const { data: blacklistEntry, error: blacklistError } = await supabase
      .from('hardware_blacklist')
      .select('hardware_id, reason')
      .eq('hardware_id', cleanHardwareId)
      .eq('is_banned', true)
      .maybeSingle();

    if (blacklistError) {
      return res.status(500).json({ error: 'Blacklist check failed', details: blacklistError.message });
    }

    if (blacklistEntry) {
      return res.status(403).json({
        error: 'HARDWARE_BANNED',
        message: `This device has been globally banned. Reason: ${blacklistEntry.reason || 'No reason provided'}`
      });
    }

    // 2. Find device mapping
    const { data: deviceBinding, error: bindingError } = await supabase
      .from('user_devices')
      .select('user_id')
      .eq('hardware_id', cleanHardwareId)
      .maybeSingle();

    if (bindingError) {
      return res.status(500).json({ error: 'Device binding query failed', details: bindingError.message });
    }

    if (!deviceBinding) {
      return res.status(200).json({ authenticated: false, message: 'Device not bound to any account' });
    }

    // 3. Get user details
    const { data: user, error: userError } = await supabase
      .from('users_accounts')
      .select('*')
      .eq('id', deviceBinding.user_id)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ error: 'User query failed', details: userError.message });
    }

    if (!user) {
      return res.status(404).json({ error: 'Associated user account not found' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'ACCOUNT_BANNED', message: 'Associated account has been suspended.' });
    }

    // 4. Get sub-profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('account_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (profilesError) {
      return res.status(500).json({ error: 'Profiles query failed', details: profilesError.message });
    }

    // Determine Super Admin
    const isSuperAdmin = user.email.toLowerCase().trim() === getSuperAdminEmail().toLowerCase().trim();
    const finalRole = isSuperAdmin ? 'admin' : (user.role || 'user');

    const { password_hash, ...safeUser } = user;
    safeUser.role = finalRole;

    return res.status(200).json({
      authenticated: true,
      user: safeUser,
      profiles: profiles || []
    });

  } catch (err) {
    console.error('[DEVICE-SESSION] Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
