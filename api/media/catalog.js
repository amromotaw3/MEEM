const { supabase } = require('../utils/supabase');

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { profile_id, query, type, limit = 20, offset = 0 } = req.query || {};

  if (!profile_id) {
    return res.status(400).json({ error: 'profile_id parameter is required' });
  }

  try {
    // 1. Get profile restrictions
    const { data: profile, error: profileError } = await supabase
      .from('account_profiles')
      .select('max_age_rating')
      .eq('id', profile_id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: 'Profile fetch failed', details: profileError.message });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const maxAgeRating = profile.max_age_rating !== null && profile.max_age_rating !== undefined ? profile.max_age_rating : 18;

    // 2. Query media content filtering by age rating cap
    let mediaQuery = supabase
      .from('media_content')
      .select('*')
      .lte('age_rating', maxAgeRating);

    if (type) {
      mediaQuery = mediaQuery.eq('type', type);
    }

    if (query) {
      mediaQuery = mediaQuery.ilike('title', `%${query.trim()}%`);
    }

    // Pagination bounds
    const startOffset = parseInt(offset);
    const endOffset = startOffset + parseInt(limit) - 1;
    mediaQuery = mediaQuery.range(startOffset, endOffset);

    const { data: media, error: mediaError } = await mediaQuery;

    if (mediaError) {
      return res.status(500).json({ error: 'Failed to query media catalog', details: mediaError.message });
    }

    return res.status(200).json({
      success: true,
      max_age_rating: maxAgeRating,
      results: media || []
    });

  } catch (err) {
    console.error('[CATALOG] Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
