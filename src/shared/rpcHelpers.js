/**
 * Normalize Supabase RPC payloads (many DB functions return a single-row array).
 */
function unwrapRpcRow(data) {
  if (data == null) return null;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    if (data.length === 1 && data[0] && typeof data[0] === 'object') return data[0];
    return data[0];
  }
  return data;
}

module.exports = { unwrapRpcRow };
