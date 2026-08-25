const fs = require('fs');

const lastLogs = new Map();
let _logPath = null;

// ANSI Terminal Colors
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  info: '\x1b[36m',    // Cyan
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  success: '\x1b[32m', // Green
  debug: '\x1b[35m'    // Magenta
};

// Safe ASCII Terminal Icons (Prevents CP437 character mangling in Windows CMD)
const ICONS = {
  info: '*',
  warn: '!',
  error: 'x',
  success: '+',
  debug: '#',
  system: '>'
};

const MODULE_BADGES = {
  SYSTEM: '\x1b[36m[SYSTEM]\x1b[0m',
  IPTV: '\x1b[33m[IPTV]\x1b[0m',
  YOUTUBE: '\x1b[31m[YOUTUBE]\x1b[0m',
  STREAMER: '\x1b[35m[STREAMER]\x1b[0m',
  ADDONS: '\x1b[32m[ADDONS]\x1b[0m',
  METADATA: '\x1b[34m[METADATA]\x1b[0m',
  RADIO: '\x1b[36m[RADIO]\x1b[0m',
  SUBTITLES: '\x1b[33m[SUBTITLES]\x1b[0m',
  STORE: '\x1b[32m[STORE]\x1b[0m'
};

function initFileLogger(logPath) {
  _logPath = logPath;
  try { fs.writeFileSync(logPath, ''); } catch (e) {}
}

function writeToDebugFile(level, msg) {
  if (!_logPath) return;
  const time = new Date().toISOString();
  try { fs.appendFileSync(_logPath, `[${time}] [${level}] ${msg}\n`); } catch (e) {}
}

function formatError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.code === 'EADDRINUSE') {
    return `Port ${err.port || ''} busy, retrying next port...`;
  }
  return err.message || String(err);
}

function log(category, message, type = 'info', err = null) {
  const now = Date.now();
  const cleanMsg = err ? `${message} -> ${formatError(err)}` : message;
  const key = `${category}:${cleanMsg}`;

  // Deduplication: don't repeat same message within 3 seconds
  if (lastLogs.has(key) && (now - lastLogs.get(key) < 3000)) return;
  lastLogs.set(key, now);

  const icon = ICONS[type] || ICONS.info;
  const timestamp = new Date().toLocaleTimeString();
  const badge = MODULE_BADGES[category.toUpperCase()] || `[${category.toUpperCase()}]`;
  const color = COLORS[type] || COLORS.reset;

  const formattedConsole = `${COLORS.dim}[${timestamp}]${COLORS.reset} ${badge} ${color}${icon} ${cleanMsg}${COLORS.reset}`;
  console.log(formattedConsole);

  writeToDebugFile(`${category}/${type.toUpperCase()}`, cleanMsg);
}

module.exports = {
  log,
  initFileLogger,
  writeToDebugFile,
  system: (msg, type = 'info', err) => log('SYSTEM', msg, type, err),
  iptv: (msg, type = 'info', err) => log('IPTV', msg, type, err),
  youtube: (msg, type = 'info', err) => log('YOUTUBE', msg, type, err),
  streamer: (msg, type = 'info', err) => log('STREAMER', msg, type, err),
  addons: (msg, type = 'info', err) => log('ADDONS', msg, type, err),
  metadata: (msg, type = 'info', err) => log('METADATA', msg, type, err),
  radio: (msg, type = 'info', err) => log('RADIO', msg, type, err),
  subtitles: (msg, type = 'info', err) => log('SUBTITLES', msg, type, err),
  store: (msg, type = 'info', err) => log('STORE', msg, type, err)
};

