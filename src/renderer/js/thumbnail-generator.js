/**
 * MediaVault Thumbnail Generator
 * Uses HTML5 Canvas to take snapshots of local/remote video files.
 */
window.generateVideoThumbnail = async function(videoUrl, seekTime = 5) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        
        // Ensure videoUrl is safe for Electron/CORS
        // If it's a local path without protocol, prefix it (handled by bridge usually)
        video.src = videoUrl;
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';

        // Timeout to prevent hanging on corrupt files
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Thumbnail generation timed out'));
        }, 10000);

        function cleanup() {
            clearTimeout(timeout);
            video.pause();
            video.src = '';
            video.load();
            video.remove();
        }

        video.onloadedmetadata = () => {
            // Seek to the requested time, safely bounded by duration
            const safeDur = (video.duration && isFinite(video.duration)) ? video.duration : seekTime + 1;
            video.currentTime = Math.min(seekTime, Math.max(0, safeDur - 0.5));
        };

        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                // Target a reasonable thumbnail size (e.g., 720p max for performance)
                const scale = Math.min(1, 1280 / video.videoWidth);
                canvas.width = video.videoWidth * scale;
                canvas.height = video.videoHeight * scale;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                cleanup();
                resolve(dataUrl);
            } catch (err) {
                cleanup();
                reject(err);
            }
        };

        video.onerror = (e) => {
            cleanup();
            reject(new Error(`Video load error: ${video.error ? video.error.message : 'Unknown error'}`));
        };
    });
};
