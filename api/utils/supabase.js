const { createClient } = require('@supabase/supabase-js');
const {
  getSupabaseUrl,
  getServerKey,
  isConfigured,
  getSuperAdminEmail
} = require('../../src/shared/supabaseEnv');

if (!isConfigured()) {
  console.error('[SUPABASE] Missing SUPABASE_URL or API key in environment variables.');
}

const supabase = createClient(getSupabaseUrl() || '', getServerKey() || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

module.exports = { supabase, isConfigured, getSuperAdminEmail };
