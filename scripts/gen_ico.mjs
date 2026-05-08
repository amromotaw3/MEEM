import pngToIco from 'png-to-ico';
import fs from 'fs';

async function run() {
    try {
        const buf = await pngToIco('c:/Users/motawa/Documents/MediaVault/scripts/temp_square.png');
        fs.writeFileSync('c:/Users/motawa/Documents/MediaVault/src/renderer/imgs/appicon.ico', buf);
        console.log('PC Icon (.ico) generated successfully.');
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
