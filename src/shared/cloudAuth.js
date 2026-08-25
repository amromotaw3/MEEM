const { getClient } = require('./supabaseClient');
const { unwrapRpcRow } = require('./rpcHelpers');
const { getSuperAdminEmail } = require('./supabaseEnv');

/**
 * Sanitizes a user object by removing sensitive fields like password_hash
 * and assigning the appropriate role (e.g., admin role for the super admin).
 * 
 * @param {Object} user - The raw user object from the database.
 * @returns {Object|null} The sanitized user object, or null if input is empty.
 */
function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  const email = (safe.email || '').toLowerCase().trim();
  const isSuperAdmin = email === getSuperAdminEmail().toLowerCase().trim();
  safe.role = isSuperAdmin ? 'admin' : (safe.role || 'user');
  return safe;
}

/**
 * Safely executes a Supabase RPC function. Falls back to null if the function 
 * does not exist on the database yet.
 * 
 * @param {string} fn - The RPC function name.
 * @param {Object} body - Parameters to pass to the RPC.
 * @returns {Promise<any>} The unwrapped row result, or null.
 */
async function tryAuthRpc(fn, body) {
  const { data, error } = await getClient().rpc(fn, body);
  if (error) {
    if (String(error.message || '').includes('Could not find the function')) return null;
    throw error;
  }
  if (data == null) return null;
  if (typeof data === 'object' && !Array.isArray(data)) return data;
  return unwrapRpcRow(data);
}

/**
 * Checks if a specific device (by hardware ID) is banned from accessing the app.
 * 
 * @param {string} hardwareId - The motherboard UUID or unique system identifier.
 * @returns {Promise<Object|null>} Ban details object if banned, otherwise null.
 */
async function checkHardwareBan(hardwareId) {
  const cleanHardwareId = String(hardwareId || '').trim();
  if (!cleanHardwareId) return null;
  try {
    const { data, error } = await getClient().rpc('check_hardware_ban', { hardware_id: cleanHardwareId });
    if (error) throw error;
    if (data && Array.isArray(data) && data.length > 0) return data[0];
    return null;
  } catch (err) {
    console.warn('[CLOUD_AUTH] checkHardwareBan RPC failed:', err.message);
    return null;
  }
}

/**
 * Retrieves the device's cloud session using its unique hardware ID.
 * 
 * @param {string} hardwareId - The motherboard UUID or unique system identifier.
 * @returns {Promise<Object>} Object containing authentication state, safe user details, and profiles.
 */
async function getDeviceSessionWithRpcFallback(hardwareId) {
  try {
    // Use a default hardware ID for mobile devices if not provided
    const cleanHardwareId = String(hardwareId || '').trim() || 'mobile-device-default';
    const { data, error } = await getClient().rpc('device_session', { hardware_id: cleanHardwareId });
    if (!error) {
      const row = unwrapRpcRow(data);
      if (row && row.authenticated) {
        return {
          authenticated: true,
          user: sanitizeUser(row.user) || row.user,
          profiles: row.profiles || []
        };
      }
      if (row && row.authenticated === false) return { authenticated: false };
    }
  } catch (err) {
    console.warn('[CLOUD_AUTH] getDeviceSessionWithRpcFallback failed:', err.message);
  }
  return { authenticated: false };
}

/**
 * Log in a user securely by calling the secure login RPC.
 * 
 * @param {string} email - The user's email address.
 * @param {string} password - The user's password.
 * @param {string} hardwareId - The motherboard UUID or unique system identifier.
 * @returns {Promise<Object>} Object containing login status, user details, or error message.
 */
async function loginUser(email, password, hardwareId) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  let cleanHardwareId = String(hardwareId || '').trim();

  if (!cleanEmail || !password) {
    return { error: 'Email and password are required' };
  }

  // Use a default hardware ID for mobile devices if not provided
  if (!cleanHardwareId) {
    cleanHardwareId = 'mobile-device-default';
  }

  try {
    const rpcResult = await tryAuthRpc('handle_secure_login', {
      email: cleanEmail,
      password,
      hardware_id: cleanHardwareId
    });
    
    if (rpcResult) {
      if (rpcResult.error) return rpcResult;
      if (rpcResult.success) {
        return {
          ...rpcResult,
          user: rpcResult.user ? sanitizeUser(rpcResult.user) : rpcResult.user
        };
      }
      return rpcResult;
    }
    return { error: 'Login RPC not available. Please ensure database migrations are applied.' };
  } catch (err) {
    return { error: 'Login failed', details: err.message };
  }
}

/**
 * Register a new user by calling the registration RPC.
 * 
 * @param {string} email - The registration email address.
 * @param {string} password - The password (must be at least 6 characters).
 * @returns {Promise<Object>} Object containing registration status, or error details.
 */
async function registerUser(email, password, hardwareId) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  let cleanHardwareId = String(hardwareId || '').trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { error: 'Invalid email address' };
  }
  if (!password || String(password).length < 6) {
    return { error: 'Password must be at least 6 characters long' };
  }

  if (!cleanHardwareId) {
    cleanHardwareId = 'mobile-device-default';
  }

  try {
    const rpcResult = await tryAuthRpc('handle_register', { email: cleanEmail, password, hardware_id: cleanHardwareId });
    if (rpcResult) return rpcResult;
    return { error: 'Register RPC not available. Please ensure database migrations are applied.' };
  } catch (err) {
    return { error: 'Registration failed', details: err.message };
  }
}

/**
 * Synchronize the current user's session with the database.
 * 
 * @param {string} userId - The user's ID.
 * @param {string} email - The user's email address.
 * @param {string} username - The user's username.
 * @param {string} hardwareId - The motherboard UUID or unique system identifier.
 * @returns {Promise<Object>} Object containing synchronization results, or error details.
 */
async function syncUserSession(userId, email, username, hardwareId) {
  if (!userId || !email) {
    return { error: 'User ID and Email are required' };
  }

  try {
    let cleanHardwareId = String(hardwareId || '').trim();
    
    // Use a default hardware ID for mobile devices if not provided
    if (!cleanHardwareId) {
      cleanHardwareId = 'mobile-device-default';
    }
    
    const rpcResult = await tryAuthRpc('sync_user_session', {
      p_user_id: userId,
      p_email: email,
      p_username: username || '',
      p_hardware_id: cleanHardwareId
    });

    if (rpcResult) {
      if (rpcResult.error) return rpcResult;
      if (rpcResult.success) {
        return {
          ...rpcResult,
          user: rpcResult.user ? sanitizeUser(rpcResult.user) : rpcResult.user
        };
      }
      return rpcResult;
    }
    return { error: 'Sync RPC not available. Please ensure database migrations are applied.' };
  } catch (err) {
    return { error: 'Sync session failed', details: err.message };
  }
}

module.exports = {
  checkHardwareBan,
  getDeviceSessionWithRpcFallback,
  loginUser,
  registerUser,
  unwrapRpcRow,
  syncUserSession
};

