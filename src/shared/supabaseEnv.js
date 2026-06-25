const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch (_) { /* dotenv optional in production */ }

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function getSupabaseUrl() {
  return pickEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'MEDIAVAULT_SUPABASE_URL');
}

function getSupabaseAnonKey() {
  return pickEnv(
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'MEDIAVAULT_SUPABASE_ANON_KEY'
  );
}

function getSupabaseServiceRoleKey() {
  return pickEnv('SUPABASE_SERVICE_ROLE_KEY');
}

function getSuperAdminEmail() {
  return pickEnv('SUPER_ADMIN_EMAIL') || 'amro.motawa@icloud.com';
}

function isConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

function getServerKey() {
  return getSupabaseServiceRoleKey() || getSupabaseAnonKey();
}

module.exports = {
  getSupabaseUrl,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  isConfigured,
  getServerKey,
  getSuperAdminEmail
};
