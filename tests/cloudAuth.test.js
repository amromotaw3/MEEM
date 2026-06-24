const { loginUser, registerUser, checkHardwareBan, getDeviceSessionWithRpcFallback, syncUserSession } = require('../src/shared/cloudAuth');

// Mock supabaseClient before importing
const mockRpc = jest.fn();
jest.mock('../src/shared/supabaseClient', () => ({
  getClient: () => ({
    rpc: mockRpc
  })
}));

jest.mock('../src/shared/supabaseEnv', () => ({
  getSuperAdminEmail: () => 'admin@mediavault.app'
}));

describe('cloudAuth unit tests', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  describe('checkHardwareBan', () => {
    test('returns null if hardwareId is empty', async () => {
      const result = await checkHardwareBan('');
      expect(result).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test('returns ban details on success', async () => {
      mockRpc.mockResolvedValue({ data: [{ banned: true, reason: 'Test Ban' }], error: null });
      const result = await checkHardwareBan('hw123');
      expect(mockRpc).toHaveBeenCalledWith('check_hardware_ban', { hardware_id: 'hw123' });
      expect(result).toEqual({ banned: true, reason: 'Test Ban' });
    });

    test('returns null and logs warning on error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: new Error('RPC Failed') });
      const result = await checkHardwareBan('hw123');
      expect(result).toBeNull();
    });
  });

  describe('getDeviceSessionWithRpcFallback', () => {
    test('returns authenticated true and safe user details if authenticated', async () => {
      const mockUser = { id: 'u1', email: 'test@example.com', password_hash: 'secret', role: 'user' };
      mockRpc.mockResolvedValue({
        data: [{ authenticated: true, user: mockUser, profiles: [{ id: 'p1' }] }],
        error: null
      });

      const result = await getDeviceSessionWithRpcFallback('hw123');
      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual({ id: 'u1', email: 'test@example.com', role: 'user' }); // password_hash is sanitized
      expect(result.profiles).toEqual([{ id: 'p1' }]);
    });

    test('returns authenticated false if not authenticated', async () => {
      mockRpc.mockResolvedValue({
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

      mockRpc.mockResolvedValue({
        data: [{ success: true, user: { id: 'u1', email: 'email@test.com' } }],
        error: null
      });
      result = await loginUser('email@test.com', 'password', '');
      expect(mockRpc).toHaveBeenCalledWith('handle_secure_login', {
        email: 'email@test.com',
        password: 'password',
        hardware_id: 'mobile-device-default'
      });
      expect(result.success).toBe(true);
    });

    test('performs login successfully via RPC', async () => {
      const mockUser = { id: 'u1', email: 'admin@mediavault.app', password_hash: 'secret' };
      mockRpc.mockResolvedValue({
        data: [{ success: true, user: mockUser }],
        error: null
      });

      const result = await loginUser('admin@mediavault.app', 'password123', 'hw123');
      expect(mockRpc).toHaveBeenCalledWith('handle_secure_login', {
        email: 'admin@mediavault.app',
        password: 'password123',
        hardware_id: 'hw123'
      });
      expect(result.success).toBe(true);
      expect(result.user.role).toBe('admin'); // auto-promoted based on superadmin email mock
    });

    test('returns error when login RPC returns error message', async () => {
      mockRpc.mockResolvedValue({
        data: [{ error: 'Invalid credentials' }],
        error: null
      });
      const result = await loginUser('test@example.com', 'wrong', 'hw123');
      expect(result.error).toBe('Invalid credentials');
    });
  });

  describe('registerUser', () => {
    test('returns validation error if invalid email or short password', async () => {
      let result = await registerUser('invalidemail', 'password123');
      expect(result.error).toBe('Invalid email address');

      result = await registerUser('test@example.com', '123');
      expect(result.error).toBe('Password must be at least 6 characters long');
    });

    test('registers successfully via RPC', async () => {
      mockRpc.mockResolvedValue({
        data: [{ success: true, user_id: 'u2' }],
        error: null
      });

      const result = await registerUser('test@example.com', 'password123');
      expect(mockRpc).toHaveBeenCalledWith('handle_register', {
        email: 'test@example.com',
        password: 'password123',
        hardware_id: null
      });
      expect(result.success).toBe(true);
    });
  });

  describe('syncUserSession', () => {
    test('returns validation error if userId or email missing', async () => {
      const result = await syncUserSession('', 'test@example.com', 'username', 'hw123');
      expect(result.error).toBe('User ID and Email are required');
    });

    test('syncs session successfully via RPC', async () => {
      mockRpc.mockResolvedValue({
        data: [{ success: true }],
        error: null
      });

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
