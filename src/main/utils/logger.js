const lastLogs = new Map();

/**
 * Smart Logger to prevent terminal noise
 * @param {string} category - e.g. 'STORE', 'IPC', 'TMDB'
 * @param {string} message - The log content
 * @param {string} type - 'info', 'warn', 'error', 'success'
 */
function log(category, message, type = 'info') {
    const now = Date.now();
    const key = `${category}:${message}`;
    
    // Deduplication: Don't repeat same message within 3 seconds
    if (lastLogs.has(key) && (now - lastLogs.get(key) < 3000)) {
        return;
    }
    lastLogs.set(key, now);

    const icons = {
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
        success: '✅',
        debug: '🔍'
    };

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${icons[type] || '•'} [${category}] ${message}`);
}

module.exports = { log };
