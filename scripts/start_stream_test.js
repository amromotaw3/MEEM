const http = require('http');
const mag = process.argv[2];
if (!mag) {
  console.error('Usage: node start_stream_test.js <magnet>');
  process.exit(2);
}
const enc = encodeURIComponent(mag);
const url = `http://127.0.0.1:11471/start?url=${enc}&fileIdx=0`;
console.log('Requesting:', url);
http.get(url, (res) => {
  let s = '';
  res.on('data', d => s += d.toString());
  res.on('end', () => {
    console.log('--- RESPONSE ---');
    try { console.log(JSON.parse(s)); } catch (e) { console.log(s); }
    process.exit(0);
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
  process.exit(1);
});
