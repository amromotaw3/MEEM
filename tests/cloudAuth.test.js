const { loginUser, registerUser, verifyOtpUser, checkHardwareBan, getDeviceSessionWithRpcFallback, syncUserSession } = require('../src/shared/cloudAuth');

// Mock supabaseClient
const mockRpc = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('../src/shared/supabaseClient', () => ({
  getClient: () => ({
    rpc: mockRpc,
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      verifyOtp: mockVerifyOtp
    }
  })
}));

jest.mock('../src/shared/supabaseEnv', () => ({
  getSuperAdminEmail: () => 'admin@mediavault.app'
}));

describe('cloudAuth unit tests', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockSignInWithPassword.mockReset();
    mockSignUp.mockReset();
    mockVerifyOtp.mockReset();

    // Default mock behavior
    mockRpc.mockImplementation((name, args) => {
      if (name === 'check_hardware_ban') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'sync_user_session') {
        return Promise.resolve({
          data: [{
            success: true,
            user: { id: args.p_user_id || 'u1', email: args.p_email || 'test@example.com', role: (args.p_email === 'admin@mediavault.app' ? 'admin' : 'user') },
            profiles: [{ id: 'p1', name: 'Profile 1' }]
          }],
          error: null
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  describe('checkHardwareBan', () => {
    test('returns null if hardwareId is empty', async () => {
      const result = await checkHardwareBan('');
      expect(result).toBeNull();
    });

    test('returns ban details on success', async () => {
      mockRpc.mockResolvedValueOnce({ data: [{ banned: true, reason: 'Test Ban' }], error: null });
      const result = await checkHardwareBan('hw123');
      expect(mockRpc).toHaveBeenCalledWith('check_hardware_ban', { hardware_id: 'hw123' });
      expect(result).toEqual({ banned: true, reason: 'Test Ban' });
    });

    test('returns null and logs warning on error', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: new Error('RPC Failed') });
      const result = await checkHardwareBan('hw123');
      expect(result).toBeNull();
    });
  });

  describe('getDeviceSessionWithRpcFallback', () => {
    test('returns authenticated true and safe user details if authenticated', async () => {
      const mockUser = { id: 'u1', email: 'test@example.com', password_hash: 'secret', role: 'user' };
      mockRpc.mockResolvedValueOnce({
        data: [{ authenticated: true, user: mockUser, profiles: [{ id: 'p1' }] }],
        error: null
      });

      const result = await getDeviceSessionWithRpcFallback('hw123');
      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual({ id: 'u1', email: 'test@example.com', role: 'user' });
      expect(result.profiles).toEqual([{ id: 'p1' }]);
    });

    test('returns authenticated false if not authenticated', async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ authenticated: false }],
        error: null
      });

      const result = await getDeviceSessionWithRpcFallback('hw123');
      expect(result.authenticated).toBe(false);
    });
  });

  describe('loginUser', () => {
    test('returns validation error if email or password missing', async () => {
      let result = await loginUser('', 'password', 'hw123');
      expect(result.error).toBe('Email and password are required');

      result = await loginUser('email@test.com', '', 'hw123');
      expect(result.error).toBe('Email and password are required');
    });

    test('performs login successfully via Supabase Auth', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          user: { id: 'u1', email: 'admin@mediavault.app', user_metadata: { username: 'admin' } },
          session: { access_token: 'tok123', refresh_token: 'ref123' }
        },
        error: null
      });

      const result = await loginUser('admin@mediavault.app', 'password123', 'hw123');
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'admin@mediavault.app',
        password: 'password123'
      });
      expect(result.success).toBe(true);
      expect(result.session.access_token).toBe('tok123');
      expect(result.user.role).toBe('admin');
    });

    test('returns EMAIL_NOT_CONFIRMED error when unconfirmed', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: null,
        error: { message: 'Email not confirmed' }
      });

      const result = await loginUser('unconfirmed@example.com', 'password123', 'hw123');
      expect(result.error).toBe('EMAIL_NOT_CONFIRMED');
    });

    test('falls back to legacy handle_secure_login RPC on invalid password', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid login credentials' }
      });

      mockRpc.mockImplementation((name, args) => {
        if (name === 'check_hardware_ban') {
          return Promise.resolve({ data: [{ banned: false }], error: null });
        }
        if (name === 'handle_secure_login') {
          return Promise.resolve({
            data: [{ success: true, user: { id: 'u2', email: 'legacy@example.com', password_hash: 'hash' } }],
            error: null
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await loginUser('legacy@example.com', 'legacyPass', 'hw123');
      expect(result.success).toBe(true);
      expect(result.user.id).toBe('u2');
      expect(result.user.password_hash).toBeUndefined();
    });
  });

  describe('registerUser', () => {
    test('returns validation error if invalid email or short password', async () => {
      let result = await registerUser('invalidemail', 'password123');
      expect(result.error).toBe('Invalid email address');

      result = await registerUser('test@example.com', '123');
      expect(result.error).toBe('Password must be at least 6 characters long');
    });

    test('registers successfully via Supabase Auth signUp', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: {
          user: { id: 'u3', email: 'new@example.com', confirmed_at: null },
          session: null
        },
        error: null
      });

      const result = await registerUser('new@example.com', 'password123', 'hw123', 'newuser');
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        options: {
          data: { username: 'newuser' }
        }
      });
      expect(result.success).toBe(true);
      expect(result.needsConfirmation).toBe(true);
    });
  });

  describe('verifyOtpUser', () => {
    test('verifies OTP token and synchronizes user session', async () => {
      mockVerifyOtp.mockResolvedValueOnce({
        data: {
          user: { id: 'u4', email: 'verified@example.com', user_metadata: { username: 'verifiedUser' } },
          session: { access_token: 'tok-verified', refresh_token: 'ref-verified' }
        },
        error: null
      });

      const result = await verifyOtpUser('verified@example.com', '123456', 'hw123');
      expect(mockVerifyOtp).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.session.access_token).toBe('tok-verified');
      expect(result.user.email).toBe('verified@example.com');
    });
  });

  describe('syncUserSession', () => {
    test('returns validation error if userId or email missing', async () => {
      const result = await syncUserSession('', 'test@example.com', 'username', 'hw123');
      expect(result.error).toBe('User ID and Email are required');
    });

    test('syncs session successfully via RPC', async () => {
      const result = await syncUserSession('u1', 'test@example.com', 'username', 'hw123');
      expect(mockRpc).toHaveBeenCalledWith('sync_user_session', {
        p_user_id: 'u1',
        p_email: 'test@example.com',
        p_username: 'username',
        p_hardware_id: 'hw123'
      });
      expect(result.success).toBe(true);
    });
  });
});
