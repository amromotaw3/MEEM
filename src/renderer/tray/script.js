// Helper to update elements
const $ = (id) => document.getElementById(id);

// Button Handlers
const showAppBtn = $('btn-show-app');
if (showAppBtn) showAppBtn.onclick = () => window.api.sendTrayAction('show-app');

const settingsBtn = $('btn-settings-app');
if (settingsBtn) settingsBtn.onclick = () => window.api.sendTrayAction('open-settings');

const quitBtn = $('btn-quit');
if (quitBtn) quitBtn.onclick = () => window.api.sendTrayAction('quit-app');

// Playback Handlers
const playPauseBtn = $('btn-play-pause');
if (playPauseBtn) playPauseBtn.onclick = () => window.api.sendTrayAction('toggle-play');

const prevBtn = $('btn-prev');
if (prevBtn) prevBtn.onclick = () => window.api.sendTrayAction('prev-track');

const nextBtn = $('btn-next');
if (nextBtn) nextBtn.onclick = () => window.api.sendTrayAction('next-track');

const volSlider = $('volume-slider');
if (volSlider) {
    volSlider.oninput = (e) => {
        window.api.sendTrayAction('set-volume', parseInt(e.target.value));
    };
}

const btnVolUp = $('btn-vol-up');
if (btnVolUp) {
    btnVolUp.onclick = () => {
        const newVal = Math.min(100, parseInt(volSlider.value) + 5);
        volSlider.value = newVal;
        window.api.sendTrayAction('set-volume', newVal);
    };
}

const btnVolDown = $('btn-vol-down');
if (btnVolDown) {
    btnVolDown.onclick = () => {
        const newVal = Math.max(0, parseInt(volSlider.value) - 5);
        volSlider.value = newVal;
        window.api.sendTrayAction('set-volume', newVal);
    };
}

// Handle image errors for social media thumbnails
const trayImg = $('current-image');
if (trayImg) {
    trayImg.onerror = () => {
        // If .cover.jpg fails, try .png (common social media thumbnail format)
        if (trayImg.src.includes('.cover.jpg')) {
            trayImg.src = trayImg.src.replace('.cover.jpg', '.png');
        } else {
            trayImg.style.display = 'none';
            const section = $('now-playing-section');
            if (section) section.classList.remove('has-image');
        }
    };
}

// Update UI from Main process
window.api.onUpdateTrayUi((data) => {
    if (data.status) {
        $('current-title').textContent = data.status;
    }

    if (data.image) {
        const img = $('current-image');
        const section = $('now-playing-section');
        if (img) {
            img.src = data.image;
            img.style.display = 'block';
            if (section) section.classList.add('has-image');
        }
    } else {
        const img = $('current-image');
        const section = $('now-playing-section');
        if (img) {
            img.style.display = 'none';
            if (section) section.classList.remove('has-image');
        }
    }

    if (data.progress !== undefined) {
        $('progress-fill').style.width = `${data.progress}%`;
    }
    
    if (data.volume !== undefined) {
        const slider = $('volume-slider');
        if (slider) slider.value = data.volume;
    }

    // Toggle between Playing Section and Idle Placeholder
    const playingSection = $('now-playing-section');
    const idlePlaceholder = $('idle-placeholder');
    const volumeSection = document.querySelector('.tray-volume-wrap');
    
    const isIdle = data.status === 'Idle' || !data.status || data.status === 'Nothing playing';
    
    if (isIdle) {
        playingSection.style.display = 'none';
        idlePlaceholder.style.display = 'flex';
        if (volumeSection) volumeSection.style.display = 'none';
    } else {
        playingSection.style.display = 'flex';
        idlePlaceholder.style.display = 'none';
        if (volumeSection) volumeSection.style.display = 'flex';
    }

    // Update Play/Pause Icon
    if (data.isPlaying !== undefined) {
        const btn = $('btn-play-pause');
        if (data.isPlaying) {
            btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        } else {
            btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
        }
    }

    // Smart Height Reporting (Like Steam)
    // We use requestAnimationFrame for a smoother check
    requestAnimationFrame(() => {
        const height = document.querySelector('.tray-container').offsetHeight;
        if (height > 50) {
            window.api.updateTrayHeight(height + 4); 
        }
    });
});

// Close window when clicking outside
window.addEventListener('blur', () => {
    window.api.sendTrayAction('close-tray');
});
