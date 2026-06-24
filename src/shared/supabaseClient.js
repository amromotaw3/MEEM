try {
  global.WebSocket = require('ws');
} catch (e) {
  if (typeof global.WebSocket === 'undefined') {
    global.WebSocket = class DummyWebSocket {};
  }
}

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseUrl, getSupabaseAnonKey, isConfigured } = require('./supabaseEnv');

let _client = null;

function getClient() {
  if (!isConfigured()) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
  }
  if (!_client) {
    _client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  }
  return _client;
}

module.exports = {
  getClient
};
