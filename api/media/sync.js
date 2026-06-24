const { supabase } = require('../utils/supabase');

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method } = req;

  try {
    // 1. GET - Fetch continue watching progress
    if (method === 'GET') {
      const { profile_id, media_id } = req.query || {};
      if (!profile_id) {
        return res.status(400).json({ error: 'profile_id parameter is required' });
      }

      let dbQuery = supabase
        .from('continue_watching')
        .select('*')
        .eq('profile_id', profile_id);

      if (media_id) {
        dbQuery = dbQuery.eq('media_id', media_id).maybeSingle();
      } else {
        dbQuery = dbQuery.order('updated_at', { ascending: false });
      }

      const { data, error } = await dbQuery;

      if (error) {
        return res.status(500).json({ error: 'Playback position query failed', details: error.message });
      }

      return res.status(200).json({ data });
    }

    // 2. POST - Save/Upsert continue watching progress
    if (method === 'POST') {
      const { profile_id, media_id, last_position_seconds } = req.body || {};

      if (!profile_id || !media_id || last_position_seconds === undefined) {
        return res.status(400).json({ error: 'profile_id, media_id and last_position_seconds are required' });
      }

      const seconds = parseInt(last_position_seconds);
      if (isNaN(seconds) || seconds < 0) {
        return res.status(400).json({ error: 'last_position_seconds must be a valid non-negative integer' });
      }

      const { data, error } = await supabase.rpc('upsert_continue_watching', {
        profile_id,
        media_id,
        last_position_seconds: seconds
      });

      if (error) {
        return res.status(500).json({ error: 'Failed to save playback position', details: error.message });
      }

      return res.status(200).json(data || { success: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[SYNC] Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
