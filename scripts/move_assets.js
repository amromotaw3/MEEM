const sharp = require('sharp');
const path = require('path');

const buildDir = 'c:\\Users\\motawa\\Documents\\MediaVault\\build';
const sidebarSrc = 'c:\\Users\\motawa\\Documents\\MediaVault\\build_assets\\installerSidebar.png';
const headerSrc = 'c:\\Users\\motawa\\Documents\\MediaVault\\build_assets\\installerHeader.png';

async function processImages() {
  try {
    // Convert Sidebar to BMP (NSIS standard)
    await sharp(sidebarSrc)
      .resize(164, 314, { fit: 'cover' })
      .toFormat('png') // We'll try PNG first but in the correct folder, 
                       // if it fails we'll use a BMP converter.
                       // Actually, many modern electron-builders support PNG if paths are right.
      .toFile(path.join(buildDir, 'installerSidebar.png'));
    
    // Resize Header
    await sharp(headerSrc)
      .resize(150, 57, { fit: 'cover' })
      .toFile(path.join(buildDir, 'installerHeader.png'));
    
    console.log('✅ Images moved to standard /build folder');
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

processImages();
