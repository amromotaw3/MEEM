const { Jimp } = require('jimp');
const path = require('path');

const buildDir = 'c:\\Users\\motawa\\Documents\\MediaVault\\build';
const sidebarSrc = 'c:\\Users\\motawa\\Documents\\MediaVault\\build_assets\\installerSidebar.png';
const headerSrc = 'c:\\Users\\motawa\\Documents\\MediaVault\\build_assets\\installerHeader.png';

async function convertToBmp() {
  try {
    const sidebar = await Jimp.read(sidebarSrc);
    sidebar.resize({ w: 164, h: 314 });
    await sidebar.write(path.join(buildDir, 'installerSidebar.bmp'));
    
    const header = await Jimp.read(headerSrc);
    header.resize({ w: 150, h: 57 });
    await header.write(path.join(buildDir, 'installerHeader.bmp'));
    
    console.log('✅ Success: Images converted to .bmp and moved to /build');
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

convertToBmp();
