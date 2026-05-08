const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const assetsDir = 'c:\\Users\\motawa\\Documents\\MediaVault\\build_assets';
const sidebarSrc = 'C:\\Users\\motawa\\.gemini\\antigravity\\brain\\04b74bdd-f533-4787-8ece-b9f504f35635\\mediavault_installer_sidebar_1778081011091.png';
const headerSrc = 'C:\\Users\\motawa\\.gemini\\antigravity\\brain\\04b74bdd-f533-4787-8ece-b9f504f35635\\mediavault_installer_header_1778081024518.png';

async function processImages() {
  try {
    // Resize Sidebar to 164x314
    await sharp(sidebarSrc)
      .resize(164, 314, { fit: 'cover' })
      .toFile(path.join(assetsDir, 'installerSidebar.png'));
    
    // Resize Header to 150x57
    await sharp(headerSrc)
      .resize(150, 57, { fit: 'cover' })
      .toFile(path.join(assetsDir, 'installerHeader.png'));
    
    console.log('✅ Premium images resized and installed successfully!');
  } catch (err) {
    console.error('❌ Error processing images:', err);
  }
}

processImages();
