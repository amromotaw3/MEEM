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

  const { method } = req;

  try {
    // 1. GET - Fetch requests list
    if (method === 'GET') {
      const { user_id } = req.query || {};
      if (!user_id) {
        return res.status(400).json({ error: 'user_id query parameter is required' });
      }

      const adminCheck = await isAdmin(user_id);
      let query = supabase.from('movie_requests').select('*');

      if (!adminCheck) {
        // Standard user: filter to only show their requests
        query = query.eq('user_id', user_id);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch requests', details: error.message });
      }

      return res.status(200).json({ requests: data || [] });
    }

    // 2. POST - Submit a new request
    if (method === 'POST') {
      const { user_id, title } = req.body || {};
      if (!user_id || !title) {
        return res.status(400).json({ error: 'user_id and title are required' });
      }

      const { data, error } = await supabase
        .from('movie_requests')
        .insert({
          user_id,
          title: title.trim(),
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to submit request', details: error.message });
      }

      return res.status(201).json({ success: true, request: data });
    }

    // 3. PUT - Admin update request status
    if (method === 'PUT') {
      const { id, admin_id, status } = req.body || {};
      if (!id || !admin_id || !status) {
        return res.status(400).json({ error: 'id, admin_id, and status are required' });
      }

      const adminCheck = await isAdmin(admin_id);
      if (!adminCheck) {
        return res.status(403).json({ error: 'Unauthorized. Admin privileges are required.' });
      }

      if (!['approved', 'declined', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be approved, declined, or pending' });
      }

      const { data, error } = await supabase
        .from('movie_requests')
        .update({ status })
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to update request', details: error.message });
      }

      return res.status(200).json({ success: true, request: data });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[REQUESTS] Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
