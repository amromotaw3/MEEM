/**
 * chat-media-renderer.js
 * Renders rich media share messages inside the chat interface.
 * Features realistic Open-CD / Vinyl sleeve presentation for music tracks.
 */

(function () {
  // Inject CD styling if not already present
  if (!document.getElementById('chat-media-renderer-styles')) {
    const style = document.createElement('style');
    style.id = 'chat-media-renderer-styles';
    style.textContent = `
      /* ── Open CD / Vinyl Music Card ── */
      .chat-cd-card {
        display: flex;
        align-items: center;
        gap: 14px;
        background: #0d0d12;
        border: 1px solid #1c1c24;
        border-radius: 12px;
        padding: 9px 12px 9px 9px;
        max-width: 320px;
        min-width: 250px;
        margin-top: 4px;
        cursor: pointer;
        transition: all 0.22s ease;
        position: relative;
        overflow: visible;
        user-select: none;
      }
      .chat-cd-card:hover {
        background: #13131a;
        border-color: #282834;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      }
      .cd-sleeve-wrapper {
        position: relative;
        width: 76px;
        height: 56px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }
      .cd-cover-jacket {
        position: absolute;
        left: 0;
        top: 0;
        width: 56px;
        height: 56px;
        border-radius: 6px;
        overflow: hidden;
        z-index: 2;
        box-shadow: 3px 0 10px rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: #141418;
      }
      .cd-cover-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .cd-jacket-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 45%, rgba(0,0,0,0.5) 100%);
        pointer-events: none;
      }
      .cd-vinyl-disc {
        position: absolute;
        left: 20px;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: radial-gradient(circle, #0e0e12 25%, #22222b 26%, #111116 35%, #262632 36%, #111116 48%, #2a2a38 49%, #111116 60%, #20202a 61%, #0d0d12 70%);
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), left 0.3s ease;
        border: 1px solid #202028;
      }
      .chat-cd-card:hover .cd-vinyl-disc {
        left: 24px;
        transform: rotate(35deg);
      }
      .cd-vinyl-center {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.6);
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
      }
      .cd-center-label {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
      }
      .cd-center-hole {
        position: absolute;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #000;
        border: 1px solid rgba(255, 255, 255, 0.4);
      }
      .cd-track-details {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        text-align: left;
      }
      .cd-track-title {
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }
      .cd-track-artist {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.55);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cd-track-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 5px;
      }
      .cd-play-btn {
        background: #ffffff;
        color: #000000;
        border: none;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 10.5px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: all 0.15s ease;
      }
      .cd-play-btn:hover {
        background: #e6e6e6;
        transform: scale(1.03);
      }
      .cd-add-btn {
        background: #181820;
        color: rgba(255, 255, 255, 0.75);
        border: 1px solid #282834;
        border-radius: 6px;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .cd-add-btn:hover {
        background: #262634;
        color: #ffffff;
        border-color: #404052;
      }
      .cd-duration-tag {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.4);
        margin-left: auto;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Render a chat message element, supporting media_share type
   */
  function render(message, onMediaClick) {
    const el = document.createElement('div');
    el.className = 'chat-message';
    if (message.id) el.dataset.messageId = message.id;

    if (message.type === 'media_share' || (message.content && typeof message.content === 'object' && message.content.type === 'media_share') || message.mediaType === 'music' || (message.content && message.content.mediaType === 'music')) {
      const data = message.type === 'media_share' ? message : (message.content && typeof message.content === 'object' ? message.content : message);
      const isMusic = data.mediaType === 'music' || data.type === 'music' || Boolean(data.artist);
      
      const posterSrc = data.posterUrl || data.poster_path || data.thumbnail || data.poster || '';
      let poster = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2290%22%3E%3Crect fill=%22%23222%22 width=%2260%22 height=%2290%22/%3E%3C/svg%3E';
      if (posterSrc) {
        if (isMusic || posterSrc.startsWith('http') || posterSrc.startsWith('data:') || posterSrc.startsWith('blob:')) {
          poster = posterSrc;
        } else if (typeof window.localImg === 'function') {
          poster = window.localImg(posterSrc);
        } else {
          poster = `https://image.tmdb.org/t/p/w185${posterSrc}`;
        }
      }

      if (isMusic) {
        const titleStr = data.title || data.name || 'Untitled Song';
        const artistStr = data.artist || 'Unknown Artist';
        const trackId = data.id || data.mediaId || '';
        const durationStr = data.durationFormatted || '';

        el.innerHTML = `
          <div class="chat-cd-card" data-track-id="${escapeHtml(trackId)}">
            <div class="cd-sleeve-wrapper">
              <div class="cd-cover-jacket">
                <img class="cd-cover-img" src="${poster}" alt="" onerror="this.src='imgs/appicon.png'" />
                <div class="cd-jacket-overlay"></div>
              </div>
              <div class="cd-vinyl-disc">
                <div class="cd-vinyl-center">
                  <img class="cd-center-label" src="${poster}" alt="" onerror="this.src='imgs/appicon.png'" />
                  <div class="cd-center-hole"></div>
                </div>
              </div>
            </div>
            <div class="cd-track-details">
              <div class="cd-track-title" title="${escapeHtml(titleStr)}">${escapeHtml(titleStr)}</div>
              <div class="cd-track-artist" title="${escapeHtml(artistStr)}">${escapeHtml(artistStr)}</div>
              <div class="cd-track-actions">
                <button class="cd-play-btn" title="Play Song">
                  <i class="fas fa-play" style="font-size: 8px;"></i>
                  <span>Play</span>
                </button>
                <button class="cd-add-btn" title="Add to Playlist">
                  <i class="fas fa-plus"></i>
                </button>
                ${durationStr ? `<span class="cd-duration-tag">${escapeHtml(durationStr)}</span>` : ''}
              </div>
            </div>
          </div>
        `;

        el.querySelector('.chat-cd-card')?.addEventListener('click', (e) => {
          if (e.target.closest('.cd-add-btn')) {
            e.stopPropagation();
            if (window.MeemAudioPlayer && typeof window.MeemAudioPlayer.openAddToPlaylistModal === 'function') {
              window.MeemAudioPlayer.openAddToPlaylistModal(data);
            }
            return;
          }
          if (onMediaClick) {
            onMediaClick(data);
          } else if (window.MeemAudioPlayer) {
            window.MeemAudioPlayer.playTrack(data);
          }
        });
      } else {
        const titleStr = data.title || data.name || 'Unknown Media';
        const mediaTypeStr = data.mediaType === 'series' || data.mediaType === 'tv' ? 'Series' : 'Movie';
        const dateStr = (data.releaseDate || data.release_date || '').substring(0, 4);

        el.innerHTML = `
          <div class="media-share-card" data-media-id="${escapeHtml(data.mediaId || data.id || '')}" data-media-type="${escapeHtml(data.mediaType || data.media_type || '')}" style="display: flex; gap: 12px; background: #0d0d12; border: 1px solid #1c1c24; padding: 8px; border-radius: 12px; cursor: pointer; transition: all 0.2s; align-items: center; max-width: 280px; margin-top: 4px;">
            <div class="media-share-poster-wrapper" style="width: 50px; height: 75px; flex-shrink: 0; border-radius: 8px; overflow: hidden;">
              <img class="media-share-poster" src="${poster}" style="width: 100%; height: 100%; object-fit: cover;" alt="" onerror="if(this.src.includes('/poster/large/')) { this.src=this.src.replace('/poster/large/', '/poster/medium/'); } else { this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2275%22%3E%3Crect fill=%22%23222%22 width=%2250%22 height=%2275%22/%3E%3C/svg%3E'; }" />
            </div>
            <div style="flex: 1; min-width: 0; text-align: left;">
              <div style="font-weight: 700; font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(titleStr)}</div>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; text-transform: capitalize; font-size: 9px; font-weight: 700; color: #ffffff;">${escapeHtml(mediaTypeStr)}</span>
                ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
              </div>
              <div style="font-size: 10px; color: #ffffff; font-weight: 700; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
                <i class="fas fa-play" style="font-size: 8px;"></i> Click to Open
              </div>
            </div>
          </div>
        `;

        el.querySelector('.media-share-card')?.addEventListener('click', () => {
          if (onMediaClick) onMediaClick(data);
        });
      }
    } else {
      // Normal text bubble fallback
      const text = typeof message.content === 'string' ? message.content : (message.content !== undefined ? JSON.stringify(message.content) : (message.message_text || ''));
      el.innerHTML = `<div class="message-text-bubble">${escapeHtml(text)}</div>`;
    }

    return el;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.ChatMediaRenderer = { render };
})();
