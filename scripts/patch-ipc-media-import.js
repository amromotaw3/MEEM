const fs = require('fs');
const p = require('path').join(__dirname, '../src/main/ipcHandlers.js');
let s = fs.readFileSync(p, 'utf8');
const needle = 'async function playMedia(args) {\n    try {';
const insert = "async function playMedia(args) {\n    try {\n      const { toMediaProtocolUrl } = require('./mediaProtocol');";
if (!s.includes("require('./mediaProtocol')")) {
  if (!s.includes(needle)) throw new Error('playMedia block not found');
  s = s.replace(needle, insert);
  fs.writeFileSync(p, s);
  console.log('ipcHandlers patched');
} else {
  console.log('already patched');
}
