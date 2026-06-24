const fs = require('fs');
const p = require('path').join(__dirname, '../src/renderer/renderer.js');
let s = fs.readFileSync(p, 'utf8');
const needle = `    console.log('[INIT] Starting MediaVault Boot Sequence...');
    try {
      // 1. Android Permission Request`;
const insert = `    console.log('[INIT] Starting MediaVault Boot Sequence...');
    if (isNativePlayerWindow()) {
      document.body.classList.add('mv-native-player-window');
      try { await window.api.loadData(); } catch (e) { /* ignore */ }
      switchView('player');
      return;
    }
    try {
      // 1. Android Permission Request`;
if (s.includes('mv-native-player-window')) {
  console.log('boot already patched');
} else if (s.includes(needle)) {
  s = s.replace(needle, insert);
  fs.writeFileSync(p, s);
  console.log('boot patched');
} else {
  console.warn('boot needle not found');
}
