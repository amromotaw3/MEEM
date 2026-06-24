const fs = require('fs');
const path = require('path');

const rendererPath = path.join(__dirname, '../src/renderer/renderer.js');
const blockPath = path.join(__dirname, '../_restore_block.js');

const block = fs.readFileSync(blockPath, 'utf8');
let js = fs.readFileSync(rendererPath, 'utf8');

if (js.includes('function triggerAutoNext()')) {
  console.log('skip: triggerAutoNext already present');
  process.exit(0);
}

const needle = [
  "    setTimeout(() => { pl.querySelector('.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 100);",
  '  }',
  '',
  '  async function playStream(stream, meta, cardEl = null)'
].join('\n');

if (!js.includes(needle)) {
  console.error('needle not found');
  process.exit(1);
}

js = js.replace(needle, [
  "    setTimeout(() => { pl.querySelector('.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 100);",
  '  }',
  '',
  block.trimEnd(),
  '',
  '  async function playStream(stream, meta, cardEl = null)'
].join('\n'));

fs.writeFileSync(rendererPath, js);
console.log('restored block, lines:', block.split('\n').length);
