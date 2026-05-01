const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const src = 'src/renderer/imgs/appicon_an.png';
const resDir = 'android/app/src/main/res';

const configs = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 }
];

async function generate() {
  if (!fs.existsSync(src)) {
    console.error('Source icon not found:', src);
    process.exit(1);
  }

  for (const config of configs) {
    const targetDir = path.join(resDir, config.dir);
    if (!fs.existsSync(targetDir)) {
      console.warn('Target directory missing, skipping:', targetDir);
      continue;
    }

    // Normal Icon
    await sharp(src)
      .resize(config.size, config.size)
      .toFile(path.join(targetDir, 'ic_launcher.png'));
    
    // Round Icon
    await sharp(src)
      .resize(config.size, config.size)
      .toFile(path.join(targetDir, 'ic_launcher_round.png'));

    // Foreground Icon (for Adaptive Icons)
    await sharp(src)
      .resize(config.size, config.size)
      .toFile(path.join(targetDir, 'ic_launcher_foreground.png'));

    console.log(`Generated icons for ${config.dir} (${config.size}x${config.size})`);
  }
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
