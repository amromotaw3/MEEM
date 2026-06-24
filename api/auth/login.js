const { loginUser } = require('../../src/shared/cloudAuth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password, hardware_id } = req.body || {};
  const result = await loginUser(email, password, hardware_id);

  if (result.error) {
    const status =
      result.error === 'HARDWARE_BANNED' || result.error === 'ACCOUNT_BANNED' || result.error === 'DEVICE_LIMIT_REACHED'
        ? 403
        : result.error === 'Invalid email or password'
          ? 401
          : 400;
    return res.status(status).json(result);
  }

  return res.status(200).json(result);
};
