const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../src/renderer/renderer.js');
let js = fs.readFileSync(file, 'utf8');

// Replace open-in-external-player blocks with playMedia
js = js.replace(
  /await window\.api\.invoke\('open-in-external-player',\s*\{[^}]+\}\);[\s\S]*?return;\s*\} else if \(window\.api && window\.api\.openInVlc\) \{[\s\S]*?return;\s*\}/g,
  `const openRes = await requestNativePlayback({ path: newUrl, title: file.name || currentItem?.title || '' }, currentShow);
                if (openRes?.success !== false) return;`
);

js = js.replace(
  /await window\.api\.invoke\('open-in-external-player',\s*\{ url: streamUrl[^}]+\}\);[\s\S]*?return;[\s\S]*?\} else if \(window\.api && window\.api\.openInVlc\) \{[\s\S]*?return;[\s\S]*?\}/g,
  `const openRes = await requestNativePlayback({ path: streamUrl, title: playItem?.title || playItem?.epTitle || '' }, showObj);
            if (openRes?.success !== false) return;`
);

js = js.replace(
  /const openRes = await window\.api\.invoke\('open-in-external-player',\s*\{ url: handoff[^}]+\}\);[\s\S]*?return;[\s\S]*?\} else if \(window\.api && window\.api\.openInVlc\) \{[\s\S]*?return;[\s\S]*?\}/g,
  `const openRes = await requestNativePlayback({ path: handoff, title: s.name || s.title || item?.title || item?.name || '' }, null);
                if (openRes?.success !== false) return;`
);

js = js.replace(
  /: window\.api\.invoke\('open-in-vlc', handoffUrl\)/g,
  ': window.api.playMedia({ url: handoffUrl, title: meta?.title || stream.name })'
);

if (!js.includes('mv-native-player-window')) {
  js = js.replace(
    `      console.log('[INIT] Starting MediaVault Boot Sequence...');
    try {`,
    `      console.log('[INIT] Starting MediaVault Boot Sequence...');
    if (isNativePlayerWindow()) {
      document.body.classList.add('mv-native-player-window');
      try { await window.api.loadData(); } catch (e) { /* ignore */ }
      switchView('player');
      return;
    }
    try {`
  );
}

fs.writeFileSync(file, js);
console.log('renderer vlc removal done');
