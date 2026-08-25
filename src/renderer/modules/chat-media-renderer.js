/**
 * chat-media-renderer.js
 * Renders rich media share messages inside the chat interface.
 */

(function () {
  /**
   * Render a chat message element, supporting media_share type
   */
  function render(message, onMediaClick) {
    const el = document.createElement('div');
    el.className = 'chat-message';
    if (message.id) el.dataset.messageId = message.id;

    if (message.type === 'media_share' || (message.content && typeof message.content === 'object' && message.content.type === 'media_share')) {
      const data = message.type === 'media_share' ? message : message.content;
      
      const posterSrc = data.posterUrl || data.poster_path || '';
      let poster = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2290%22%3E%3Crect fill=%22%23222%22 width=%2260%22 height=%2290%22/%3E%3C/svg%3E';
      if (posterSrc) {
        if (typeof window.localImg === 'function') {
          poster = window.localImg(posterSrc);
        } else if (posterSrc.startsWith('http') || posterSrc.startsWith('data:') || posterSrc.startsWith('blob:')) {
          poster = posterSrc;
        } else {
          poster = `https://image.tmdb.org/t/p/w185${posterSrc}`;
        }
      }

      el.innerHTML = `
        <div class="media-share-card" data-media-id="${data.mediaId || data.id}" data-media-type="${data.mediaType || data.media_type}" style="display: flex; gap: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); padding: 8px; border-radius: 12px; cursor: pointer; transition: all 0.2s; align-items: center; max-width: 280px; margin-top: 6px;">
          <div class="media-share-poster-wrapper" style="width: 50px; height: 75px; flex-shrink: 0; border-radius: 8px; overflow: hidden;">
            <img class="media-share-poster" src="${poster}" style="width: 100%; height: 100%; object-fit: cover;" alt="" onerror="if(this.src.includes('/poster/large/')) { this.src=this.src.replace('/poster/large/', '/poster/medium/'); } else { this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2275%22%3E%3Crect fill=%22%23222%22 width=%2250%22 height=%2275%22/%3E%3C/svg%3E'; }" />
          </div>
          <div style="flex: 1; min-width: 0; text-align: left;">
            <div style="font-weight: 700; font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(data.title || 'Unknown Media')}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; display: flex; align-items: center; gap: 6px;">
              <span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; text-transform: capitalize; font-size: 9px; font-weight: 700; color: var(--accent);">${data.mediaType === 'series' || data.mediaType === 'tv' ? 'Series' : 'Movie'}</span>
              ${data.releaseDate || data.release_date ? `<span>${(data.releaseDate || data.release_date).substring(0,4)}</span>` : ''}
            </div>
            <div style="font-size: 10px; color: #00adb5; font-weight: 700; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
              <i class="fas fa-play" style="font-size: 8px;"></i> Click to Open
            </div>
          </div>
        </div>
      `;

      el.querySelector('.media-share-card').addEventListener('click', () => {
        if (onMediaClick) onMediaClick(data);
      });
    } else {
      // Normal text bubble fallback
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      el.innerHTML = `<div class="message-text-bubble">${escapeHtml(text)}</div>`;
    }

    return el;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.ChatMediaRenderer = { render };
})();
