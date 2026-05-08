const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const source = 'icoapk.png';
const androidRes = 'android/app/src/main/res';

const sizes = [
    { name: 'mipmap-mdpi', size: 48 },
    { name: 'mipmap-hdpi', size: 72 },
    { name: 'mipmap-xhdpi', size: 96 },
    { name: 'mipmap-xxhdpi', size: 144 },
    { name: 'mipmap-xxxhdpi', size: 192 }
];

async function generate() {
    for (const s of sizes) {
        const destDir = path.join(androidRes, s.name);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        // Adaptive Icon Foreground (usually what makes it look 'zoomed' if not handled)
        // For simplicity, we generate standard ic_launcher.png first
        await sharp(source)
            .resize(s.size, s.size)
            .toFile(path.join(destDir, 'ic_launcher.png'));
            
        await sharp(source)
            .resize(s.size, s.size)
            .toFile(path.join(destDir, 'ic_launcher_round.png'));

        // To fix the "zoomed in" look, foreground needs padding
        const padding = Math.floor(s.size * 0.2);
        await sharp(source)
            .resize(s.size - padding * 2, s.size - padding * 2)
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toFile(path.join(destDir, 'ic_launcher_foreground.png'));
    }
    console.log('Icons generated successfully!');
}

generate().catch(err => {
    console.error(err);
    process.exit(1);
});
