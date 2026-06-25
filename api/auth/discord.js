const { discordOAuthLogin } = require('../../src/shared/cloudAuth');

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ 
        error: 'Missing required field',
        details: 'user_id is required'
      });
    }

    const result = await discordOAuthLogin(user_id);

    if (result.error) {
      const statusCode = result.error === 'User not found' ? 404 : 500;
      return res.status(statusCode).json(result);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('[DISCORD AUTH] Error:', error.message);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: error.message 
    });
  }
};
