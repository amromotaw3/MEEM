const { supabase } = require('../utils/supabase');

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method } = req;
  const { action } = req.query || {};

  try {
    // 1. GET - List profiles for a specific account
    if (method === 'GET') {
      const { user_id } = req.query;
      if (!user_id) {
        return res.status(400).json({ error: 'user_id parameter is required' });
      }

      const { data, error } = await supabase
        .from('account_profiles')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch profiles', details: error.message });
      }

      return res.status(200).json({ profiles: data || [] });
    }

    // 2. POST - Create profile OR Verify profile PIN
    if (method === 'POST') {
      // Sub-Action: verify-pin
      if (action === 'verify-pin') {
        const { profile_id, pin } = req.body || {};
        if (!profile_id || !pin) {
          return res.status(400).json({ error: 'profile_id and pin are required' });
        }

        const { data, error } = await supabase
          .from('account_profiles')
          .select('profile_pin')
          .eq('id', profile_id)
          .maybeSingle();

        if (error) {
          return res.status(500).json({ error: 'Verification query failed', details: error.message });
        }

        if (!data) {
          return res.status(404).json({ error: 'Profile not found' });
        }

        const matches = String(data.profile_pin).trim() === String(pin).trim();
        return res.status(200).json({ success: matches });
      }

      // Default: Create profile
      const { user_id, name, avatar, pin, max_age_rating } = req.body || {};
      if (!user_id || !name) {
        return res.status(400).json({ error: 'user_id and name are required' });
      }

      if (pin && (typeof pin !== 'string' || pin.length !== 4 || isNaN(Number(pin)))) {
        return res.status(400).json({ error: 'PIN lock must be a 4-digit number' });
      }

      const { data, error } = await supabase
        .from('account_profiles')
        .insert({
          user_id,
          name: name.trim(),
          avatar: avatar || '',
          profile_pin: pin || null,
          max_age_rating: max_age_rating !== undefined ? parseInt(max_age_rating) : 18,
          created_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to create profile', details: error.message });
      }

      return res.status(201).json({ success: true, profile: data });
    }

    // 3. PUT - Update profile details
    if (method === 'PUT') {
      const { id, name, avatar, pin, max_age_rating } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'Profile ID is required' });
      }

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (avatar !== undefined) updates.avatar = avatar;
      if (pin !== undefined) {
        if (pin && (typeof pin !== 'string' || pin.length !== 4 || isNaN(Number(pin)))) {
          return res.status(400).json({ error: 'PIN lock must be a 4-digit number' });
        }
        updates.profile_pin = pin || null;
      }
      if (max_age_rating !== undefined) {
        updates.max_age_rating = parseInt(max_age_rating);
      }

      const { data, error } = await supabase
        .from('account_profiles')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to update profile', details: error.message });
      }

      return res.status(200).json({ success: true, profile: data });
    }

    // 4. DELETE - Delete a profile
    if (method === 'DELETE') {
      const { id } = req.body || req.query || {};
      if (!id) {
        return res.status(400).json({ error: 'Profile ID is required' });
      }

      const { error } = await supabase
        .from('account_profiles')
        .delete()
        .eq('id', id);

      if (error) {
        return res.status(500).json({ error: 'Failed to delete profile', details: error.message });
      }

      return res.status(200).json({ success: true, message: 'Profile deleted successfully' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[PROFILES] Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
