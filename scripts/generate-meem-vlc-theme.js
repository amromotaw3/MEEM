const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'assets', 'skins', 'meem_vlc_source');
const FINAL_VLT = path.join(__dirname, '..', 'src', 'assets', 'skins', 'MEEM.vlt');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ── SVG DEFINITIONS ────────────────────────────────────────────────────────
const assets = {
  'main_bg.png': {
    width: 900,
    height: 560,
    svg: `
      <svg width="900" height="560" xmlns="http://www.w3.org/2000/svg">
        <rect width="900" height="560" rx="16" fill="#0A0E17" stroke="#1E293B" stroke-width="2"/>
        <rect width="900" height="40" rx="16" fill="#0F172A"/>
        <rect y="490" width="900" height="70" rx="16" fill="#0F172A"/>
      </svg>`
  },
  'play_btn.png': {
    width: 28,
    height: 28,
    svg: `
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="13" fill="#00ADB5"/>
        <polygon points="11,8 20,14 11,20" fill="#0A0E17"/>
      </svg>`
  },
  'pause_btn.png': {
    width: 28,
    height: 28,
    svg: `
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="13" fill="#00ADB5"/>
        <rect x="9" y="8" width="3" height="12" rx="1" fill="#0A0E17"/>
        <rect x="16" y="8" width="3" height="12" rx="1" fill="#0A0E17"/>
      </svg>`
  },
  'stop_btn.png': {
    width: 28,
    height: 28,
    svg: `
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="13" fill="#1E293B" stroke="#334155" stroke-width="1.5"/>
        <rect x="9" y="9" width="10" height="10" rx="1.5" fill="#EEEEEE"/>
      </svg>`
  },
  'close_btn.png': {
    width: 24,
    height: 24,
    svg: `
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#E11D48"/>
        <line x1="8" y1="8" x2="16" y2="16" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="8" x2="8" y2="16" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
      </svg>`
  },
  'min_btn.png': {
    width: 24,
    height: 24,
    svg: `
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#334155"/>
        <line x1="7" y1="12" x2="17" y2="12" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
      </svg>`
  },
  'fscreen_btn.png': {
    width: 28,
    height: 28,
    svg: `
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="6" fill="#1E293B"/>
        <polyline points="9 13 9 9 13 9" fill="none" stroke="#00ADB5" stroke-width="2" stroke-linecap="round"/>
        <polyline points="19 13 19 9 15 9" fill="none" stroke="#00ADB5" stroke-width="2" stroke-linecap="round"/>
        <polyline points="9 15 9 19 13 19" fill="none" stroke="#00ADB5" stroke-width="2" stroke-linecap="round"/>
        <polyline points="19 15 19 19 15 19" fill="none" stroke="#00ADB5" stroke-width="2" stroke-linecap="round"/>
      </svg>`
  },
  'slider_bg.png': {
    width: 860,
    height: 8,
    svg: `
      <svg width="860" height="8" xmlns="http://www.w3.org/2000/svg">
        <rect width="860" height="8" rx="4" fill="#1E293B" stroke="#334155" stroke-width="1"/>
      </svg>`
  },
  'slider_knob.png': {
    width: 16,
    height: 16,
    svg: `
      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="7" fill="#00ADB5" stroke="#FFFFFF" stroke-width="2"/>
      </svg>`
  },
  'vol_bg.png': {
    width: 100,
    height: 8,
    svg: `
      <svg width="100" height="8" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="8" rx="4" fill="#1E293B" stroke="#334155" stroke-width="1"/>
      </svg>`
  },
  'vol_knob.png': {
    width: 14,
    height: 14,
    svg: `
      <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
        <circle cx="7" cy="7" r="6" fill="#00ADB5" stroke="#FFFFFF" stroke-width="1.5"/>
      </svg>`
  }
};

const themeXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Theme PUBLIC "-//VideoLAN//DTD VLC Skins V2.0//EN" "http://www.videolan.org/vlc/skin.dtd">
<Theme version="2.0" magnet="15">
  <ThemeInfo name="MEEM Dark Theme" author="MEEM" email="info@meem.app" webpage="https://meem.app" />

  <Bitmap id="main_bg" file="main_bg.png" />
  <Bitmap id="play_btn" file="play_btn.png" />
  <Bitmap id="pause_btn" file="pause_btn.png" />
  <Bitmap id="stop_btn" file="stop_btn.png" />
  <Bitmap id="fscreen_btn" file="fscreen_btn.png" />
  <Bitmap id="close_btn" file="close_btn.png" />
  <Bitmap id="min_btn" file="min_btn.png" />
  <Bitmap id="slider_bg" file="slider_bg.png" />
  <Bitmap id="slider_knob" file="slider_knob.png" />
  <Bitmap id="vol_bg" file="vol_bg.png" />
  <Bitmap id="vol_knob" file="vol_knob.png" />

  <Window id="main_win" x="80" y="80" dragdrop="true" playondrop="true">
    <Layout id="default" width="900" height="560" minwidth="640" minheight="400">
      <Group x="0" y="0" width="width" height="height">
        <!-- Top Bar -->
        <Panel x="0" y="0" width="width" height="40">
          <Text x="18" y="12" text="MEEM Player" color="#00ADB5" font="default" size="14" bold="true" />
          <Button x="width - 32" y="10" up="close_btn" over="close_btn" action="vlc.quit()" tooltiptext="Close" />
          <Button x="width - 62" y="10" up="min_btn" over="min_btn" action="vlc.minimize()" tooltiptext="Minimize" />
        </Panel>

        <!-- Video Display Area -->
        <Video id="video" x="4" y="40" width="width - 8" height="height - 110" autoresize="true" />

        <!-- Bottom Controls -->
        <Panel x="0" y="height - 70" width="width" height="70">
          <!-- Seek Timeline -->
          <Slider id="time_slider" x="20" y="10" width="width - 40" height="8" up="slider_bg" pointer="slider_knob" value="vlc.time" tooltiptext="$T / $D" />

          <!-- Play / Pause Buttons -->
          <Button x="22" y="28" up="play_btn" over="play_btn" action="vlc.play()" tooltiptext="Play" visible="!vlc.isPlaying" />
          <Button x="22" y="28" up="pause_btn" over="pause_btn" action="vlc.pause()" tooltiptext="Pause" visible="vlc.isPlaying" />
          <Button x="58" y="28" up="stop_btn" over="stop_btn" action="vlc.stop()" tooltiptext="Stop" />

          <!-- Time text -->
          <Text x="98" y="34" text="$T / $D" color="#E2E8F0" font="default" size="11" />

          <!-- Volume Controls -->
          <Text x="width - 235" y="34" text="VOL" color="#94A3B8" font="default" size="10" bold="true" />
          <Slider id="vol_slider" x="width - 200" y="34" width="120" height="8" up="vol_bg" pointer="vol_knob" value="vlc.volume" tooltiptext="Volume $V%" />

          <!-- Fullscreen -->
          <Button x="width - 50" y="28" up="fscreen_btn" over="fscreen_btn" action="vlc.fullscreen()" tooltiptext="Fullscreen" />
        </Panel>
      </Group>
    </Layout>
  </Window>
</Theme>
`;

async function buildTheme() {
  console.log('[MEEM Theme] Generating PNG assets via Sharp...');
  for (const [filename, info] of Object.entries(assets)) {
    const filePath = path.join(OUTPUT_DIR, filename);
    await sharp(Buffer.from(info.svg))
      .png()
      .toFile(filePath);
    console.log(` ✓ Created ${filename}`);
  }

  // Write theme.xml
  const xmlPath = path.join(OUTPUT_DIR, 'theme.xml');
  fs.writeFileSync(xmlPath, themeXmlContent, 'utf8');
  console.log(' ✓ Created theme.xml');

  // Package into MEEM.vlt (Zip file renamed to .vlt)
  console.log('[MEEM Theme] Packaging into MEEM.vlt...');
  const tempZip = path.join(__dirname, '..', 'src', 'assets', 'skins', 'MEEM.zip');
  try {
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    if (fs.existsSync(FINAL_VLT)) fs.unlinkSync(FINAL_VLT);
    const powershellCmd = `Compress-Archive -Path '${OUTPUT_DIR}\\*' -DestinationPath '${tempZip}' -Force`;
    execSync(`powershell -NoProfile -Command "${powershellCmd}"`);
    fs.renameSync(tempZip, FINAL_VLT);
    console.log(`[MEEM Theme] ✓ SUCCESS: Created ${FINAL_VLT} (${(fs.statSync(FINAL_VLT).size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error('[MEEM Theme] Error packaging .vlt:', err.message);
  }
}

buildTheme();
