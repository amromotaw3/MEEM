const { getClient } = require('../shared/supabaseClient');
const { isConfigured } = require('../shared/supabaseEnv');

function getSupabaseClient() {
  return getClient();
}

function formatRpcError(error) {
  const msg = error?.message || 'Supabase RPC failed';
  const err = new Error(msg);
  if (error?.code) err.code = error.code;
  if (error?.details) err.details = error.details;
  if (error?.hint) err.hint = error.hint;
  return err;
}

async function supabaseRpc(fn, body = {}) {
  const { data, error } = await getClient().rpc(fn, body);
  if (error) throw formatRpcError(error);
  return data;
}

module.exports = { supabaseRpc, getSupabaseClient, isConfigured };
