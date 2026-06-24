const fs = require('fs');
const p = require('path').join(__dirname, '../src/renderer/js/bridge.js');
let s = fs.readFileSync(p, 'utf8');

const reps = [
  ["if (channel === 'open-in-vlc') return window.api.openInVlc(args[0]);",
   "if (channel === 'open-in-vlc') return window.api.playMedia(typeof args[0] === 'object' ? args[0] : { path: args[0] });\n            if (channel === 'play-media') return window.api.playMedia(args[0]);\n            if (channel === 'open-in-external-player') return window.api.playMedia(args[0]);"],
  ["if (channel === 'play-native') return window.api.playNative(args[0]);",
   "if (channel === 'play-native') return window.api.playMedia(args[0]);"],
  ["if (channel === 'play-external') return window.api.playExternal(args[0], args[1] || {});",
   "if (channel === 'play-external') return window.api.playMedia(typeof args[0] === 'object' ? args[0] : { url: args[0], ...(args[1] || {}) });"],
  ['return await window.api.invoke(\'open-in-vlc\', path);',
   'return await window.api.playMedia(typeof path === \'object\' ? path : { path });'],
  ['return window.api.openInVlc(path);',
   'return window.api.playMedia(typeof path === \'object\' ? path : { path });']
];

for (const [a, b] of reps) {
  if (s.includes(a)) {
    s = s.replace(a, b);
    console.log('replaced:', a.slice(0, 40));
  }
}
fs.writeFileSync(p, s);
