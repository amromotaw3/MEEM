const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const SRC_DIR = 'C:\\Users\\motawa\\AppData\\Local\\Temp\\VeLoCity_Dark_extracted';
const TARGET_DIR = path.join(__dirname, '..', 'src', 'assets', 'skins', 'meem_velocity_package');
const FINAL_VLT = path.join(__dirname, '..', 'src', 'assets', 'skins', 'MEEM.vlt');

async function recolorImage(imgPath, matchFn) {
  if (!fs.existsSync(imgPath)) return;
  const image = sharp(imgPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Don't touch magenta transparent key (#FF00FF)
    if (r === 255 && g === 0 && b === 255) continue;

    if (matchFn(r, g, b)) {
      data[i] = 0;     // R
      data[i + 1] = 173; // G (#00ADB5)
      data[i + 2] = 181; // B
    }
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  }).png().toFile(imgPath + '.tmp');

  fs.renameSync(imgPath + '.tmp', imgPath);
}

async function buildVeLoCityMeem() {
  console.log('[MEEM VeLoCity] Preparing skin package...');
  if (fs.existsSync(TARGET_DIR)) fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  // Copy all files
  const files = ['theme.xml', 'buttons20.png', 'buttons30.png', 'bg.png', 'time.png', 'bg2.png', 'volume.png', 'corners.png', 'roboto.ttf'];
  for (const f of files) {
    const srcFile = path.join(SRC_DIR, f);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(TARGET_DIR, f));
    }
  }

  console.log('[MEEM VeLoCity] Recoloring time slider & volume to MEEM Cyan (#00ADB5)...');
  // Recolor time.png (blue/white highlights -> Cyan)
  await recolorImage(path.join(TARGET_DIR, 'time.png'), (r, g, b) => {
    // Blue accents or bright progress fill
    return (b > 160 && r < 120) || (b > 200 && g > 150 && r < 100);
  });

  // Recolor volume.png
  await recolorImage(path.join(TARGET_DIR, 'volume.png'), (r, g, b) => {
    return (b > 160 && r < 120) || (b > 200 && g > 150 && r < 100);
  });

  // Recolor buttons30.png (active/hover button states)
  await recolorImage(path.join(TARGET_DIR, 'buttons30.png'), (r, g, b) => {
    return (b > 160 && r < 120);
  });

  // Update theme.xml
  console.log('[MEEM VeLoCity] Updating theme.xml with MEEM branding...');
  let xml = fs.readFileSync(path.join(TARGET_DIR, 'theme.xml'), 'utf8');
  xml = xml.replace(/name="VeLoCity Dark"/g, 'name="MEEM VeLoCity Edition"');
  xml = xml.replace(/author="Dmtiir"/g, 'author="MEEM &amp; Dmtiir"');
  xml = xml.replace(/email="[^"]*"/g, 'email="info@meem.app"');
  xml = xml.replace(/webpage="[^"]*"/g, 'webpage="https://meem.app"');

  // Replace text font colors to MEEM Cyan where appropriate
  xml = xml.replace(/color="#0080FF"/gi, 'color="#00ADB5"');
  xml = xml.replace(/color="#2E9AFE"/gi, 'color="#00ADB5"');
  xml = xml.replace(/color="#00BFFF"/gi, 'color="#00ADB5"');
  xml = xml.replace(/color="#1E90FF"/gi, 'color="#00ADB5"');

  fs.writeFileSync(path.join(TARGET_DIR, 'theme.xml'), xml, 'utf8');

  // Package into MEEM.vlt
  console.log('[MEEM VeLoCity] Compiling MEEM.vlt...');
  if (fs.existsSync(FINAL_VLT)) fs.unlinkSync(FINAL_VLT);
  execSync(`tar -czf "${FINAL_VLT}" -C "${TARGET_DIR}" .`);
  console.log(`[MEEM VeLoCity] ✓ SUCCESS: Created ${FINAL_VLT} (${(fs.statSync(FINAL_VLT).size / 1024).toFixed(1)} KB)`);

  // Copy to AppData VLC skins directory
  const appDataSkins = path.join(process.env.APPDATA, 'vlc', 'skins');
  if (!fs.existsSync(appDataSkins)) fs.mkdirSync(appDataSkins, { recursive: true });
  fs.copyFileSync(FINAL_VLT, path.join(appDataSkins, 'MEEM.vlt'));
  console.log(`[MEEM VeLoCity] ✓ Installed to: ${path.join(appDataSkins, 'MEEM.vlt')}`);
}

buildVeLoCityMeem().catch(console.error);
