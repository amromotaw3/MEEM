/**
 * chat-slash-commands.js
 * Discord-style slash command implementation for rich media sharing in chat.
 */

(function () {
  const state = {
    active: false,
    results: [],
    index: -1,
    timer: null,
    query: '',
    inputEl: null,
    menuEl: null
  };

  /**
   * Initialize slash commands on the specified chat input
   */
  function init(inputEl, searchFn, onSelect) {
    if (!inputEl) return;
    
    // Clean up previous instance if any
    cleanup();

    state.inputEl = inputEl;
    state.menuEl = document.createElement('div');
    state.menuEl.className = 'slash-command-autocomplete';
    state.menuEl.style.display = 'none';
    document.body.appendChild(state.menuEl);

    // Event listeners
    inputEl.addEventListener('input', handleInput);
    inputEl.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleOutsideClick);

    function handleInput(e) {
      const val = e.target.value;
      
      // Trigger autocomplete if input starts with '/'
      if (val.startsWith('/')) {
        const query = val.slice(1).trim();
        state.query = query;
        state.active = true;

        if (query.length > 0) {
          debounceSearch(query, searchFn);
        } else {
          // Show instructions / empty state when user just typed '/'
          showInstructions();
        }
      } else {
        hide();
      }
    }

    function handleKeyDown(e) {
      if (!state.active) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.index = (state.index + 1) % (state.results.length || 1);
        highlightItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.index = (state.index - 1 + (state.results.length || 1)) % (state.results.length || 1);
        highlightItem();
      } else if (e.key === 'Enter') {
        if (state.index >= 0 && state.index < state.results.length) {
          e.preventDefault();
          selectItem(state.results[state.index]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    }

    function handleOutsideClick(e) {
      if (state.menuEl && !state.menuEl.contains(e.target) && e.target !== inputEl) {
        hide();
      }
    }

    function debounceSearch(query, searchFn) {
      clearTimeout(state.timer);
      console.log('[SlashCommands] Debouncing search for query:', query);
      state.timer = setTimeout(async () => {
        try {
          console.log('[SlashCommands] Calling searchFn with query:', query);
          const results = await searchFn(query);
          console.log('[SlashCommands] Search results returned:', results);
          state.results = results || [];
          state.index = state.results.length > 0 ? 0 : -1;
          render();
        } catch (err) {
          console.error('[SlashCommands] Search failed:', err);
        }
      }, 250);
    }

    function showInstructions() {
      state.results = [];
      state.index = -1;
      state.menuEl.innerHTML = `
        <div class="slash-cmd-instruction">
          <span class="slash-cmd-highlight">/&lt;title&gt;</span> Type movie or series title to share in chat
        </div>
      `;
      positionMenu();
      state.menuEl.style.display = 'block';
    }

    function render() {
      if (!state.results.length) {
        state.menuEl.innerHTML = '<div class="slash-cmd-no-results">No media results found</div>';
        positionMenu();
        return;
      }

      state.menuEl.innerHTML = state.results.map((item, idx) => {
        const title = item.title || item.name || 'Untitled';
        const year = item.release_date || item.first_air_date ? (item.release_date || item.first_air_date).substring(0, 4) : '';
        const posterSrc = item.posterUrl || item.poster || item.poster_path || '';
        let poster = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2260%22%3E%3Crect fill=%22%23222%22 width=%2240%22 height=%2260%22/%3E%3C/svg%3E';
        if (posterSrc) {
          if (typeof window.localImg === 'function') {
            poster = window.localImg(posterSrc);
          } else if (posterSrc.startsWith('http') || posterSrc.startsWith('data:') || posterSrc.startsWith('blob:')) {
            poster = posterSrc;
          } else {
            poster = `https://image.tmdb.org/t/p/w92${posterSrc}`;
          }
        }
        return `
          <div class="slash-cmd-item ${idx === state.index ? 'selected' : ''}" data-index="${idx}">
            <img class="slash-cmd-item-poster" src="${poster}" alt="" onerror="if(this.src.includes('/poster/large/')) { this.src=this.src.replace('/poster/large/', '/poster/medium/'); } else { this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2260%22%3E%3Crect fill=%22%23222%22 width=%2240%22 height=%2260%22/%3E%3C/svg%3E'; }" />
            <div class="slash-cmd-item-info">
              <div class="slash-cmd-item-title">${escapeHtml(title)}</div>
              <div class="slash-cmd-item-meta">${item.media_type === 'tv' || item.type === 'tv' || item.type === 'series' ? 'Series' : 'Movie'} ${year ? `• ${year}` : ''}</div>
            </div>
          </div>
        `;
      }).join('');

      // Click to select handlers
      state.menuEl.querySelectorAll('.slash-cmd-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.getAttribute('data-index'), 10);
          selectItem(state.results[idx]);
        });
      });

      positionMenu();
    }

    function highlightItem() {
      state.menuEl.querySelectorAll('.slash-cmd-item').forEach((el, idx) => {
        el.classList.toggle('selected', idx === state.index);
      });
    }

    function selectItem(item) {
      if (onSelect) onSelect(item);
      hide();
    }

    function positionMenu() {
      const rect = inputEl.getBoundingClientRect();
      state.menuEl.style.position = 'fixed';
      state.menuEl.style.left = rect.left + 'px';
      state.menuEl.style.width = rect.width + 'px';
      
      const menuHeight = state.menuEl.offsetHeight || 200;
      // Position above input
      state.menuEl.style.top = (rect.top - menuHeight - 8) + 'px';
      state.menuEl.style.bottom = 'auto';
    }

    function hide() {
      state.active = false;
      if (state.menuEl) state.menuEl.style.display = 'none';
      clearTimeout(state.timer);
    }

    function cleanup() {
      if (state.inputEl) {
        state.inputEl.removeEventListener('input', handleInput);
        state.inputEl.removeEventListener('keydown', handleKeyDown);
      }
      document.removeEventListener('click', handleOutsideClick);
      if (state.menuEl && state.menuEl.parentNode) {
        state.menuEl.parentNode.removeChild(state.menuEl);
      }
      state.active = false;
      state.results = [];
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.ChatSlashCommands = { init };
  window.initSlashCommands = init;
})();
