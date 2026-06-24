const { registerUser } = require('../../src/shared/cloudAuth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password } = req.body || {};
  const result = await registerUser(email, password);

  if (result.error) {
    const status = result.error.includes('already exists') ? 409 : 400;
    return res.status(status).json(result);
  }

  return res.status(201).json(result);
};
