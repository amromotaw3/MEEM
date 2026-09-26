const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const srcIcon = 'src/renderer/imgs/white-n-ico.png';

const densities = {
  'mipmap-mdpi': { launcher: 48, adaptive: 108, markSize: 66 },
  'mipmap-hdpi': { launcher: 72, adaptive: 162, markSize: 100 },
  'mipmap-xhdpi': { launcher: 96, adaptive: 216, markSize: 132 },
  'mipmap-xxhdpi': { launcher: 144, adaptive: 324, markSize: 200 },
  'mipmap-xxxhdpi': { launcher: 192, adaptive: 432, markSize: 266 }
};

async function run() {
  for (const [folder, cfg] of Object.entries(densities)) {
    const dir = path.join('android/app/src/main/res', folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 1. Adaptive foreground: transparent canvas with centered mark
    const fgMark = await sharp(srcIcon)
      .resize(cfg.markSize, cfg.markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await sharp({
      create: {
        width: cfg.adaptive,
        height: cfg.adaptive,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite([{ input: fgMark, gravity: 'center' }])
    .png()
    .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    // 2. Legacy ic_launcher: black background with mark
    const legacyMark = await sharp(srcIcon)
      .resize(Math.round(cfg.launcher * 0.7), Math.round(cfg.launcher * 0.7), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await sharp({
      create: {
        width: cfg.launcher,
        height: cfg.launcher,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      }
    })
    .composite([{ input: legacyMark, gravity: 'center' }])
    .png()
    .toFile(path.join(dir, 'ic_launcher.png'));

    // 3. Legacy ic_launcher_round: black circle with mark
    const circleSvg = Buffer.from(
      '<svg width="' + cfg.launcher + '" height="' + cfg.launcher + '"><circle cx="' + (cfg.launcher / 2) + '" cy="' + (cfg.launcher / 2) + '" r="' + (cfg.launcher / 2) + '" fill="#000000"/></svg>'
    );
    await sharp(circleSvg)
      .composite([{ input: legacyMark, gravity: 'center' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    console.log('Generated icons for ' + folder);
  }
}

run().catch(console.error);
