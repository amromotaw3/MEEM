const sharp = require('sharp');
const { Jimp } = require('jimp');
const jimpPkg = require('jimp');
const path = require('path');
const fs = require('fs');

async function saveAsBmp(pngBuffer, outputPath) {
  const JimpConstructor = Jimp || jimpPkg.Jimp || jimpPkg;
  const image = await JimpConstructor.read(pngBuffer);
  await image.write(outputPath);
}

async function generateNsisAssets() {
  const buildDir = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const blackLogo = path.join(__dirname, '..', 'src', 'renderer', 'imgs', 'black n-ico.png');
  const whiteLogo = path.join(__dirname, '..', 'src', 'renderer', 'imgs', 'white-n-ico.png');
  const appIcon = path.join(__dirname, '..', 'src', 'renderer', 'imgs', 'appicon.png');

  const selectedBlackLogo = fs.existsSync(blackLogo) ? blackLogo : appIcon;
  const selectedWhiteLogo = fs.existsSync(whiteLogo) ? whiteLogo : appIcon;

  console.log('[ASSETS] Generating Clean Seamless NSIS Assets...');

  // 1. Header BMP (150 x 57) - MUST BE PURE WHITE (#FFFFFF) to seamlessly blend with MUI2 header!
  const headerSvg = `
    <svg width="150" height="57" xmlns="http://www.w3.org/2000/svg">
      <rect width="150" height="57" fill="#FFFFFF"/>
    </svg>
  `;

  const headerBg = await sharp(Buffer.from(headerSvg)).png().toBuffer();
  const logoHeader = await sharp(selectedBlackLogo)
    .resize(38, 38, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();

  const finalHeaderPng = await sharp(headerBg)
    .composite([
      {
        input: logoHeader,
        top: 9,
        left: 102
      }
    ])
    .png()
    .toBuffer();

  await saveAsBmp(finalHeaderPng, path.join(buildDir, 'installerHeader.bmp'));
  console.log('[ASSETS] Created seamless build/installerHeader.bmp (150x57)');

  // 2. Sidebar BMP (164 x 314) - Sleek Left Banner for Finish page
  const sidebarSvg = `
    <svg width="164" height="314" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sideGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#141419"/>
          <stop offset="50%" stop-color="#0A0A0C"/>
          <stop offset="100%" stop-color="#050507"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="32%" r="45%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="164" height="314" fill="url(#sideGrad)"/>
      <circle cx="82" cy="95" r="65" fill="url(#glow)"/>
      <text x="82" y="185" font-family="'Segoe UI', Arial, sans-serif" font-size="20" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="4">MEEM</text>
      <text x="82" y="206" font-family="'Segoe UI', Arial, sans-serif" font-size="9" font-weight="600" fill="#888899" text-anchor="middle" letter-spacing="1">PLAY ANYTHING</text>
      <rect x="52" y="222" width="60" height="1" fill="#333340"/>
    </svg>
  `;

  const sidebarBg = await sharp(Buffer.from(sidebarSvg)).png().toBuffer();
  const logoSidebar = await sharp(selectedWhiteLogo)
    .resize(70, 70, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const finalSidebarPng = await sharp(sidebarBg)
    .composite([
      {
        input: logoSidebar,
        top: 60,
        left: 47
      }
    ])
    .png()
    .toBuffer();

  await saveAsBmp(finalSidebarPng, path.join(buildDir, 'installerSidebar.bmp'));
  await saveAsBmp(finalSidebarPng, path.join(buildDir, 'uninstallerSidebar.bmp'));

  console.log('[ASSETS] Created build/installerSidebar.bmp (164x314)');
  console.log('[ASSETS] Created build/uninstallerSidebar.bmp (164x314)');
}

generateNsisAssets().catch(err => {
  console.error('[ASSETS ERROR]', err);
  process.exit(1);
});
