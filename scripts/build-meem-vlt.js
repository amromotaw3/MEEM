const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const SRC_DIR = 'C:\\Users\\motawa\\AppData\\Local\\Temp\\default';
const TARGET_DIR = path.join(__dirname, '..', 'src', 'assets', 'skins', 'meem_skin_package');
const FINAL_VLT = path.join(__dirname, '..', 'src', 'assets', 'skins', 'MEEM.vlt');

async function build() {
  if (fs.existsSync(TARGET_DIR)) fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.cpSync(SRC_DIR, TARGET_DIR, { recursive: true });

  // Recolor images (convert orange/blue highlights to MEEM Cyan #00ADB5)
  const mainPngPath = path.join(TARGET_DIR, 'subX', 'main.png');
  if (fs.existsSync(mainPngPath)) {
    console.log('[MEEM VLC] Recoloring main.png to MEEM Cyan #00ADB5...');
    const image = sharp(mainPngPath);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    
    // Convert orange pixels (r > 200, g < 150, b < 50) and blue highlights to cyan (0, 173, 181)
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = info.channels === 4 ? data[i + 3] : 255;

      // Don't touch magenta transparent key (#FF00FF)
      if (r === 255 && g === 0 && b === 255) continue;

      // Detect orange/amber highlights
      if (r > 180 && g < 140 && b < 80) {
        data[i] = 0;     // R
        data[i + 1] = 173; // G
        data[i + 2] = 181; // B
      }
      // Detect blue highlights
      else if (b > 180 && r < 100 && g < 160) {
        data[i] = 0;     // R
        data[i + 1] = 173; // G
        data[i + 2] = 181; // B
      }
    }

    await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels
      }
    }).png().toFile(mainPngPath + '.tmp');

    fs.renameSync(mainPngPath + '.tmp', mainPngPath);
    console.log(' ✓ main.png recolored');
  }

  // Update theme.xml with MEEM Player branding and colors
  let xml = fs.readFileSync(path.join(TARGET_DIR, 'theme.xml'), 'utf8');
  xml = xml.replace(/name="subX"/g, 'name="MEEM Dark Theme"');
  xml = xml.replace(/author="Martin Poehlmann"/g, 'author="MEEM"');
  xml = xml.replace(/email=""/g, 'email="info@meem.app"');
  xml = xml.replace(/webpage="[^"]*"/g, 'webpage="https://meem.app"');

  // Replace text colors from blue/white to cyan #00ADB5
  xml = xml.replace(/color="#307CC0"/gi, 'color="#00ADB5"');
  xml = xml.replace(/color="#4080C0"/gi, 'color="#00ADB5"');
  xml = xml.replace(/color="#5090D0"/gi, 'color="#00ADB5"');

  fs.writeFileSync(path.join(TARGET_DIR, 'theme.xml'), xml, 'utf8');
  console.log(' ✓ theme.xml updated with MEEM branding');

  // Package into MEEM.vlt (tar.gz format required by VLC)
  if (fs.existsSync(FINAL_VLT)) fs.unlinkSync(FINAL_VLT);
  execSync(`tar -czf "${FINAL_VLT}" -C "${TARGET_DIR}" .`);
  console.log(`[MEEM VLC] ✓ SUCCESS: Created compliant ${FINAL_VLT} (${(fs.statSync(FINAL_VLT).size / 1024).toFixed(1)} KB)`);

  // Also copy to AppData VLC skins directory so VLC can find it immediately
  const appDataSkins = path.join(process.env.APPDATA, 'vlc', 'skins');
  if (!fs.existsSync(appDataSkins)) fs.mkdirSync(appDataSkins, { recursive: true });
  fs.copyFileSync(FINAL_VLT, path.join(appDataSkins, 'MEEM.vlt'));
  console.log(`[MEEM VLC] ✓ Installed to VLC skins folder: ${path.join(appDataSkins, 'MEEM.vlt')}`);
}

build().catch(console.error);
