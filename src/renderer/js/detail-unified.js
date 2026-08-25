/* ── Unified Cinematic Detail & Data Orchestrator (V4 - Mobile Polish) ── */

/* ── Image Resolution Strategy ── */
/* ── Image Resolution Strategy ── */
window.getTMDBImageUrl = (path, isHighRes = false) => {
    if (!path) return 'imgs/no-backdrop.png';
    let url = String(path).trim();
    url = url.replace(/\\/g, '/');
    url = url.replace(/\/+(img|background\.jpg|poster\.jpg|poster\.png)(:\d+)?$/i, '');
    url = url.replace(/^(img|poster)(:\d+)?$/i, '');
    url = url.replace(/^\/+(img|poster)(:\d+)?$/i, '');
    if (!url || url.length < 3 || url === 'img' || url === 'poster') return 'imgs/no-backdrop.png';

    if (url.startsWith('http') || url.startsWith('local-file') || url.startsWith('media-img')) {
        if (url.includes('.metahub.space')) {
            url = url.replace(/(live|episodes)\.metahub\.space/, 'images.metahub.space');
            if (isHighRes) {
                url = url.replace(/\/background\/medium\//, '/background/large/');
            }
        } else if (url.includes('image.tmdb.org/t/p/')) {
            url = url.replace(/\/t\/p\/[^\/]+/, '/t/p/' + (isHighRes ? 'original' : 'w500'));
        }
        return (typeof window.localImg === 'function') ? window.localImg(url) : url;
    }
    
    // Check if it's a local bare filename (e.g. dHQy... or avatar_...)
    const hasSeparators = url.includes('/') || url.includes('\\');
    if (!hasSeparators && !url.startsWith('tt') && !url.startsWith('/tt')) {
        return (typeof window.localImg === 'function') ? window.localImg(url) : url;
    }
    
    const isTmdbPath = url.startsWith('/') || url.endsWith('.jpg') || url.endsWith('.png');
    const isImdbId = url.startsWith('tt') || url.startsWith('/tt');

    if (isTmdbPath && !isImdbId) {
        const cleanPath = url.startsWith('/') ? url : '/' + url;
        const size = isHighRes ? 'original' : 'w500';
        const fullUrl = `https://image.tmdb.org/t/p/${size}${cleanPath}`;
        return (typeof window.localImg === 'function') ? window.localImg(fullUrl) : fullUrl;
    }

    const imdbId = url.replace(/^\//, '').replace(/\/(img|background\.jpg)$/, '');
    const type = isHighRes ? 'background/medium' : 'poster/medium';
    const fullUrl = `https://images.metahub.space/${type}/${imdbId}/img`;
    return (typeof window.localImg === 'function') ? window.localImg(fullUrl) : fullUrl;
};


window.checkIfTV = (item, tmdb = null, extra1 = null) => {
    if (!item) return false;
    // Anime sources are now routed through Cinemeta/TMDB — do NOT treat them as a special Kitsu branch.
    // const isKitsu = false; // Disabled: anime bypass

    const type = (item.type || item.media_type || '').toLowerCase();
    if (type === 'tv' || type === 'series' || type === 'show' || type === 'anime') return true;

    if (tmdb) {
        const tmdbType = (tmdb.type || tmdb.media_type || '').toLowerCase();
        if (tmdbType === 'tv' || tmdbType === 'series' || tmdbType === 'show') return true;
        if (tmdb.episodes || tmdb.seasons) return true;
    }

    if (extra1) {
        const extraType = (extra1.type || '').toLowerCase();
        if (extraType === 'tv' || extraType === 'series' || extraType === 'show') return true;
    }

    if (item.episodes && item.episodes.length > 0) return true;

    return false;
};

window.getKitsuImageUrl = (imageObj, isHighRes = false) => {
    if (!imageObj) return 'imgs/no-backdrop.png';
    if (typeof imageObj === 'string') {
        if (imageObj.startsWith('http') || imageObj.startsWith('local-file')) return imageObj;
        return imageObj;
    }
    // Prioritize original/large for all modes to ensure clarity
    return imageObj.original || imageObj.large || imageObj.medium || 'imgs/no-backdrop.png';
};

// Simple Dice coefficient based string similarity (bigrams)
function stringSimilarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    b = b.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    if (a === b) return 1;
    const bigrams = (s) => {
        const out = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const g = s.substring(i, i + 2);
            out.set(g, (out.get(g) || 0) + 1);
        }
        return out;
    };
    const A = bigrams(a);
    const B = bigrams(b);
    let intersect = 0;
    for (const [g, count] of A.entries()) {
        if (B.has(g)) intersect += Math.min(count, B.get(g));
    }
    const total = Array.from(A.values()).reduce((s, v) => s + v, 0) + Array.from(B.values()).reduce((s, v) => s + v, 0);
    if (total === 0) return 0;
    return (2.0 * intersect) / total;
}

window.renderUnifiedDetail = async function(item) {
    const { switchView } = window;
    const container = document.getElementById('view-discover-detail');
    if (!container) return false;

    // Ensure the container is visible (in case it was hidden by a previous close)
    container.style.display = 'flex';

    // 1. Initial UI Setup (Skeleton)
    setupUnifiedSkeleton(container, item);
    // Mark cinematic/detail mode on body for CSS control
    document.body.classList.add('cinematic');
    container.classList.add('active');
    
    // Hide mobile dock while cinematic detail is open
    const mobileDock = document.getElementById('mobile-dock');
    if (mobileDock) {
        mobileDock.style.display = 'none';
        mobileDock.classList.remove('active');
    }
    if (typeof switchView === 'function') switchView('discover-detail');

    // 1.5 Show Premium Loader
    showUnifiedLoader();

    try {
        // 2. Intelligence: Detect content type and IDs
        // Force all anime through Cinemeta/TMDB — isAnime and isKitsu are always false.
        const isAnime = false;
        const isKitsu = false;
        const isTV = window.checkIfTV(item);
        let cinemetaId = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null) || item.id;
        
        let isLocalPath = cinemetaId && (cinemetaId.toString().includes('\\') || cinemetaId.toString().includes('/') || (cinemetaId.toString().includes(':') && !cinemetaId.toString().startsWith('tmdb:')));
        if (isLocalPath) {
            const cached = window.appData?.cinemetaCache?.[cinemetaId] || window.appData?.tmdbCache?.[cinemetaId];
            if (cached) {
                cinemetaId = cached.cinemetaId || cached.tmdbId || null;
            } else {
                cinemetaId = null;
            }
        }

        let mediaType = item.media_type || item.type || (item.title ? 'movie' : 'tv');
        // Normalize 'anime' type to 'tv' so Cinemeta treats it correctly
        if (mediaType === 'anime') mediaType = 'tv';

        // RESOLVE NUMERIC TMDB ID TO IMDB ID FOR WESTERN CONTENT
        // Handles both bare numeric IDs ("12345") and prefixed IDs ("tmdb:12345")
        const tmdbKey = window.appData?.tmdbKey;
        let numericTmdbId = null;
        if (cinemetaId) {
            const idStr = String(cinemetaId);
            if (/^\d+$/.test(idStr)) {
                numericTmdbId = idStr;
            } else if (idStr.startsWith('tmdb:')) {
                numericTmdbId = idStr.replace('tmdb:', '');
                cinemetaId = numericTmdbId; // strip prefix for API calls
            }
        }
        if (numericTmdbId && tmdbKey) {
            console.log(`[UnifiedDetail] Numeric TMDB ID detected: ${numericTmdbId}. Resolving to IMDb ID...`);
            const tmdbUrl = mediaType === 'tv' 
                ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/external_ids?api_key=${tmdbKey}`
                : `https://api.themoviedb.org/3/movie/${numericTmdbId}?api_key=${tmdbKey}`;
            
            try {
                const tmdbRes = await fetch(tmdbUrl).then(r => r.json());
                const resolvedImdbId = tmdbRes.imdb_id;
                if (resolvedImdbId) {
                    console.log(`[UnifiedDetail] Resolved TMDB ID ${numericTmdbId} → IMDb ${resolvedImdbId}`);
                    cinemetaId = resolvedImdbId;
                    item.imdbId = resolvedImdbId;
                    item.imdb_id = resolvedImdbId;
                } else {
                    console.warn(`[UnifiedDetail] TMDB API did not return an IMDb ID for ${numericTmdbId}`);
                }
            } catch (err) {
                console.error(`[UnifiedDetail] Failed to resolve TMDB ID to IMDb ID:`, err.message);
            }
        } else if (numericTmdbId && !tmdbKey) {
            // No TMDB key — try via ElfHosted TMDB addon (no key required)
            try {
                const type2 = mediaType === 'tv' ? 'series' : 'movie';
                const elfRes = await fetch(`https://tmdb.elfhosted.com/meta/${type2}/${numericTmdbId}.json`, { signal: AbortSignal.timeout(6000) }).then(r => r.json());
                const resolvedImdbId = elfRes?.meta?.imdb_id || elfRes?.meta?.imdbId;
                if (resolvedImdbId) {
                    console.log(`[UnifiedDetail] Resolved via ElfHosted: TMDB ${numericTmdbId} → IMDb ${resolvedImdbId}`);
                    cinemetaId = resolvedImdbId;
                    item.imdbId = resolvedImdbId;
                    item.imdb_id = resolvedImdbId;
                }
            } catch (err) {
                console.warn(`[UnifiedDetail] ElfHosted fallback failed for ${numericTmdbId}:`, err.message);
            }
        }

        const isLocalLib = item.isLocal || (item.path && !/^https?:\/\//i.test(item.path) && !/^magnet:/i.test(item.path));

        if (false) {
            // Disabled: Kitsu/anime branch — all anime now go through Cinemeta/TMDB
            cinemetaId = null;
        } else if (isLocalLib && !cinemetaId) {
            await populateUnifiedUI(item, null, null, null);
            const playBtn = document.getElementById('dd-play-btn-top');
            if (playBtn) {
                if (isTV) {
                    playBtn.innerHTML = '<i class="fas fa-list-ol"></i> Show Episodes';
                    playBtn.onclick = window.openEpisodes;
                } else {
                    playBtn.innerHTML = '<i class="fas fa-play"></i> Play';
                    playBtn.onclick = () => {
                        if (typeof window.playLocalItem === 'function') window.playLocalItem(item);
                    };
                }
            }
            return true;
        }

        // 3. Parallel fetching: Western Media (Cinemeta + Fanart) OR Anime (Jikan + Fanart via AniList mapping)
        let unifiedResponse = null;
        let cinemeta = null;
        let extra1 = null;
        let anilist = null;
        let fanartImages = null;

        if (isAnime) {
            if (!malId && item.source === 'kitsu' && item.id) {
                extra1 = await window.api.invoke('kitsu-details', item.id).catch(() => null);
                malId = extra1?.mal_id || extra1?.malId || null;
            }

            unifiedResponse = malId ? await window.api.malDetails(Number(malId)).catch(() => null) : null;
            if (unifiedResponse) {
                cinemeta = {
                    ...unifiedResponse,
                    backdrop_path: unifiedResponse.backdrops?.[0],
                    poster_path: unifiedResponse.posters?.primary,
                    logos: unifiedResponse.clearlogos?.map(url => ({ url, file_path: url })),
                    vote_average: unifiedResponse.rating,
                    release_date: unifiedResponse.year,
                    overview: unifiedResponse.synopsis,
                    genre: unifiedResponse.genres,
                    genres: unifiedResponse.genres
                };
                fanartImages = {
                    backgrounds: unifiedResponse.backdrops?.map(url => ({ url })),
                    logos: unifiedResponse.clearlogos?.map(url => ({ url }))
                };
            }

            if (!cinemeta && extra1) {
                cinemeta = extra1;
            }

            if (!fanartImages?.backgrounds?.length && extra1 && (extra1.tvdb_id || extra1.tmdb_id) && window.api?.fanartGetImages) {
                const directFanart = await window.api.fanartGetImages(extra1.tvdb_id || extra1.tmdb_id, extra1.tvdb_id ? 'tv' : 'movie').catch(() => null);
                if (directFanart) {
                    fanartImages = {
                        backgrounds: (directFanart.showbackground || directFanart.tvbackground || directFanart.moviebackground || []).map(x => ({ url: x.url })),
                        logos: (directFanart.hdtvlogo || directFanart.clearlogo || directFanart.hdmovielogo || directFanart.movielogo || []).map(x => ({ url: x.url }))
                    };
                    cinemeta = {
                        ...(cinemeta || extra1 || item),
                        backdrop_path: fanartImages.backgrounds?.[0]?.url || cinemeta?.backdrop_path || extra1?.backdrop_path,
                        logos: fanartImages.logos || cinemeta?.logos || []
                    };
                }
            }

            anilist = await window.api.invoke('anilist-media-detailed', { title: item.title_english || item.title || item.name }).catch(() => null);
        } else {
            // Western Media: Cinemeta metadata + Fanart.tv enhancement
            [cinemeta, fanartImages] = await Promise.all([
                cinemetaId ? window.api.invoke('cinemeta-details', { id: cinemetaId, type: mediaType }).catch(() => null) : Promise.resolve(null),
                (cinemetaId && window.api && window.api.fanartGetImages) ? window.api.fanartGetImages(cinemetaId, mediaType).catch(() => null) : Promise.resolve(null)
            ]);
        }

        let resolvedCinemeta = cinemeta?.meta || cinemeta;
        
        // Cache for UI refresh
        window._lastTmdbData = resolvedCinemeta;
        window._lastImageData = resolvedCinemeta;
        window._lastExtraData = extra1;

        // 4. Update UI
        await populateUnifiedUI(item, resolvedCinemeta, fanartImages || resolvedCinemeta, extra1, anilist);
        
        // Trigger background trailer playback asynchronously
        resolveTrailerYoutubeUrl(item, resolvedCinemeta, extra1).then(ytUrl => {
            if (ytUrl) {
                window.currentTrailerYoutubeUrl = ytUrl;
                const trailerActions = document.getElementById('dd-trailer-actions');
                const youtubeBtn = document.getElementById('dd-youtube-btn');
                if (trailerActions) trailerActions.style.display = 'flex';
                if (youtubeBtn) youtubeBtn.style.display = 'inline-flex';

                playBackgroundTrailer(ytUrl);
            }
        });

        // Episodes/streams are loaded on-demand when clicking Play/Watch
        return true;
    } catch (err) {
        console.error('[UNIFIED] Error rendering detail:', err);
        return false;
    } finally {
        setTimeout(() => hideUnifiedLoader(), 200);
    }
};

// Unified close helper used by back handlers and bridge
window.closeUnifiedDetail = function(skipSwitch = false) {
    const container = document.getElementById('view-discover-detail');
    if (!container) return;
    try {
        if (typeof window.stopBackgroundTrailer === 'function') window.stopBackgroundTrailer();
        container.classList.remove('active');
        container.classList.remove('cinematic-mode');
        container.style.display = 'none';
        container.innerHTML = '';
        container.style.cssText = '';
        document.body.classList.remove('cinematic');
        // reset any focused state
        window.currentDetailItem = null;
        // ensure mobile dock and other UI restore
        const mobileDock = document.getElementById('mobile-dock');
        if (mobileDock) {
            mobileDock.style.display = ''; // Restore default
            mobileDock.classList.add('active');
        }
        if (!skipSwitch && typeof window.switchView === 'function') window.switchView(window.prevView || 'discover');
        window.scrollTo(0, 0);
    } catch (e) {
        console.warn('[DETAIL] closeUnifiedDetail failed', e);
    }
};

function showUnifiedLoader() {
    const container = document.getElementById('view-discover-detail');
    if (!container) return;
    let loader = document.getElementById('dd-unified-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'dd-unified-loader';
        loader.innerHTML = `
            <div class="dd-loader-content">
                <div class="dd-loader-spinner-premium"></div>
                <p style="font-size: 0.95rem; font-weight: 600; color: rgba(255,255,255,0.8); letter-spacing: 0.5px; text-transform: none;">Usually this doesn't take long...</p>
            </div>
        `;
        container.appendChild(loader);
    }
    loader.classList.add('active');
}

function hideUnifiedLoader() {
    const loader = document.getElementById('dd-unified-loader');
    if (loader) {
        loader.classList.remove('active');
        // We keep it in DOM for next use, just hide it
    }
}

function setupUnifiedSkeleton(container, item) {
    const { escapeHTML } = window;
    container.classList.add('cinematic-mode');
    container.scrollTop = 0;

    const sanitizeBackdropPath = (path) => {
        if (!path) return null;
        let value = String(path).trim();
        value = value.replace(/\\/g, '/');
        value = value.replace(/\/+(img|background\.jpg|poster\.jpg|poster\.png)(:\d+)?$/i, '');
        value = value.replace(/^(img|poster)(:\d+)?$/i, '');
        value = value.replace(/^\/+(img|poster)(:\d+)?$/i, '');
        return value || null;
    };

    const bPath = sanitizeBackdropPath(item.backdrop_path || item.backdrop || item.background || item.cover || item.poster || item.poster_path);
    const lowResBackdrop = sanitizeBackdropPath(item.thumb || item.thumbnail || item.poster || item.poster_path) || 'imgs/no-backdrop.png';
    const defaultBackdrop = item.source === 'kitsu' || item.source === 'jikan' || item.source === 'mal'
        ? (item.attributes?.coverImage ? window.getKitsuImageUrl(item.attributes.coverImage, true) : null)
        : (bPath ? window.getTMDBImageUrl(bPath, true) : null);

    const backdropUrl = defaultBackdrop || (bPath && (bPath.startsWith('http') || bPath.startsWith('local-file')) ? bPath : null) || lowResBackdrop || 'imgs/no-backdrop.png';

    const isKitsu = item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || !!item.anime_id || !!item.mal_id || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));
    const isTV = window.checkIfTV(item);
    const isTmdbActive = window.appData?.tmdbKey && window.appData?.tmdbEnabled !== false;
    const isLocalTV = isTV && item.episodes && item.episodes.length > 0;
    const showTmdbNotice = isLocalTV && !isTmdbActive;

    container.innerHTML = `
        <div class="dd-container">
            <button class="dd-exit-fullscreen-btn" id="dd-exit-fullscreen-btn" type="button" style="display: none;">
                <i class="fas fa-eye"></i> Show UI
            </button>
            <div class="dd-backdrop-wrap">
                <img src="${lowResBackdrop}" data-hi-res="${backdropUrl}" id="dd-backdrop-img" class="dd-backdrop-img dd-backdrop-loading">
                <div class="dd-backdrop-overlay"></div>
            </div>

            <!-- PC Side Panel (Episodes/Streams) -->
            <div class="dd-side-panel" id="dd-side-panel">
                <div class="dd-panel-header">
                    <h3 id="dd-panel-title">Episodes</h3>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn-streams-about" onclick="window.showStreamsAboutModal()" style="background: rgba(0, 173, 181, 0.12); border: 1px solid rgba(0, 173, 181, 0.35); color: #00adb5; padding: 6px 12px; border-radius: 12px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s;" title="How Streams & Addons Work">
                            <i class="fas fa-info-circle"></i> About
                        </button>
                        <button class="dd-panel-close" onclick="document.getElementById('dd-side-panel').classList.remove('active')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="dd-panel-content" id="dd-panel-content"></div>
            </div>

            <!-- Mobile Full-screen Panel -->
            <div class="dd-mobile-panel" id="dd-mobile-panel">
                <div class="dd-mobile-panel-header">
                    <button class="dd-mobile-panel-back" onclick="document.getElementById('dd-mobile-panel').classList.remove('active')">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <h3 id="dd-mobile-panel-title">Episodes</h3>
                    <button class="btn-streams-about" onclick="window.showStreamsAboutModal()" style="background: rgba(0, 173, 181, 0.12); border: 1px solid rgba(0, 173, 181, 0.35); color: #00adb5; padding: 6px 12px; border-radius: 12px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;" title="How Streams & Addons Work">
                        <i class="fas fa-info-circle"></i> About
                    </button>
                </div>
                <div class="dd-mobile-panel-content" id="dd-mobile-panel-content"></div>
            </div>

            <div class="dd-content-body">
                <div class="dd-main-info">
                    <div class="dd-header-area">
                        <img id="dd-logo" class="dd-logo" style="display:none; opacity:0;">
                        <h1 id="dd-title" class="dd-title-text" style="display:block; opacity:1;">${escapeHTML(item.title || item.name)}</h1>
                    </div>

                    <div id="dd-meta" class="dd-meta-row-premium">
                        <span class="dd-tag" id="dd-rating">★ ${item.vote_average ? (parseFloat(item.vote_average) || 0).toFixed(1) : '0.0'}</span>
                        <span class="dd-tag" id="dd-year">${(item.release_date || item.first_air_date || '').slice(0, 4) || '----'}</span>
                        <span class="imdb-tag" id="dd-imdb-badge">IMDb</span>
                    </div>

                    <div id="dd-extra-info" class="dd-pills-container"></div>

                    <div class="dd-summary-section">
                        <h4 class="dd-section-label">SUMMARY</h4>
                        <p id="dd-overview" class="dd-overview-text">${escapeHTML(item.overview || 'Loading details...')}</p>
                    </div>

                    ${showTmdbNotice ? `
                    <div class="tmdb-notice-banner" style="margin: 0 0 25px 0; padding: 18px 24px; background: #000000; border: 1.5px solid rgba(255, 255, 255, 0.45); border-radius: 16px; display: flex; align-items: center; justify-content: space-between; gap: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.95), 0 0 25px rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); max-width: 750px; transition: all 0.3s ease; flex-wrap: wrap;">
                        <div style="display: flex; gap: 15px; align-items: center; flex: 1; min-width: 280px;">
                            <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.08); border: 1.5px solid rgba(255, 255, 255, 0.7); display: flex; align-items: center; justify-content: center; color: #ffffff; box-shadow: 0 0 20px rgba(255, 255, 255, 0.15); flex-shrink: 0;">
                                <i class="fas fa-magic" style="font-size: 18px; color: #ffffff;"></i>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 3px; text-align: left;">
                                <div style="font-size: 14px; font-weight: 800; color: #ffffff; letter-spacing: 0.3px;">Enhance Your TV Show Experience</div>
                                <div style="font-size: 12.5px; color: rgba(255, 255, 255, 0.75); line-height: 1.5; font-weight: 500;">
                                    Missing those episode posters? We can fix that! Simply add your TMDB API key in Settings, and we'll handle the rest.
                                </div>
                            </div>
                        </div>
                        <button class="btn-primary" style="background: #ffffff; border: none; color: #000000; padding: 10px 22px; font-size: 12px; font-weight: 800; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.3s ease; box-shadow: 0 4px 20px rgba(255, 255, 255, 0.3); white-space: nowrap;" onclick="if(typeof window.closeUnifiedDetail === 'function') window.closeUnifiedDetail(); if(typeof window.switchView === 'function') window.switchView('settings');" onmouseover="this.style.background='#f4f4f5'; this.style.transform='translateY(-2px)';" onmouseout="this.style.background='#ffffff'; this.style.transform='none';">
                            <i class="fas fa-cog" style="color: #000000;"></i> <span style="color: #000000; font-weight: 800;">GO TO SETTINGS</span>
                        </button>
                    </div>
                    ` : ''}

                    <!-- Trailer Actions -->
                    <div class="dd-trailer-actions" id="dd-trailer-actions" style="display: none; flex-direction: row; gap: 10px; margin-bottom: 15px;">
                        <button class="dd-btn-main glass-premium dd-btn-square" id="dd-youtube-btn" type="button" title="Watch Trailer" style="display: none;"><i class="fab fa-youtube" style="color: #ff3333; font-size: 1.2rem;"></i></button>
                        <button class="dd-btn-main glass-premium dd-btn-square" id="dd-audio-btn" type="button" title="Toggle Sound" style="display: none;"><i class="fas fa-volume-mute" style="font-size: 1.1rem;"></i></button>
                        <button class="dd-btn-main glass-premium dd-btn-square" id="dd-fullscreen-btn" type="button" title="Hide Overlays" style="display: none;"><i class="fas fa-eye-slash" style="font-size: 1.1rem;"></i></button>
                    </div>

                    <div class="dd-bottom-actions">
                        <button class="dd-btn-main primary-premium" id="dd-play-btn-top" onclick="window.openEpisodes()">${isTV ? '<i class="fas fa-list-ol"></i> Show Episodes' : '<i class="fas fa-play-circle" style="font-size: 0.95rem;"></i> Watch Now'}</button>
                        <div class="dd-list-dropdown">
                            <button class="dd-btn-main primary-premium" id="btn-main-list" type="button"><i class="fas fa-plus-circle" style="font-size: 0.95rem;"></i> My List</button>
                            <div class="dd-dropdown-menu" id="dd-list-menu">
                                <div class="dd-menu-inner">
                                <div class="dd-menu-title">Select action</div>
                                <button class="dd-dropdown-item" id="dd-menu-add-list" type="button"><i class="fas fa-plus"></i> My List</button>
                                <button class="dd-dropdown-item" id="dd-menu-mark-watched" type="button"><i class="fas fa-eye"></i> Mark Watched</button>
                                <div id="dd-custom-lists-container"></div>
                                <div class="dd-menu-separator" style="border-top: 1px solid rgba(255,255,255,0.06); margin: 5px 0;"></div>
                                <div id="dd-create-list-section" style="padding: 6px 12px; display: flex; flex-direction: column; gap: 8px;">
                                    <button class="dd-dropdown-item" id="btn-show-create-list-input" type="button" style="padding: 0; height: auto; background: none; border: none; font-size: 13px; color: var(--accent); font-weight: 700; text-align: left; display: flex; align-items: center; gap: 8px;">
                                        <i class="fas fa-plus-circle"></i> Create New List
                                    </button>
                                    <div id="dd-create-list-input-container" style="display: none; align-items: center; gap: 6px; width: 100%;">
                                        <input type="text" id="new-list-name-input" placeholder="List name..." style="flex: 1; min-width: 0; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; padding: 6px 10px; font-size: 12px; font-weight: 600; outline: none;">
                                        <button id="btn-submit-new-list" type="button" style="background: linear-gradient(135deg, #00adb5 0%, #00f2fe 100%); border: none; color: #fff; padding: 6px 12px; font-size: 11px; font-weight: 800; border-radius: 8px; cursor: pointer; transition: all 0.2s;">Create</button>
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                        <button class="dd-btn-main primary-premium" id="dd-go-back-btn" type="button"><i class="fas fa-chevron-left"></i> Go Back</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    window.getTmdbIdStr = (i) => {
        if (!i) return null;
        let tid = i.tmdbId || i.tmdb_id;
        if (i.id && String(i.id).startsWith('tmdb:')) tid = String(i.id).replace('tmdb:', '');
        if (i.id && String(i.id).startsWith('kitsu:')) tid = null;
        return tid ? String(tid) : null;
    };

    const getTmdbIdStr = window.getTmdbIdStr;

    const toggleItemInCustomList = (listId, targetItem) => {
        const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData.activeProfileId);
        if (!profile) return;
        
        const list = profile.custom_lists?.find(l => l.id === listId);
        if (!list) return;

        list.items = list.items || [];
        const index = list.items.findIndex(i => {
            if (String(i.id) === String(targetItem.id)) return true;
            const tA = getTmdbIdStr(i);
            const tB = getTmdbIdStr(targetItem);
            return tA && tB && tA === tB;
        });

        if (index === -1) {
            const toAdd = {
                id: targetItem.id,
                title: targetItem.title || targetItem.name || '',
                type: targetItem.type || '',
                poster: targetItem.poster || targetItem.poster_path || '',
                backdrop: targetItem.backdrop || targetItem.backdrop_path || '',
                release_date: targetItem.release_date || targetItem.first_air_date || '',
                vote_average: targetItem.vote_average || 0,
                overview: targetItem.overview || ''
            };
            list.items.push(toAdd);
            showToast(`Added to "${list.name}"`);
        } else {
            list.items.splice(index, 1);
            showToast(`Removed from "${list.name}"`);
        }

        window.persist(true);
        updateWatchlistUI();
        if (typeof window.renderLibCustomLists === 'function') window.renderLibCustomLists();
        if (window.currentView === 'custom-list-detail') window.renderCustomListDetail(listId);
    };
    
    // Export to global scope so onclick handlers can access it
    window.toggleItemInCustomList = toggleItemInCustomList;

    const createNewCustomList = (name, itemToAdd = null) => {
        if (typeof window.createNewCustomList === 'function') {
            window.createNewCustomList(name, itemToAdd);
            updateWatchlistUI();
        }
    };

    const updateWatchlistUI = () => {
        const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData.activeProfileId);
        
        // Check Watchlist state
        const isWatchlist = profile?.watchlist?.some(w => {
            if (String(w.id) === String(item.id)) return true;
            const wT = getTmdbIdStr(w);
            const iT = getTmdbIdStr(item);
            return (wT && iT && wT === iT);
        });
        const watchlistMenuBtn = document.getElementById('dd-menu-add-list');
        if (watchlistMenuBtn) {
            watchlistMenuBtn.innerHTML = `<i class="fas fa-${isWatchlist ? 'check' : 'plus'}"></i> ${isWatchlist ? 'In My List' : 'My List'}`;
            watchlistMenuBtn.classList.toggle('active-option', isWatchlist);
        }

        // Check Watched state
        const key = window.getPlaybackKey ? window.getPlaybackKey(item) : (item.id || item.path);
        const isWatched = profile?.playback && profile.playback[key]?.watched;
        const watchedMenuBtn = document.getElementById('dd-menu-mark-watched');
        if (watchedMenuBtn) {
            watchedMenuBtn.innerHTML = `<i class="fas fa-${isWatched ? 'eye-slash' : 'eye'}"></i> ${isWatched ? 'Watched' : 'Mark Watched'}`;
            watchedMenuBtn.classList.toggle('active-option', !!isWatched);
        }

        // Check custom lists state
        const customLists = profile?.custom_lists || [];
        const activeCustomLists = customLists.filter(list =>
            list.items?.some(i => {
                if (String(i.id) === String(item.id)) return true;
                const tA = getTmdbIdStr(i);
                const tB = getTmdbIdStr(item);
                return tA && tB && tA === tB;
            })
        );
        const isInCustomList = activeCustomLists.length > 0;

        const listToggleBtn = document.getElementById('btn-main-list');
        if (listToggleBtn) {
            let listLabel = 'My List';
            let listIcon = 'plus-circle';
            const isAnyActive = isWatched || isWatchlist || isInCustomList;
            
            if (isWatched) {
                listLabel = 'Watched';
                listIcon = 'eye';
            } else if (isWatchlist && isInCustomList) {
                listLabel = `In My List (${activeCustomLists.length + 1})`;
                listIcon = 'check-circle';
            } else if (isWatchlist) {
                listLabel = 'In My List';
                listIcon = 'check-circle';
            } else if (isInCustomList) {
                listLabel = activeCustomLists.length === 1 ? `In ${activeCustomLists[0].name}` : 'In Collections';
                listIcon = 'check-circle';
            }
            
            listToggleBtn.innerHTML = `<i class="fas fa-${listIcon}" style="font-size: 0.95rem;"></i> ${listLabel}`;
            listToggleBtn.classList.toggle('in-library', isAnyActive);
        }

        // Render custom lists section
        const customListsContainer = document.getElementById('dd-custom-lists-container');
        if (customListsContainer && profile) {
            customListsContainer.innerHTML = '';
            const customLists = profile.custom_lists || [];

            if (customLists.length > 0) {
                const titleDiv = document.createElement('div');
                titleDiv.className = 'dd-menu-subtitle';
                titleDiv.style.cssText = 'padding: 6px 12px; font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 5px;';
                titleDiv.textContent = 'Collections';
                customListsContainer.appendChild(titleDiv);

                customLists.forEach(list => {
                    const inList = list.items?.some(i => {
                        if (String(i.id) === String(item.id)) return true;
                        const tA = getTmdbIdStr(i);
                        const tB = getTmdbIdStr(item);
                        return tA && tB && tA === tB;
                    });

                    const btn = document.createElement('button');
                    btn.className = 'dd-dropdown-item custom-list-item-toggle';
                    if (inList) btn.classList.add('active-option');
                    btn.type = 'button';
                    btn.innerHTML = `<i class="fas fa-${inList ? 'check-square' : 'square'}"></i> ${escapeHTML(list.name)}`;
                    
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        toggleItemInCustomList(list.id, item);
                    };

                    customListsContainer.appendChild(btn);
                });
            }
        }
    };
    updateWatchlistUI();

    const listToggleBtn = document.getElementById('btn-main-list');
    const listMenu = document.getElementById('dd-list-menu');
    const watchlistMenuBtn = document.getElementById('dd-menu-add-list');
    const watchedMenuBtn = document.getElementById('dd-menu-mark-watched');
    const goBackBtn = document.getElementById('dd-go-back-btn');

    if (listToggleBtn) {
        listToggleBtn.onclick = (e) => {
            e.stopPropagation();
            window.openListsPanel();
        };
    }

    if (watchlistMenuBtn) {
        watchlistMenuBtn.onclick = () => {
            window.toggleUnifiedLibrary(item);
            listMenu?.classList.remove('active');
        };
    }

    if (watchedMenuBtn) {
        watchedMenuBtn.onclick = () => {
            window.toggleUnifiedWatched(item);
            listMenu?.classList.remove('active');
        };
    }

    if (goBackBtn) {
        goBackBtn.onclick = () => {
            if (typeof window.closeUnifiedDetail === 'function') window.closeUnifiedDetail();
        };
    }

    // Hook up "Create New List" handlers
    const showInputBtn = document.getElementById('btn-show-create-list-input');
    const inputContainer = document.getElementById('dd-create-list-input-container');
    const nameInput = document.getElementById('new-list-name-input');
    const submitBtn = document.getElementById('btn-submit-new-list');

    if (showInputBtn && inputContainer) {
        // Stop mousedown from bubbling to prevent dropdown close handler from firing
        inputContainer.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
        if (nameInput) {
            nameInput.setAttribute('tabindex', '0');
            nameInput.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
            nameInput.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
            nameInput.addEventListener('focus', () => { nameInput.style.borderColor = 'rgba(0,173,181,0.8)'; });
            nameInput.addEventListener('blur', () => { nameInput.style.borderColor = 'rgba(255,255,255,0.1)'; });
        }

        showInputBtn.onclick = (e) => {
            e.stopPropagation();
            showInputBtn.style.display = 'none';
            inputContainer.style.display = 'flex';
            // Use requestAnimationFrame to ensure element is visible before focusing
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try { nameInput?.focus(); } catch(err) {}
                });
            });
        };
    }

    if (submitBtn && nameInput) {
        // Block ALL keyboard events from propagating out of this input field
        nameInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (e.key === 'Enter') {
                const listName = nameInput.value.trim();
                if (listName) {
                    createNewCustomList(listName, item);
                    nameInput.value = '';
                    inputContainer.style.display = 'none';
                    showInputBtn.style.display = 'flex';
                }
            } else if (e.key === 'Escape') {
                nameInput.value = '';
                inputContainer.style.display = 'none';
                showInputBtn.style.display = 'flex';
            }
        }, true); // capture=true to intercept before global handlers

        nameInput.addEventListener('keyup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
        nameInput.addEventListener('keypress', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);

        submitBtn.onclick = (e) => {
            e.stopPropagation();
            const listName = nameInput.value.trim();
            if (listName) {
                createNewCustomList(listName, item);
                nameInput.value = '';
                inputContainer.style.display = 'none';
                showInputBtn.style.display = 'flex';
            }
        };
    }

    if (!window._ddUnifiedListMenuCloseHandler) {
        window._ddUnifiedListMenuCloseHandler = (event) => {
            document.querySelectorAll('.dd-list-dropdown .dd-dropdown-menu.active').forEach(menu => {
                const wrapper = menu.closest('.dd-list-dropdown');
                if (wrapper && !wrapper.contains(event.target)) {
                    menu.classList.remove('active');
                }
            });
        };
        document.addEventListener('click', window._ddUnifiedListMenuCloseHandler);
    }


    const loadUnifiedBackdrop = () => {
        const img = document.getElementById('dd-backdrop-img');
        if (!img) return;

        const hiRes = img.dataset.hiRes;
        if (!hiRes || img.src === hiRes) {
            img.classList.remove('dd-backdrop-loading');
            return;
        }

        const loader = new Image();
        loader.src = hiRes;
        loader.onload = () => {
            img.src = hiRes;
            img.classList.remove('dd-backdrop-loading');
        };
        loader.onerror = () => {
            img.classList.remove('dd-backdrop-loading');
            img.src = 'imgs/no-backdrop.png';
        };
    };
    loadUnifiedBackdrop();

    // Hook up trailer control event listeners
    const youtubeBtn = document.getElementById('dd-youtube-btn');
    const audioBtn = document.getElementById('dd-audio-btn');
    const fullscreenBtn = document.getElementById('dd-fullscreen-btn');
    const exitFullscreenBtn = document.getElementById('dd-exit-fullscreen-btn');

    if (youtubeBtn) {
        youtubeBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.currentTrailerYoutubeUrl) {
                window.api.openExternal(window.currentTrailerYoutubeUrl);
            }
        };
    }

    if (audioBtn) {
        audioBtn.onclick = (e) => {
            e.stopPropagation();
            const video = document.getElementById('dd-backdrop-video');
            if (video) {
                video.muted = !video.muted;
                const isMuted = video.muted;
                audioBtn.innerHTML = `<i class="fas fa-${isMuted ? 'volume-mute' : 'volume-up'}" style="font-size: 1.1rem;"></i>`;
                
                if (trailerTimeout) {
                    clearTimeout(trailerTimeout);
                    trailerTimeout = null;
                }
            }
        };
    }

    if (fullscreenBtn) {
        fullscreenBtn.onclick = (e) => {
            e.stopPropagation();
            const detailContainer = document.getElementById('view-discover-detail');
            if (detailContainer) {
                detailContainer.classList.add('trailer-fullscreen-mode');
                
                const video = document.getElementById('dd-backdrop-video');
                if (video) {
                    video.style.opacity = '1.0';
                    if (video.muted) {
                        video.muted = false;
                        if (audioBtn) {
                            audioBtn.innerHTML = `<i class="fas fa-volume-up" style="font-size: 1.1rem;"></i>`;
                        }
                    }
                }
                
                if (trailerTimeout) {
                    clearTimeout(trailerTimeout);
                    trailerTimeout = null;
                }
            }
        };
    }

    if (exitFullscreenBtn) {
        exitFullscreenBtn.onclick = (e) => {
            e.stopPropagation();
            const detailContainer = document.getElementById('view-discover-detail');
            if (detailContainer) {
                detailContainer.classList.remove('trailer-fullscreen-mode');
                const video = document.getElementById('dd-backdrop-video');
                if (video) {
                    video.style.opacity = '0.7';
                }
            }
        };
    }

    const detailContainer = document.getElementById('view-discover-detail');
    if (detailContainer) {
        detailContainer.onclick = (e) => {
            if (detailContainer.classList.contains('trailer-fullscreen-mode')) {
                // Ignore clicks on the exit button or trailer actions
                if (e.target.closest('#dd-exit-fullscreen-btn') || e.target.closest('#dd-trailer-actions')) return;
                
                detailContainer.classList.remove('trailer-fullscreen-mode');
                const video = document.getElementById('dd-backdrop-video');
                if (video) {
                    video.style.opacity = '0.7';
                }
            }
        };
    }

    // Refresh UI helper
    window.updateUnifiedWatchlistUI = updateWatchlistUI;
}


// --- Fix metadata modal & button ---
function createFixMetadataModal() {
    if (document.getElementById('fix-meta-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'fix-meta-modal';
    modal.style = `position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:99999;`;
    modal.innerHTML = `
        <div style="width:90%;max-width:720px;background:#111;color:#fff;border-radius:8px;padding:16px;box-shadow:0 8px 24px rgba(0,0,0,0.6);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong id="fix-meta-title">Fix Metadata</strong>
                <button id="fix-meta-close" style="background:transparent;border:0;color:#fff;font-size:18px;">✕</button>
            </div>
            <div id="fix-meta-list" style="max-height:50vh;overflow:auto;margin-bottom:8px;"></div>
            <div style="text-align:right;"><button id="fix-meta-cancel" style="padding:8px 12px;margin-right:8px;">Cancel</button></div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('fix-meta-close').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('fix-meta-cancel').onclick = () => { modal.style.display = 'none'; };
}

function showFixMetadataFor(item) {
    createFixMetadataModal();
    const modal = document.getElementById('fix-meta-modal');
    const list = document.getElementById('fix-meta-list');
    list.innerHTML = '<div style="padding:12px">Loading candidates…</div>';
    modal.style.display = 'flex';
    const query = item.title || item.name || item.original_title || item.slug || '';
    window.api.kitsuSearch(query).then(results => {
        list.innerHTML = '';
        if (!results || results.length === 0) {
            list.innerHTML = '<div style="padding:12px">No candidates found.</div>';
            return;
        }
        results.forEach(r => {
            const row = document.createElement('div');
            row.style = 'display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid rgba(255,255,255,0.04);';
            const left = document.createElement('div');
            const thumb = r.poster_path || r.poster || r.backdrop_path || r.backdrop || '';
            const thumbHtml = thumb ? `<img src="${thumb}" alt="${escapeHtml(r.title || r.name || '')}" style="width:56px;height:80px;object-fit:cover;border-radius:6px;margin-right:8px;vertical-align:middle">` : '';
            left.innerHTML = `${thumbHtml}<div style="display:inline-block;vertical-align:middle"><div style="font-weight:600">${escapeHtml(r.title || r.canonicalTitle || r.name)}</div><div style="font-size:12px;color:#bbb">Kitsu:${r.id || ''} ${r._hasStremio? ' • Stremio': ''} ${r.tmdb_id? ' • TMDB:' + r.tmdb_id : ''}</div></div>`;
            const right = document.createElement('div');
            const selectBtn = document.createElement('button');
            selectBtn.textContent = 'Select';
            selectBtn.style = 'padding:6px 10px;';
            selectBtn.onclick = async () => {
                // persist manual mapping
                const payload = { kitsuId: item.id || r.id, tmdbId: r.tmdb_id || null, tmdbType: (r.tmdb_id? 'movie' : null), note: `chosen:${r.title || r.canonicalTitle || r.name}` };
                const res = await window.api.invoke('save-manual-link', payload);
                if (res && res.success) {
                    showToast('Manual link saved');
                    modal.style.display = 'none';
                    // refresh UI
                    populateUnifiedUI(item);
                } else {
                    showToast('Failed to save manual link');
                }
            };
            right.appendChild(selectBtn);
            row.appendChild(left);
            row.appendChild(right);
            list.appendChild(row);
        });
    }).catch(err => {
        list.innerHTML = `<div style="padding:12px;color:#f88">Error: ${escapeHtml(String(err.message || err))}</div>`;
    });
}

function ensureFixMetadataButton(item) {
    const actions = document.querySelector('.dd-action-row') || document.querySelector('#detail-actions');
    if (!actions) return;
    let btn = document.getElementById('btn-fix-metadata');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btn-fix-metadata';
        btn.style = 'margin-left:8px;padding:6px 10px;';
        btn.textContent = 'Fix metadata';
        actions.appendChild(btn);
        btn.addEventListener('click', () => showFixMetadataFor(window.currentDetailItem || {}));
    }
    // show only when missing TMDB id
    const shouldShow = !(item && (item.tmdb_id || item.external_ids && (item.external_ids.tmdb || item.external_ids.imdb)));
    btn.style.display = shouldShow ? 'inline-block' : 'none';
}

function populateUnifiedUI(item, tmdb, images, extra1, anilist) {
    return new Promise((resolve) => {
        const { escapeHTML } = window;
        const isKitsu = item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || !!item.anime_id || !!item.mal_id || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));
        
        // Show IMDb badge for all media including anime
        const imdbBadge = document.getElementById('dd-imdb-badge');
        if (imdbBadge) {
            imdbBadge.style.display = 'inline-block';
        }
        
        // Critical assets tracking
        const assetsToLoad = [];
        const trackAsset = (src) => {
            if (!src) return;
            const p = new Promise((res) => {
                const img = new Image();
                img.onload = res;
                img.onerror = res; // resolve anyway on error to avoid hanging
                img.src = src;
            });
            assetsToLoad.push(p);
        };
        
        // Safety timeout: wait up to 15s for logos and assets to load before hiding the loader
        const timeout = setTimeout(resolve, 15000);

        let lowSrc = null;
        let highSrc = null;

        const kitsuBackdrop = item.backdrop_path || item.backdrop || extra1?.attributes?.coverImage || extra1?.backdrop_path || item.poster;
        
        // Preferred strategy for Anime: TMDB (IMDb matched) > AniList > Kitsu
        const alBackdrop = anilist?.bannerImage;
        const alPoster = anilist?.coverImage?.extraLarge || anilist?.coverImage?.large;

        const bPath = tmdb?.backdrop_path || (isKitsu && alBackdrop ? alBackdrop : kitsuBackdrop);
        const logoImg = document.getElementById('dd-logo');
        const titleText = document.getElementById('dd-title');
        const bdImg = document.getElementById('dd-backdrop') || document.getElementById('dd-backdrop-img');

        if (bdImg) {
            // Progressive backdrop loading: show a low-res quickly, then swap to high-res once ready
            try {
            if (tmdb?.backdrop_path || tmdb?.background) {
                const bd = tmdb.backdrop_path || tmdb.background;
                lowSrc = window.getTMDBImageUrl(bd, false);
                highSrc = window.getTMDBImageUrl(bd, true);
            } else if (item.backdrop_path || item.backdrop) {
                const bd = item.backdrop_path || item.backdrop;
                if (/^https?:\/\//i.test(bd)) {
                    lowSrc = highSrc = bd;
                } else {
                    lowSrc = window.getTMDBImageUrl(bd, false);
                    highSrc = window.getTMDBImageUrl(bd, true);
                }
            } else if (window.appData?.tmdbCache?.[item.id]?.backdrop_path || window.appData?.tmdbCache?.[item.id]?.backdropPath || window.appData?.tmdbCache?.[item.id]?.backdrop) {
                const cache = window.appData.tmdbCache[item.id];
                const bd = cache.backdrop_path || cache.backdropPath || cache.backdrop;
                if (/^https?:\/\//i.test(bd)) {
                    lowSrc = highSrc = bd;
                } else {
                    lowSrc = window.getTMDBImageUrl(bd, false);
                    highSrc = window.getTMDBImageUrl(bd, true);
                }
            } else if (isKitsu && alBackdrop) {
                lowSrc = alBackdrop;
                highSrc = alBackdrop;
            } else if (extra1?.isStremio) {
                const bg = extra1.backdrop_path || extra1.poster_path;
                lowSrc = window.getTMDBImageUrl(bg, false);
                highSrc = window.getTMDBImageUrl(bg, true);
            } else if (extra1?.attributes?.coverImage) {
                lowSrc = window.getKitsuImageUrl(extra1.attributes.coverImage, false);
                highSrc = window.getKitsuImageUrl(extra1.attributes.coverImage, true);
            } else if (bPath) {
                lowSrc = window.getTMDBImageUrl(bPath, false);
                highSrc = window.getTMDBImageUrl(bPath, true);
            } else if (item.isLocal || (item.path && !/^https?:\/\//i.test(item.path))) {
                const banners = window.appData?.banners || {};
                const banner = banners[item.id];
                if (banner && typeof window.localImg === 'function') {
                    lowSrc = highSrc = window.localImg(banner);
                }
            } else if (extra1?.background) {
                lowSrc = window.getTMDBImageUrl(extra1.background, false);
                highSrc = window.getTMDBImageUrl(extra1.background, true);
            }

            // Fanart override for background
            if (images && images.backgrounds && images.backgrounds.length > 0) {
                const bestBg = images.backgrounds[0];
                highSrc = bestBg.url;
                lowSrc = bestBg.url.replace('/fanart/', '/preview/'); // usually there's a preview or we just use original
            }

            if (lowSrc) {
                bdImg.src = lowSrc;
                // Only apply blur if we have a high-res alternative coming
                if (highSrc && highSrc !== lowSrc) {
                    bdImg.style.transition = bdImg.style.transition || 'filter .45s ease, transform .45s ease, opacity .35s ease';
                    bdImg.style.filter = 'blur(6px)';
                    bdImg.style.transform = 'scale(1.02)';

                    const high = new Image();
                    high.onload = () => {
                        bdImg.src = highSrc;
                        bdImg.style.filter = '';
                        bdImg.style.transform = '';
                    };
                    high.src = highSrc;
                } else {
                    // No high-res alternative or same URL, ensure no blur
                    bdImg.style.filter = '';
                    bdImg.style.transform = '';
                }
            } else {
                bdImg.src = 'imgs/no-backdrop.png';
                bdImg.style.filter = '';
            }
        } catch (e) {
            // Fallback: set whatever we have
            bdImg.style.filter = '';
            if (bPath) bdImg.src = window.getTMDBImageUrl(bPath, true);
            else if (extra1?.isStremio) bdImg.src = window.getTMDBImageUrl(extra1.backdrop_path || extra1.poster_path, true);
            else if (extra1?.attributes?.coverImage) bdImg.src = window.getKitsuImageUrl(extra1.attributes.coverImage, true);
            else if (extra1?.background) bdImg.src = window.getTMDBImageUrl(extra1.background, true);
        }
    }

    const hasLogo = (extra1?.logo) || (images?.logos?.length > 0) || tmdb?.logo;

    // Default state: Hide BOTH until we know what to show
    if (logoImg) {
        logoImg.style.display = 'none';
        logoImg.style.opacity = '0';
        logoImg.src = '';
    }
    if (titleText) {
        titleText.style.display = 'none';
        titleText.style.opacity = '0';
    }



    const showTitleFallback = () => {
        if (titleText) {
            titleText.style.display = 'block';
            titleText.style.opacity = '1';
        }
        if (logoImg) logoImg.style.display = 'none';
    };

    const showLogo = (src) => {
        if (!logoImg) return;
        const resolvedSrc = (typeof window.localImg === 'function') ? window.localImg(src) : src;
        const logoPromise = new Promise((res) => {
            logoImg.onload = () => {
                logoImg.style.display = 'block';
                logoImg.style.opacity = '1';
                if (titleText) {
                    titleText.style.display = 'none';
                    titleText.style.opacity = '0';
                }
                res();
            };
            logoImg.onerror = () => {
                logoImg.style.display = 'none';
                if (titleText) { 
                    titleText.style.display = 'block'; 
                    titleText.style.opacity = '1'; 
                }
                res();
            };
        });
        logoImg.src = resolvedSrc;
        assetsToLoad.push(logoPromise);
    };

    let logoUrl = null;
    if (extra1?.logo) {
        logoUrl = extra1.logo;
    } else if (tmdb?.logo) {
        logoUrl = tmdb.logo;
    } else if (images) {
        if (Array.isArray(images.logos) && images.logos.length > 0) {
            const logo = images.logos.find(l => l.iso_639_1 === 'en') || images.logos.find(l => !l.iso_639_1) || images.logos[0];
            logoUrl = logo.url || (logo.file_path ? window.getTMDBImageUrl(logo.file_path, true) : null);
        } else if (Array.isArray(images.clearlogos) && images.clearlogos.length > 0) {
            const logo = images.clearlogos[0];
            logoUrl = typeof logo === 'string' ? logo : (logo.url || logo.file_path);
        } else {
            const rawLogos = images.hdtvlogo || images.clearlogo || images.hdmovielogo || images.movielogo;
            if (Array.isArray(rawLogos) && rawLogos.length > 0) {
                logoUrl = rawLogos[0].url;
            }
        }
    }

    if (!logoUrl && tmdb && Array.isArray(tmdb.clearlogos) && tmdb.clearlogos.length > 0) {
        logoUrl = tmdb.clearlogos[0];
    }

    if (logoUrl && logoImg) {
        showLogo(logoUrl);
    } else {
        showTitleFallback();
    }

    // Backdrop tracking
    if (highSrc) trackAsset(highSrc);
    else if (lowSrc) trackAsset(lowSrc);

    // Finalize after assets or timeout
    Promise.all(assetsToLoad).then(() => {
        clearTimeout(timeout);
        resolve();
    });

    const metaContainer = document.getElementById('dd-meta');
    if (metaContainer) {
        const rating = (tmdb?.vote_average) || (tmdb?.rating) || (tmdb?.imdbRating) || (extra1?.imdbRating) || (extra1?.rating) || item.rating || item.vote_average || 0;
        const kitsuYear = String(extra1?.year || extra1?.releaseInfo || item.release_date || item.first_air_date || item.releaseYear || '').slice(0, 4);
        const year = (isKitsu && kitsuYear) ? kitsuYear : String(tmdb?.release_date || tmdb?.first_air_date || tmdb?.year || tmdb?.released || kitsuYear || '----').slice(0, 4);
        const runtime = tmdb?.runtime || (tmdb?.episode_run_time ? tmdb?.episode_run_time[0] : null) || extra1?.runtime;
        const parsedR = parseFloat(rating);
        document.getElementById('dd-rating').textContent = `★ ${(!isNaN(parsedR) && parsedR > 0) ? parsedR.toFixed(1) : '0.0'}`;
        
        if (isKitsu) {
            document.getElementById('dd-year').textContent = kitsuYear || '----';
        } else {
            const displayYear = tmdb?.first_air_date ? `${year}-${String(tmdb.last_air_date || '').slice(0,4)}` : (tmdb?.year || tmdb?.released || year || '----');
            document.getElementById('dd-year').textContent = displayYear;
        }
        if (runtime) {
            // Ensure we don't repeatedly prepend runtime tags on re-render
            Array.from(metaContainer.querySelectorAll('.dd-runtime-tag')).forEach(e => e.remove());
            const rtSpan = document.createElement('span');
            rtSpan.className = 'dd-tag dd-runtime-tag';
            const cleanRuntime = String(runtime).replace(/\s*mins?|min\s*/gi, '').trim();
            rtSpan.textContent = isKitsu ? `${cleanRuntime}` : `${cleanRuntime} min`;
            metaContainer.prepend(rtSpan);
        }
        
        // Resolve Age Rating
        const ageRating = tmdb?.certification || extra1?.certification || item.certification;

        // Hide yellow hardcoded IMDb badge
        const imdbBadge = document.getElementById('dd-imdb-badge');
        if (imdbBadge) imdbBadge.style.display = 'none';

        // Clear any previous badges
        Array.from(metaContainer.querySelectorAll('.dd-rating-tag-age')).forEach(e => e.remove());
        Array.from(metaContainer.querySelectorAll('.dd-id-tag')).forEach(e => e.remove());
        Array.from(metaContainer.querySelectorAll('.dd-meta-badges-column')).forEach(e => e.remove());

        // Render linked IDs (IMDb/TMDB) for transparency
        const tmdbCacheObj = window.appData?.tmdbCache?.[item.id] || {};
        const cinemetaCacheObj = window.appData?.cinemetaCache?.[item.id] || {};
        let resolvedImdb = item.imdb_id || item.imdbId || tmdbCacheObj.imdb_id || tmdbCacheObj.imdbId || cinemetaCacheObj.imdb_id || cinemetaCacheObj.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
        const resolvedTmdb = item.tmdbId || item.tmdb_id || tmdbCacheObj.tmdbId || tmdbCacheObj.tmdb_id || (/^\d+$/.test(String(item.id)) ? item.id : null);

        // Create the vertical badges column
        const badgesCol = document.createElement('div');
        badgesCol.className = 'dd-meta-badges-column';
        badgesCol.style.cssText = `
            display: inline-flex;
            flex-direction: column;
            gap: 4px;
            align-items: flex-start;
            margin-left: 10px;
        `;

        const createMetaBadge = (text, isUnrated = false, isImdb = false) => {
            const span = document.createElement('span');
            span.className = 'dd-pill dd-id-tag';
            span.textContent = text;
            span.style.cssText = `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 2px 10px;
                border-radius: 20px;
                border: 1px solid ${isImdb ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.08)'};
                color: ${isImdb ? '#f59e0b' : (isUnrated ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.85)')};
                background: ${isImdb ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)'};
                font-size: 10px;
                font-weight: 700;
                white-space: nowrap;
                letter-spacing: 0.5px;
                line-height: 1;
                height: 18px;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
            `;
            return span;
        };

        // 1. Add Age Rating badge (top row)
        const cleanAgeRating = (ageRating || 'NR').trim().toUpperCase();
        const isUnrated = cleanAgeRating === 'NR' || cleanAgeRating === 'NOT RATED' || cleanAgeRating === 'UNRATED';
        const ageLabel = isUnrated ? 'NR' : cleanAgeRating;
        
        badgesCol.appendChild(createMetaBadge(ageLabel, isUnrated));

        // 2. Add ID badge (bottom row)
        if (resolvedImdb) {
            item.imdb_id = resolvedImdb;
            item.imdbId = resolvedImdb;
            badgesCol.appendChild(createMetaBadge(`IMDb: ${resolvedImdb}`, false, true));
        } else if (resolvedTmdb) {
            badgesCol.appendChild(createMetaBadge(`TMDB ${resolvedTmdb}`));
        } else if (isKitsu) {
            const kitsuId = item.kitsuId || (String(item.id).startsWith('kitsu:') ? String(item.id).replace('kitsu:', '') : null);
            if (kitsuId) {
                fetch(`https://kitsu.io/api/edge/anime/${kitsuId}/mappings?page[limit]=20`)
                    .then(r => r.json())
                    .then(json => {
                        const imdbMap = json?.data?.find(m => m.attributes?.externalSite === 'imdb');
                        if (imdbMap && imdbMap.attributes?.externalId) {
                            const imdbId = imdbMap.attributes.externalId;
                            item.imdb_id = imdbId;
                            item.imdbId = imdbId;
                            badgesCol.appendChild(createMetaBadge(`IMDb: ${imdbId}`, false, true));
                        }
                    }).catch(() => null);
            }
        }

        metaContainer.appendChild(badgesCol);
    }

    const extraInfo = document.getElementById('dd-extra-info');
    if (extraInfo) {
        extraInfo.innerHTML = '';
        const allGenres = extractAllGenres(item, tmdb, extra1, anilist);
        if (allGenres.length > 0) {
            extraInfo.appendChild(createPillGroup('GENRES', allGenres));
        }
    }

    const overview = document.getElementById('dd-overview');
    if (overview) {
        const kitsuOverview = extra1?.description || extra1?.overview || (item.attributes?.synopsis) || item.overview || item.synopsis;
        const resolvedOverview = tmdb?.overview || tmdb?.description || tmdb?.synopsis || kitsuOverview || 'No overview available.';
        const fullText = (isKitsu && anilist?.description) ? anilist.description.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, "") : resolvedOverview;
        
        overview.textContent = fullText;

        const summarySec = overview.closest('.dd-summary-section');
        if (summarySec) {
            const oldBtn = summarySec.querySelector('.dd-read-more-btn');
            if (oldBtn) oldBtn.remove();

            overview.classList.remove('expanded');

        // Remove previous button
        const oldBtn2 = summarySec.querySelector('.dd-read-more-btn');
        if (oldBtn2) oldBtn2.remove();

        // Only show "Read More" button if text actually overflows the clamped box
        // We use a rAF to let the DOM settle after setting textContent
        requestAnimationFrame(() => {
          const isOverflowing = overview.scrollHeight > overview.clientHeight + 2;
          if (isOverflowing) {
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'dd-read-more-btn';
            toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Read More';
            toggleBtn.onclick = (e) => {
              e.stopPropagation();
              const isExpanded = overview.classList.toggle('expanded');
              toggleBtn.innerHTML = isExpanded
                ? '<i class="fas fa-chevron-up"></i> Read Less'
                : '<i class="fas fa-chevron-down"></i> Read More';
            };
            summarySec.appendChild(toggleBtn);
          }
        });

        }
    }

    if (typeof window.updateUnifiedWatchlistUI === 'function') {
        window.updateUnifiedWatchlistUI();
    }

    const isTV = window.checkIfTV(item, tmdb, extra1);
    // Enrich item with resolved metadata so it's available for player/sleep-mode
    window.currentDetailItem = { 
        ...item, 
        backdrop_path: (tmdb?.backdrop_path || tmdb?.background) ? window.getTMDBImageUrl(tmdb.backdrop_path || tmdb.background, true) : ((isKitsu && anilist?.bannerImage) ? anilist.bannerImage : (extra1?.backdrop_path || item.backdrop_path || item.backdrop || item.poster)),
        poster_path: (tmdb?.poster_path || tmdb?.poster) ? window.getTMDBImageUrl(tmdb.poster_path || tmdb.poster, true) : ((isKitsu && anilist?.coverImage?.extraLarge) ? anilist.coverImage.extraLarge : (extra1?.poster_path || item.poster_path || item.poster)),
        banner: (isKitsu && anilist?.bannerImage) ? anilist.bannerImage : (extra1?.banner || item.banner),
        genres: anilist?.genres || tmdb?.genres || extra1?.genres || item.genres,
        tmdbId: tmdb?.id || item.tmdbId || item.tmdb_id
    }; 
    const currentItem = window.currentDetailItem;

    // Cache: showId_season → Map<episodeNum, still_url>
    const _tmdbStillCache = {};

    // Fetch ALL episode stills for a season in one call, then apply to rendered cards
    const prefetchTmdbSeasonStills = async (showId, seasonN) => {
        const cacheKey = `${showId}_${seasonN}`;
        if (_tmdbStillCache[cacheKey]) return _tmdbStillCache[cacheKey]; // already fetched
        _tmdbStillCache[cacheKey] = {}; // mark as fetching (empty map prevents duplicate requests)
        try {
            const tmdbKey = window.appData?.tmdbKey;
            if (!tmdbKey || !showId) return {};
            // Resolve TMDB TV ID from IMDB ID if needed
            let tvId = null;
            if (String(showId).startsWith('tt')) {
                const res = await fetch(`https://api.themoviedb.org/3/find/${showId}?api_key=${tmdbKey}&external_source=imdb_id`).then(r => r.json()).catch(() => null);
                tvId = res?.tv_results?.[0]?.id;
            } else if (/^\d+$/.test(String(showId))) {
                tvId = showId;
            }
            if (!tvId) return {};
            const season = await fetch(`https://api.themoviedb.org/3/tv/${tvId}/season/${seasonN}?api_key=${tmdbKey}`).then(r => r.json()).catch(() => null);
            const map = {};
            (season?.episodes || []).forEach(ep => {
                if (ep.still_path) map[ep.episode_number] = `https://image.tmdb.org/t/p/w400${ep.still_path}`;
            });
            _tmdbStillCache[cacheKey] = map;
            return map;
        } catch (e) {
            return {};
        }
    };

    // Apply fetched stills to already-rendered episode cards
    const applyTmdbStillsToCards = (listEl, stillsMap, seasonN) => {
        if (!stillsMap || !Object.keys(stillsMap).length) return;
        const cards = listEl.querySelectorAll(`.dd-ep-card[data-season="${seasonN}"]`);
        cards.forEach(card => {
            const epN = parseInt(card.dataset.episode);
            const stillUrl = stillsMap[epN];
            if (!stillUrl) return;
            const img = card.querySelector('img');
            if (img && img.isConnected) {
                img.onerror = null;
                img.src = stillUrl;
            }
        });
    };


    const renderEpisodesInBatches = (listEl, episodes, seasonNum, isKitsu = false) => {
        if (!listEl) return;
        
        // Normalize and save the current episodes list so the player can access it for the sidebar and auto-next
        window.currentDetailEpisodes = (episodes || []).map(v => {
            const epNum = isKitsu ? v.episode : (v.episode_number !== undefined ? v.episode_number : v.episode);
            const epName = isKitsu ? (v.name || v.title) : v.name;
            const epThumb = isKitsu ? v.thumbnail : (v.still_path ? window.getTMDBImageUrl(v.still_path, false) : null);
            const currentSeason = v.season !== undefined ? v.season : (isKitsu ? (v.season || 1) : seasonNum);
            return {
                id: window.currentDetailItem?.id || v.showId || '',
                season: currentSeason,
                episode: epNum,
                title: epName || `Episode ${epNum}`,
                still_path: v.still_path || null,
                thumbnail: epThumb || '',
                path: v.path || ''
            };
        });

        listEl.innerHTML = '';
        const batchSize = 20;
        let currentIdx = 0;
        const renderId = Math.random();
        listEl.dataset.renderId = renderId;

        const renderBatch = () => {
            if (listEl.dataset.renderId !== String(renderId)) return;
            const batch = episodes.slice(currentIdx, currentIdx + batchSize);
            const fragment = document.createDocumentFragment();

            batch.forEach((v, i) => {
                const epNum = isKitsu ? v.episode : (v.episode_number !== undefined ? v.episode_number : v.episode);
                const epName = isKitsu ? (v.name || v.title) : v.name;
                const epDate = isKitsu ? v.released : v.air_date;
                const epThumb = isKitsu ? v.thumbnail : (v.still_path ? window.getTMDBImageUrl(v.still_path, false) : null);

                const isUnreleased = epDate && new Date(epDate) > new Date();
                const finalTitle = epName || ("Episode " + epNum);
                const thumbUrl = isUnreleased ? 'imgs/no-backdrop.png' : (epThumb || currentItem.backdrop_path || currentItem.poster_path || 'imgs/no-backdrop.png');
                const displayDate = epDate ? new Date(epDate).toLocaleDateString() : '';
                const currentSeason = v.season !== undefined ? v.season : (isKitsu ? (v.season || 1) : seasonNum);

                const card = document.createElement('div');
                card.className = 'dd-ep-card';
                card.dataset.season = currentSeason;
                card.dataset.episode = epNum;
                card.style.animationDelay = `${Math.min(i * 0.05, 1)}s`;
                card.onclick = () => window.selectUnifiedEpisode(currentSeason, epNum, finalTitle, epThumb || '', v.path || '');

                const imgEl = document.createElement('img');
                imgEl.src = thumbUrl;

                // Smart fallback: if image fails → try TMDB still → then backdrop
                const showId = window.currentDetailItem?.imdb_id || window.currentDetailItem?.imdbId ||
                               (String(window.currentDetailItem?.id || '').startsWith('tt') ? window.currentDetailItem.id : null) ||
                               window.currentDetailItem?.tmdb_id || window.currentDetailItem?.tmdbId;

                if (!isUnreleased) {
                    imgEl.onerror = () => {
                        imgEl.onerror = null;
                        imgEl.src = currentItem.backdrop_path || currentItem.poster_path || 'imgs/no-backdrop.png';
                    };
                } else {
                    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = 'imgs/no-backdrop.png'; };
                }

                const epImgDiv = document.createElement('div');
                epImgDiv.className = 'dd-ep-img';
                epImgDiv.appendChild(imgEl);

                const epNumDiv = document.createElement('div');
                epNumDiv.className = 'dd-ep-number';
                epNumDiv.textContent = `EP ${epNum}`;
                epImgDiv.appendChild(epNumDiv);

                if (isUnreleased) {
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#fff;letter-spacing:1px;';
                    overlay.textContent = 'UPCOMING';
                    epImgDiv.appendChild(overlay);
                }

                const infoDiv = document.createElement('div');
                infoDiv.className = 'dd-ep-info';
                infoDiv.innerHTML = `<div class="dd-ep-name">${(window.escapeHTML || (s=>s))(finalTitle)}</div><div class="dd-ep-date">${displayDate}</div>`;

                card.appendChild(epImgDiv);
                card.appendChild(infoDiv);
                fragment.appendChild(card);
            });

            listEl.appendChild(fragment);

            if (window.socialPresence && typeof window.socialPresence.renderEpisodePresence === 'function') {
                const showId = window.currentDetailItem?.id || currentItem?.id;
                if (showId) window.socialPresence.renderEpisodePresence(showId, '.dd-ep-card');
            }

            currentIdx += batchSize;
            if (currentIdx < episodes.length) {
                setTimeout(renderBatch, 16);
            } else {
                // All batches done → fetch stills from TMDB/Cinemeta (via Main Process or Key)
                const sid = window.currentDetailItem?.imdb_id || window.currentDetailItem?.imdbId ||
                    (String(window.currentDetailItem?.id || '').startsWith('tt') ? window.currentDetailItem.id : null) ||
                    window.currentDetailItem?.tmdb_id || window.currentDetailItem?.tmdbId;
                if (sid && !isKitsu) {
                    window.api.invoke('tmdb-season-details', sid, seasonNum).then(res => {
                        if (res && res.episodes && res.episodes.length > 0) {
                            const map = {};
                            res.episodes.forEach(ep => {
                                if (ep.still_path) {
                                    map[ep.episode_number] = ep.still_path;
                                }
                            });
                            applyTmdbStillsToCards(listEl, map, seasonNum);
                        }
                    }).catch(() => null);
                }
            }
        };

        renderBatch();
    };

    window.openListsPanel = async () => {
        const isMobile = window.innerWidth <= 768;
        const panel = document.getElementById(isMobile ? 'dd-mobile-panel' : 'dd-side-panel');
        const content = document.getElementById(isMobile ? 'dd-mobile-panel-content' : 'dd-panel-content');
        const title = document.getElementById(isMobile ? 'dd-mobile-panel-title' : 'dd-panel-title');
        
        if (!panel || !content || !title) return;

        panel.classList.add('active');
        title.textContent = 'Manage Lists';

        const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData.activeProfileId);
        if (!profile) {
            content.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">Please log in to manage lists.</div>';
            return;
        }

        // Render Create New List Input and the container for cards
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden;">
                <div style="padding: 15px; display: flex; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.01);">
                    <input type="text" id="panel-new-list-input" placeholder="Create new collection..." style="flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #fff; padding: 10px 14px; font-size: 13px; font-weight: 600; outline: none; transition: border-color 0.2s;">
                    <button id="panel-btn-create-list" style="background: linear-gradient(135deg, #00adb5 0%, #00f2fe 100%); border: none; color: #fff; padding: 10px 18px; font-size: 13px; font-weight: 800; border-radius: 10px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 15px rgba(0, 173, 181, 0.3);">Create</button>
                </div>
                <div id="panel-lists-scroll" style="display: flex; flex-direction: column; gap: 12px; padding: 15px; overflow-y: auto; flex: 1;"></div>
            </div>
        `;

        const listsContainer = document.getElementById('panel-lists-scroll');
        if (!listsContainer) return;

        // Custom stop propagation helper for input field inside the side panel
        const inputCreate = document.getElementById('panel-new-list-input');
        if (inputCreate) {
            inputCreate.addEventListener('mousedown', (e) => e.stopPropagation());
            inputCreate.addEventListener('click', (e) => e.stopPropagation());
        }

        const btnCreate = document.getElementById('panel-btn-create-list');
        if (btnCreate && inputCreate) {
            btnCreate.onclick = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                const name = inputCreate.value.trim();
                if (!name) return;
                createNewCustomList(name, item);
                inputCreate.value = '';
                setTimeout(() => {
                    window.openListsPanel();
                }, 50);
            };
            inputCreate.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    btnCreate.click();
                }
            };
        }

        // Toggles & list check functions
        let inWatchlist = false;
        try {
            inWatchlist = (profile.watchlist || []).filter(Boolean).some(w => {
                if (!w || !item) return false;
                if (w.id && item.id && String(w.id) === String(item.id)) return true;
                const wT = getTmdbIdStr(w);
                const iT = getTmdbIdStr(item);
                return (wT && iT && wT === iT);
            });
        } catch (e) {
            console.error('[ListsPanel] Error checking inWatchlist:', e);
        }

        let key = null;
        let inWatched = false;
        try {
            key = window.getPlaybackKey ? window.getPlaybackKey(item) : (item ? (item.id || item.path) : null);
            inWatched = !!(key && profile.playback && typeof profile.playback === 'object' && profile.playback[key]?.watched);
        } catch (e) {
            console.error('[ListsPanel] Error checking inWatched:', e);
        }

        const inCustomList = (list) => {
            try {
                return (list.items || []).filter(Boolean).some(i => {
                    if (!i || !item) return false;
                    if (i.id && item.id && String(i.id) === String(item.id)) return true;
                    const tA = getTmdbIdStr(i);
                    const tB = getTmdbIdStr(item);
                    return tA && tB && tA === tB;
                });
            } catch (e) {
                console.error('[ListsPanel] Error checking inCustomList:', e);
                return false;
            }
        };

        const lists = [
            { id: 'watchlist', name: 'My List (Watching)', items: (profile.watchlist || []).filter(Boolean), isSpecial: true },
            { id: 'watched', name: 'Watched', items: [], isSpecial: true },
            ...(profile.custom_lists || []).filter(Boolean)
        ];

        try {
            lists.forEach(list => {
                if (!list) return;
                const count = list.id === 'watched' ? 
                    (profile.playback && typeof profile.playback === 'object' ? Object.values(profile.playback).filter(x => x && x.watched).length : 0) : 
                    ((list.items || []).filter(Boolean).length);
                
                let active = false;
                if (list.id === 'watchlist') active = inWatchlist;
                else if (list.id === 'watched') active = inWatched;
                else active = inCustomList(list);

                let visualContent = '';
                if (list.id === 'watched') {
                    visualContent = `
                        <div class="collection-folder-icon watched">
                            <i class="fas fa-eye"></i>
                        </div>`;
                } else if (list.id === 'watchlist') {
                    visualContent = `
                        <div class="collection-folder-icon empty">
                            <i class="fas fa-folder-open"></i>
                        </div>`;
                } else {
                    visualContent = `
                        <div class="collection-folder-icon">
                            <i class="fas fa-folder"></i>
                        </div>`;
                }

                const card = document.createElement('div');
                card.className = 'panel-collection-card glass-premium' + (active ? ' active' : '');

                card.onclick = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }

                    // 1. Instant UI toggle feedback
                    const wasActive = card.classList.contains('active');
                    const isActiveNow = !wasActive;
                    
                    if (isActiveNow) {
                        card.classList.add('active');
                    } else {
                        card.classList.remove('active');
                    }

                    const checkbox = card.querySelector('.card-checkbox');
                    if (checkbox) {
                        checkbox.innerHTML = isActiveNow ? '<i class="fas fa-check"></i>' : '';
                    }

                    const countEl = card.querySelector('.collection-card-count');
                    if (countEl) {
                        let currentCount = parseInt(countEl.textContent) || 0;
                        let newCount = isActiveNow ? currentCount + 1 : Math.max(0, currentCount - 1);
                        countEl.textContent = `${newCount} ${newCount === 1 ? 'item' : 'items'}`;
                    }

                    // 2. Perform actual logic
                    if (list.id === 'watchlist') {
                        window.toggleUnifiedLibrary(item);
                    } else if (list.id === 'watched') {
                        window.toggleUnifiedWatched(item);
                    } else {
                        toggleItemInCustomList(list.id, item);
                    }
                    
                    if (typeof updateWatchlistUI === 'function') {
                        updateWatchlistUI();
                    }
                    
                    // 3. Defer re-render to background to ensure data is updated properly
                    setTimeout(() => {
                        window.openListsPanel();
                    }, 150);
                };

                card.innerHTML = `
                    ${visualContent}
                    <div class="collection-card-details">
                        <div class="collection-card-title">${escapeHTML(list.name || 'Unnamed list')}</div>
                        <div class="collection-card-count">${count} ${count === 1 ? 'item' : 'items'}</div>
                    </div>
                    <div class="card-checkbox">
                        ${active ? '<i class="fas fa-check"></i>' : ''}
                    </div>
                `;
                
                listsContainer.appendChild(card);
            });
        } catch (err) {
            console.error('[ListsPanel] Error rendering lists loop:', err);
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'padding: 20px; color: #ff3333; text-align: center; font-weight: bold; font-size: 13px;';
            errorDiv.textContent = 'Failed to load collections: ' + err.message;
            listsContainer.appendChild(errorDiv);
        }
    };

    window.openEpisodes = async () => {
        const isMobile = window.innerWidth <= 768;
        const panel = document.getElementById(isMobile ? 'dd-mobile-panel' : 'dd-side-panel');
        const content = document.getElementById(isMobile ? 'dd-mobile-panel-content' : 'dd-panel-content');
        const title = document.getElementById(isMobile ? 'dd-mobile-panel-title' : 'dd-panel-title');
        
        panel.classList.add('active');
        content.innerHTML = '<div class="dd-loader-spinner-premium"></div>';
        title.textContent = isTV ? 'Episodes' : 'Streaming Links';

        if (isTV) {
            if (item.episodes && item.episodes.length > 0) {
                content.innerHTML = `
                    <div class="dd-panel-scroll">
                        <div class="dd-episode-list" id="dd-unified-ep-list"></div>
                        <div id="dd-streams-container-unified" style="display:none">
                            <button class="dd-panel-back-to-ep" onclick="window.backToEpisodes()"><i class="fas fa-chevron-left"></i> Back to Episodes</button>
                            <div id="dd-streams-list" class="dd-streams-list-unified active"></div>
                        </div>
                    </div>
                `;
                const listEl = document.getElementById('dd-unified-ep-list');
                
                // Inject skeleton styles if they don't exist
                if (!document.querySelector('style[data-episode-skeleton]')) {
                    const style = document.createElement('style');
                    style.setAttribute('data-episode-skeleton', 'true');
                    style.textContent = `
                    @keyframes shimmer {
                      0% { background-position: -1000px 0; }
                      100% { background-position: 1000px 0; }
                    }
                    .episode-item-skeleton {
                      display: flex;
                      flex-direction: column;
                      gap: 8px;
                      padding: 12px;
                      background: rgba(255,255,255,0.02);
                      border: 1px solid rgba(255,255,255,0.05);
                      border-radius: 12px;
                      animation: shimmer 2s infinite;
                      background: linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.02) 100%);
                      background-size: 1000px 100%;
                      margin-bottom: 12px;
                    }
                    .episode-skeleton-thumb {
                      width: 100%;
                      height: 120px;
                      background: linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 100%);
                      border-radius: 8px;
                      background-size: 1000px 100%;
                      animation: shimmer 2s infinite;
                    }
                    .episode-skeleton-title {
                      width: 70%;
                      height: 16px;
                      background: linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 100%);
                      border-radius: 4px;
                      background-size: 1000px 100%;
                      animation: shimmer 2s infinite;
                    }
                    .episode-skeleton-desc {
                      width: 100%;
                      height: 12px;
                      background: linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 100%);
                      border-radius: 4px;
                      background-size: 1000px 100%;
                      animation: shimmer 2s infinite;
                      margin-bottom: 4px;
                    }
                    `;
                    document.head.appendChild(style);
                }

                const offlineEps = item.episodes.map(ep => ({
                    episode: ep.episode,
                    episode_number: ep.episode,
                    season: ep.season || 1,
                    name: ep.title || `Episode ${ep.episode}`,
                    still_path: null,
                    air_date: null,
                    path: ep.path
                }));

                // Show skeleton loaders in the panel instead of local list immediate render
                listEl.innerHTML = Array.from({ length: Math.min(offlineEps.length || 6, 6) }).map(() => `
                    <div class="episode-item-skeleton">
                        <div class="episode-skeleton-thumb"></div>
                        <div class="episode-skeleton-title"></div>
                        <div class="episode-skeleton-desc"></div>
                        <div class="episode-skeleton-desc" style="width: 100%;"></div>
                    </div>
                `).join('');

                // Fetch episode details / thumbnails asynchronously and enrich the list
                (async () => {
                    let enriched = false;
                    try {
                        const cache = window.appData?.tmdbCache?.[item.id] || {};
                        const idToUse = item.imdb_id || item.tmdbId || item.tmdb_id || cache.tmdbId || item.id;
                        let tmdbId = null;
                        let imdbId = null;
                        let kitsuId = null;
                        let malId = null;

                        const idStr = String(idToUse || '');
                        if (idStr.startsWith('tt')) {
                            imdbId = idStr;
                        } else if (idStr.startsWith('kitsu:')) {
                            kitsuId = idStr.replace('kitsu:', '');
                        } else if (idStr.startsWith('mal:')) {
                            malId = idStr.replace('mal:', '');
                        } else if (idStr.startsWith('jikan:')) {
                            malId = idStr.replace('jikan:', '');
                        } else if (/^\d+$/.test(idStr)) {
                            tmdbId = idStr;
                        }

                        if (!imdbId) imdbId = item.imdb_id || (String(item.id).startsWith('tt') ? item.id : null);
                        if (!tmdbId) tmdbId = item.tmdbId || item.tmdb_id || (cache.type !== 'anime' && /^\d+$/.test(String(cache.tmdbId)) ? cache.tmdbId : null);
                        if (!kitsuId) kitsuId = item.kitsuId || (String(item.id).startsWith('kitsu:') ? String(item.id).replace('kitsu:', '') : null);
                        if (!malId) malId = item.mal_id || item.malId || (String(item.id).startsWith('mal:') ? String(item.id).replace('mal:', '') : null);

                        const isAnime = false; // Disabled: all anime routed through Cinemeta/TMDB
                        let apiEpisodes = null;

                        if (isAnime) {
                            let kitsuData = null;
                            if (kitsuId) {
                                kitsuData = await window.api.invoke('kitsu-details', kitsuId).catch(() => null);
                            }
                            if (!kitsuData && malId) {
                                kitsuData = await window.api.invoke('kitsu-details-by-mal', malId).catch(() => null);
                            }
                            if (kitsuData && kitsuData.videos && kitsuData.videos.length > 0) {
                                apiEpisodes = kitsuData.videos.map(v => ({
                                    episode: v.episode,
                                    name: v.name || v.title,
                                    still_path: v.thumbnail,
                                    air_date: v.released
                                }));
                            } else if (malId) {
                                const jikanData = await window.api.invoke('jikan-episodes', malId).catch(() => null);
                                if (jikanData && jikanData.data) {
                                    apiEpisodes = jikanData.data.map(ep => ({
                                        episode: ep.mal_id,
                                        name: ep.title,
                                        still_path: ep.images?.jpg?.image_url,
                                        air_date: ep.aired
                                    }));
                                }
                            }
                        } else {
                            const tmdbKey = window.appData?.tmdbKey || window.TMDB_API_KEY || 'a3c751221b6d0efdb621869e9fc13c02';
                            const tmdbEnabled = window.appData?.tmdbEnabled !== false;

                            if (tmdbKey && tmdbEnabled && (imdbId || tmdbId)) {
                                try {
                                    // 1. If we only have an IMDb ID, find the TMDB TV ID first
                                    if (imdbId && !tmdbId) {
                                        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
                                        const findRes = await fetch(findUrl).then(r => r.json()).catch(() => null);
                                        if (findRes && findRes.tv_results && findRes.tv_results.length > 0) {
                                            tmdbId = findRes.tv_results[0].id;
                                        }
                                    }

                                    // 2. Query TMDB season episodes for all unique seasons present in local episodes
                                    if (tmdbId) {
                                        const uniqueSeasons = [...new Set(offlineEps.map(ep => ep.season || 1))];
                                        let tmdbEpisodes = [];
                                        for (const season of uniqueSeasons) {
                                            const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${tmdbKey}`;
                                            const seasonRes = await fetch(seasonUrl).then(r => r.json()).catch(() => null);
                                            if (seasonRes && seasonRes.episodes) {
                                                const mapped = seasonRes.episodes.map(ep => ({
                                                    episode: ep.episode_number,
                                                    season: ep.season_number,
                                                    name: ep.name,
                                                    still_path: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
                                                    air_date: ep.air_date
                                                }));
                                                tmdbEpisodes.push(...mapped);
                                            }
                                        }
                                        if (tmdbEpisodes.length > 0) {
                                            apiEpisodes = tmdbEpisodes;
                                        }
                                    }
                                } catch (e) {
                                    console.error('[DETAIL] TMDB local episode fetch failed:', e);
                                }
                            }

                            // Fallback to Cinemeta if TMDB fetch did not work
                            if (!apiEpisodes) {
                                let cinemetaId = imdbId || tmdbId || item.id;
                                if (!cinemetaId && tmdbId) {
                                    cinemetaId = 'tmdb:' + tmdbId;
                                }
                                if (cinemetaId) {
                                    let cinemeta = await window.api.invoke('cinemeta-details', { id: cinemetaId, type: 'tv' }).catch(() => null);
                                    let resolvedCinemeta = cinemeta?.meta || cinemeta;
                                    if (resolvedCinemeta && resolvedCinemeta.videos && resolvedCinemeta.videos.length > 0) {
                                        apiEpisodes = resolvedCinemeta.videos.map(v => ({
                                            episode: v.episode,
                                            season: v.season,
                                            name: v.title || v.name,
                                            still_path: v.thumbnail || v.still || v.still_path || v.image,
                                            air_date: v.released
                                        }));
                                    }
                                }
                            }
                        }

                        if (apiEpisodes && apiEpisodes.length > 0) {
                            const enrichedEps = offlineEps.map(ep => {
                                const match = apiEpisodes.find(ae => {
                                    if (isAnime) {
                                        if (Number(ae.episode) === Number(ep.episode)) return true;
                                        if (ae.season && Number(ae.season) === Number(ep.season) && Number(ae.episode) === Number(ep.episode)) return true;
                                        return false;
                                    } else {
                                        return Number(ae.episode) === Number(ep.episode) && Number(ae.season) === Number(ep.season);
                                    }
                                });
                                if (match) {
                                    return {
                                        ...ep,
                                        name: ep.name.startsWith('Episode') ? (match.name || ep.name) : ep.name,
                                        still_path: match.still_path || ep.still_path,
                                        air_date: match.air_date || ep.air_date
                                    };
                                }
                                return ep;
                            });

                            renderEpisodesInBatches(listEl, enrichedEps, enrichedEps[0]?.season || 1, false);
                            enriched = true;
                        }
                    } catch (err) {
                        console.error('[DETAIL] Failed to fetch local episodes metadata:', err);
                    } finally {
                        if (!enriched) {
                            renderEpisodesInBatches(listEl, offlineEps, offlineEps[0]?.season || 1, false);
                        }
                    }
                })();

                return;
            }
            const kitsuSeasons = extra1?.seasons || [];
            if (isKitsu && extra1?.videos) {
                // Kitsu specific rendering (Seasons merging disabled)
                const vids = extra1.videos || [];
                let seasonPickerHtml = '';
                if (extra1.seasons && extra1.seasons.length > 1) {
                    seasonPickerHtml = `
                        <div class="dd-season-picker-premium">
                            <div class="dd-season-select-wrap">
                                <select class="dd-season-select" onchange="window.renderUnifiedDetail({ id: 'kitsu:' + this.value, source: 'kitsu' })">
                                    ${extra1.seasons.map(s => `<option value="${s.id}" ${s.active ? 'selected' : ''}>${s.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    `;
                }
                content.innerHTML = `
                    <div class="dd-panel-scroll">
                        ${seasonPickerHtml}
                        <div class="dd-episode-list" id="dd-unified-ep-list"></div>
                        <div id="dd-streams-container-unified" style="display:none">
                            <button class="dd-panel-back-to-ep" onclick="window.backToEpisodes()"><i class="fas fa-chevron-left"></i> Back to Episodes</button>
                            <div id="dd-streams-list" class="dd-streams-list-unified active"></div>
                        </div>
                    </div>
                `;
                const listEl = document.getElementById('dd-unified-ep-list');
                renderEpisodesInBatches(listEl, vids, 1, true);
                try { window._lastUnifiedKitsuSeasonId = String(item.id).replace('kitsu:', ''); } catch (e) { window._lastUnifiedKitsuSeasonId = item.id; }
            } else if (item.source === 'jikan' || item.source === 'mal' || item.mal_id) {
                const malId = item.mal_id || String(item.id).replace('mal:', '').replace('jikan:', '');
                
                // Try to get proper seasons and thumbnails from Kitsu first
                const kitsuData = await window.api.invoke('kitsu-details-by-mal', malId).catch(() => null);
                
                if (kitsuData && kitsuData.videos && kitsuData.videos.length > 0) {
                    let seasonPickerHtml = '';
                    if (kitsuData.seasons && kitsuData.seasons.length > 1) {
                        seasonPickerHtml = `
                            <div class="dd-season-picker-premium">
                                <div class="dd-season-select-wrap">
                                    <select class="dd-season-select" onchange="window.renderUnifiedDetail({ id: 'kitsu:' + this.value, source: 'kitsu' })">
                                        ${kitsuData.seasons.map(s => `<option value="${s.id}" ${s.active ? 'selected' : ''}>${s.name}</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                        `;
                    }
                    content.innerHTML = `
                        <div class="dd-panel-scroll">
                            ${seasonPickerHtml}
                            <div class="dd-episode-list" id="dd-unified-ep-list"></div>
                            <div id="dd-streams-container-unified" style="display:none">
                                <button class="dd-panel-back-to-ep" onclick="window.backToEpisodes()"><i class="fas fa-chevron-left"></i> Back to Episodes</button>
                                <div id="dd-streams-list" class="dd-streams-list-unified active"></div>
                            </div>
                        </div>
                    `;
                    const listEl = document.getElementById('dd-unified-ep-list');
                    renderEpisodesInBatches(listEl, kitsuData.videos, 1, true);
                    try { window._lastUnifiedKitsuSeasonId = String(kitsuData.id).replace('kitsu:', ''); } catch (e) {}
                } else {
                    // Fallback to Jikan native episodes
                    content.innerHTML = `
                        <div class="dd-panel-scroll">
                            <div class="dd-episode-list" id="dd-unified-ep-list"></div>
                            <div id="dd-streams-container-unified" style="display:none">
                                <button class="dd-panel-back-to-ep" onclick="window.backToEpisodes()"><i class="fas fa-chevron-left"></i> Back to Episodes</button>
                                <div id="dd-streams-list" class="dd-streams-list-unified active"></div>
                            </div>
                        </div>
                    `;
                    await window.loadUnifiedEpisodes(malId, 1, false, true);
                }
            } else {
                const tmdbId = tmdb?.tmdb_id || tmdb?.id || item.tmdb_id || item.id;
                let seasons = tmdb?.seasons;
                
                if (!seasons && window._lastTmdbData && window._lastTmdbData.videos) {
                    const uniqueSeasons = [...new Set(window._lastTmdbData.videos.map(v => v.season))].filter(s => s != null);
                    if (uniqueSeasons.length > 0) {
                        seasons = uniqueSeasons.sort((a,b) => a - b).map(s => ({ season_number: s, name: `Season ${s}` }));
                    }
                }
                
                if (!seasons || seasons.length === 0) {
                    seasons = [{ season_number: 1, name: 'Season 1' }];
                }

                seasons = seasons.map(s => ({
                    ...s,
                    name: s.season_number === 0 ? 'Specials' : (s.name === 'Season 0' ? 'Specials' : s.name)
                }));

                seasons.sort((a,b) => (a.season_number === 0 ? 1 : b.season_number === 0 ? -1 : a.season_number - b.season_number));

                content.innerHTML = `
                    <div class="dd-panel-scroll">
                        <div class="dd-season-picker-premium">
                            ${seasons.length > 1 ? `
                                <div class="dd-season-select-wrap">
                                    <select class="dd-season-select" onchange="window.loadUnifiedEpisodes('${tmdbId}', this.value)">
                                        ${seasons.map(s => `<option value="${s.season_number}">${s.name}</option>`).join('')}
                                    </select>
                                </div>
                            ` : ''}
                        </div>
                        <div class="dd-episode-list" id="dd-unified-ep-list"></div>
                        <div id="dd-streams-container-unified" style="display:none">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                <button class="dd-panel-back-to-ep" onclick="window.backToEpisodes()"><i class="fas fa-chevron-left"></i> Back to Episodes</button>
                                <button class="btn-streams-about" onclick="window.showStreamsAboutModal()" style="background: rgba(0, 173, 181, 0.12); border: 1px solid rgba(0, 173, 181, 0.35); color: #00adb5; padding: 5px 12px; border-radius: 10px; font-weight: 700; font-size: 0.76rem; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                                    <i class="fas fa-info-circle"></i> About Streams
                                </button>
                            </div>
                            <div id="dd-streams-list" class="dd-streams-list-unified active"></div>
                        </div>
                    </div>
                `;
                await window.loadUnifiedEpisodes(tmdbId, seasons[0].season_number);
            }
        } else {
            // Movie: Ensure streams container exists then load
            content.innerHTML = `<div id="dd-streams-list" class="dd-streams-list-unified" style="display:grid; gap:10px; padding:10px"></div>`;
            window.loadStreams(item, 'movie');
        }
    };

    window.loadUnifiedEpisodes = async (tvId, seasonNum, isKitsu = false, isJikan = false) => {
        const list = document.getElementById('dd-unified-ep-list');
        if (list) {
            list.innerHTML = '<div class="dd-loader-spinner-premium"></div>';
            list.style.display = 'flex';
        }
        const streamContainer = document.getElementById('dd-streams-container-unified');
        if (streamContainer) streamContainer.style.display = 'none';

        if (isJikan) {
            const data = await window.api.invoke('jikan-episodes', tvId);
            if (data && data.data) {
                const listEl = document.getElementById('dd-unified-ep-list');
                if (!listEl) return;
                listEl.innerHTML = data.data.map((ep, idx) => {
                    const epNum = ep.mal_id;
                    const finalTitle = ep.title || `Episode ${epNum}`;
                    const thumbUrl = ep.images?.jpg?.image_url || window.currentDetailItem?.backdrop_path || window.currentDetailItem?.poster_path || 'imgs/no-backdrop.png';
                    return `
                        <div class="dd-ep-card" style="animation-delay: ${idx * 0.05}s" onclick="window.selectUnifiedEpisode(1, ${epNum}, '${(finalTitle || '').replace(/'/g, "\\'")}', '${thumbUrl}', '')">
                            <div class="dd-ep-img">
                                <img src="${thumbUrl}" onerror="this.onerror=null;this.src='imgs/no-backdrop.png'">
                                <div class="dd-ep-number">EP ${epNum}</div>
                            </div>
                            <div class="dd-ep-info">
                                <div class="dd-ep-name">${escapeHTML(finalTitle)}</div>
                                <div class="dd-ep-date">${ep.aired ? new Date(ep.aired).toLocaleDateString() : ''}</div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                if (document.getElementById('dd-unified-ep-list')) {
                    document.getElementById('dd-unified-ep-list').innerHTML = '<div style="padding: 20px; color: var(--text-muted);">No episodes found.</div>';
                }
            }
            return;
        }

        if (isKitsu) {
            const data = await window.api.invoke('kitsu-details', tvId);
            // track which Kitsu season/anime id we loaded episodes for
            try { window._lastUnifiedKitsuSeasonId = String(tvId).replace('kitsu:', ''); } catch (e) { window._lastUnifiedKitsuSeasonId = tvId; }
            if (data && data.videos) {
                const listEl = document.getElementById('dd-unified-ep-list');
                if (!listEl) return;

                let tmdbEpisodes = [];
                try {
                    const tmdbId = data.tmdb_id || window.currentDetailItem?.tmdb_id || window.currentDetailItem?.tmdbId || (window._lastExtraData?.tmdb_id);
                    const activeSeason = data.seasons?.find(s => String(s.id) === String(tvId).replace('kitsu:', '')) || data.seasons?.find(s => s.active);
                    const tmdbSeasonNum = activeSeason ? activeSeason.season_number : 1;
                    if (tmdbId) {
                        const tmdbData = await window.api.invoke('tmdb-season-details', tmdbId, tmdbSeasonNum).catch(() => null);
                        if (tmdbData && tmdbData.episodes) {
                            tmdbEpisodes = tmdbData.episodes;
                        }
                    }
                } catch (err) {
                    console.warn('[UNIFIED] TMDB season details fetch failed for Kitsu enrichment:', err);
                }

                listEl.innerHTML = data.videos.map((v, idx) => {
                    const epNum = v.episode;
                    const finalTitle = v.name || v.title || `Episode ${epNum}`;
                    const tmdbEp = tmdbEpisodes.find(te => Number(te.episode_number) === Number(epNum));
                    const highResThumb = tmdbEp?.still_path || v.thumbnail;
                    const thumbUrl = highResThumb || window.currentDetailItem?.backdrop_path || window.currentDetailItem?.poster_path || 'imgs/no-backdrop.png';
                    return `
                        <div class="dd-ep-card" style="animation-delay: ${idx * 0.05}s" onclick="window.selectUnifiedEpisode(${v.season || 1}, ${epNum}, '${(finalTitle || '').replace(/'/g, "\\'")}', '${highResThumb || ''}', '${(v.path || '').replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')">
                            <div class="dd-ep-img">
                                <img src="${thumbUrl}" onerror="this.onerror=null;this.src='imgs/no-backdrop.png'">
                                <div class="dd-ep-number">EP ${epNum}</div>
                            </div>
                            <div class="dd-ep-info">
                                <div class="dd-ep-name">${escapeHTML(finalTitle)}</div>
                                <div class="dd-ep-date">${v.released ? new Date(v.released).toLocaleDateString() : ''}</div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            return;
        }

        let data = await window.api.invoke('tmdb-season-details', tvId, seasonNum).catch(() => null);
        
        if ((!data || !data.episodes || data.episodes.length === 0) && window._lastTmdbData && window._lastTmdbData.videos) {
            const seasonVids = window._lastTmdbData.videos.filter(v => v.season === parseInt(seasonNum));
            if (seasonVids.length > 0) {
                data = { episodes: seasonVids.map(v => ({
                    episode_number: v.episode,
                    name: v.title || v.name || `Episode ${v.episode}`,
                    still_path: v.thumbnail,
                    air_date: v.released
                })) };
            }
        }

        if (data && data.episodes) {
            const listEl = document.getElementById('dd-unified-ep-list');
            renderEpisodesInBatches(listEl, data.episodes, seasonNum, false);
        } else {
            if (document.getElementById('dd-unified-ep-list')) {
                document.getElementById('dd-unified-ep-list').innerHTML = '<div style="padding: 20px; color: var(--text-muted);">No episodes found or TMDB error.</div>';
            }
        }
    };

    window.selectUnifiedEpisode = (season, episode, name, thumbnail, path = '') => {
        const list = document.getElementById('dd-unified-ep-list');
        const streamContainer = document.getElementById('dd-streams-container-unified');
        if (list) list.style.display = 'none';
        if (streamContainer) streamContainer.style.display = 'block';
        
        let thumbUrl = thumbnail;
        if (thumbnail && !thumbnail.startsWith('http')) {
            thumbUrl = window.getTMDBImageUrl(thumbnail, true);
        }
        // If we previously loaded a Kitsu season, prefer that kitsu id for searching streams
        const kitsuSeasonId = window._lastUnifiedKitsuSeasonId || window.currentDetailItem?.kitsuId || null;
        const payload = { ...window.currentDetailItem, season, episode, epTitle: name, thumbnail: thumbUrl, media_type: 'tv' };
        if (kitsuSeasonId) payload.kitsuId = String(kitsuSeasonId).replace('kitsu:', '');
        if (path) {
            payload.path = path;
        }
        const streamType = (window.currentDetailItem?.source === 'jikan' || window.currentDetailItem?.source === 'mal' || window.currentDetailItem?.source === 'kitsu' || payload.kitsuId) ? 'anime' : 'tv';
        window.loadStreams(payload, streamType);
    };

    window.backToEpisodes = () => {
        const list = document.getElementById('dd-unified-ep-list');
        const streamContainer = document.getElementById('dd-streams-container-unified');
        if (list) list.style.display = 'flex';
        if (streamContainer) streamContainer.style.display = 'none';
    };

    const watchBtn = document.getElementById('btn-main-watch');
    if (watchBtn) watchBtn.onclick = window.openEpisodes;

    const playBtnTop = document.getElementById('dd-play-btn-top');
    if (playBtnTop) {
        const defaultPlayLabel = isTV ? '<i class="fas fa-list-ol"></i> Show Episodes' : '<i class="fas fa-play"></i> Watch Now';
        playBtnTop.innerHTML = defaultPlayLabel;
        playBtnTop.onclick = (e) => {
            // For movies with auto-choose: show inline spinner inside the button
            if (!isTV && window.appData && window.appData.autoChooseBestStream) {
                playBtnTop.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding Stream...';
                playBtnTop.style.opacity = '0.75';
                playBtnTop.style.pointerEvents = 'none';
                // Restore button after a delay (stream auto-plays, user returns, etc.)
                const restoreBtn = () => {
                    playBtnTop.innerHTML = defaultPlayLabel;
                    playBtnTop.style.opacity = '';
                    playBtnTop.style.pointerEvents = '';
                };
                setTimeout(restoreBtn, 8000);
                window._restorePlayBtn = restoreBtn;
            }
            window.openEpisodes(e);
        };
    }

    
    const trailerBtn = document.getElementById('dd-play-trailer');
    if (trailerBtn) {
        trailerBtn.onclick = () => window.loadStreams({ ...item, isTrailer: true }, 'movie');
    }

    resolve();
  });
}

function extractAllGenres(item, tmdb, extra1, anilist) {
    const genreSet = new Set();
    const rawCandidates = [
        tmdb?.genres,
        tmdb?.genre,
        extra1?.genres,
        extra1?.genre,
        item?.genres,
        item?.genre,
        anilist?.genres
    ];

    rawCandidates.forEach(candidate => {
        if (!candidate) return;
        if (Array.isArray(candidate)) {
            candidate.forEach(g => {
                if (!g) return;
                if (typeof g === 'string') {
                    g.split(/[,/|]/).forEach(s => {
                        const clean = s.trim();
                        if (clean && clean.length > 1) genreSet.add(clean);
                    });
                } else if (typeof g === 'object' && (g.name || g.label)) {
                    const clean = (g.name || g.label).trim();
                    if (clean && clean.length > 1) genreSet.add(clean);
                }
            });
        } else if (typeof candidate === 'string') {
            candidate.split(/[,/|]/).forEach(s => {
                const clean = s.trim();
                if (clean && clean.length > 1) genreSet.add(clean);
            });
        }
    });

    return Array.from(genreSet);
}

function createPillGroup(label, items) {
    const div = document.createElement('div');
    div.className = 'dd-pill-group';
    div.innerHTML = `
        <div class="dd-pill-label"><span>${label}</span></div>
        <div class="dd-pill-list">${items.map(it => `<div class="dd-pill">${window.escapeHTML(it)}</div>`).join('')}</div>
    `;
    return div;
}

let trailerTimeout = null;
let currentTrailerVideo = null;
async function resolveTrailerYoutubeUrl(item, cinemeta, extra1) {
    try {
        const isAnime = false; // Disabled: all anime routed through Cinemeta/TMDB for trailer resolution
        let youtubeUrl = null;
        
        if (isAnime) {
            let malId = item.mal_id || item.malId || extra1?.mal_id || extra1?.malId;
            if (!malId && item.id && String(item.id).startsWith('mal:')) {
                malId = item.id.replace('mal:', '');
            }
            if (malId && !isNaN(malId)) {
                const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}`).catch(() => null);
                if (res) {
                    const json = await res.json().catch(() => null);
                    if (json?.data?.trailer?.youtube_id) {
                        youtubeUrl = `https://www.youtube.com/watch?v=${json.data.trailer.youtube_id}`;
                    }
                }
            }
            if (!youtubeUrl && extra1?.attributes?.youtubeVideoId) {
                youtubeUrl = `https://www.youtube.com/watch?v=${extra1.attributes.youtubeVideoId}`;
            }
        } else {
            // Western media
            const meta = cinemeta?.meta || cinemeta || item;
            if (meta?.trailers && meta.trailers.length > 0) {
                // Cinemeta format: { source: "video_id", type: "Trailer" }
                const yt = meta.trailers.find(t => t.type === 'Trailer' || t.type === 'trailer' || t.source);
                if (yt && yt.source) {
                    youtubeUrl = (yt.source.includes('://') || yt.source.includes('watch?')) ? yt.source : `https://www.youtube.com/watch?v=${yt.source}`;
                }
            }
            if (!youtubeUrl && meta?.youtubeId) {
                youtubeUrl = `https://www.youtube.com/watch?v=${meta.youtubeId}`;
            }
            
            // TMDB Videos Fallback
            if (!youtubeUrl) {
                const tmdbKey = window.appData?.tmdbKey;
                const imdbId = item.imdb_id || item.imdbId || meta?.imdb_id || (String(item.id).startsWith('tt') ? item.id : null);
                let tmdbId = item.tmdbId || item.tmdb_id || meta?.moviedb_id || meta?.tmdb_id;
                
                if (tmdbKey && (imdbId || tmdbId)) {
                    if (!tmdbId && imdbId) {
                        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
                        const findRes = await fetch(findUrl).then(r => r.json()).catch(() => null);
                        const isTv = item.type === 'series' || item.type === 'tv' || meta?.type === 'series' || meta?.type === 'tv';
                        const resultsList = isTv ? findRes?.tv_results : findRes?.movie_results;
                        if (resultsList && resultsList[0]) {
                            tmdbId = resultsList[0].id;
                        }
                    }
                    if (tmdbId) {
                        const isTv = item.type === 'series' || item.type === 'tv' || meta?.type === 'series' || meta?.type === 'tv';
                        const videoUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}/videos?api_key=${tmdbKey}`;
                        const videoRes = await fetch(videoUrl).then(r => r.json()).catch(() => null);
                        if (videoRes && videoRes.results && videoRes.results.length > 0) {
                            const trailer = videoRes.results.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                                            videoRes.results.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                                            videoRes.results.find(v => v.site === 'YouTube');
                            if (trailer) {
                                youtubeUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
                            }
                        }
                    }
                }
            }
        }
        return youtubeUrl;
    } catch (e) {
        console.warn('[Trailer] Failed to resolve YouTube URL:', e);
    }
    return null;
}

function extractYoutubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

async function playBackgroundTrailer(youtubeUrl) {
    window.stopBackgroundTrailer();

    if (!youtubeUrl) return;
    
    // Check settings
    const enable = window.appData?.enableVideoTrailers !== false;
    if (!enable) return;

    const wrap = document.querySelector('.dd-backdrop-wrap');
    const img = document.getElementById('dd-backdrop-img');
    if (!wrap || !img) return;

    const youtubeId = extractYoutubeId(youtubeUrl);
    if (!youtubeId) return;

    // Save current banner src for restoration when trailer ends
    const savedBannerSrc = img.src;

    // Resolve the YouTube URL immediately in parallel
    let directUrl = null;
    try {
        directUrl = await window.api.invoke('resolve-trailer-stream', youtubeUrl);
    } catch (err) {
        console.warn('[Trailer] Failed to resolve direct URL via IPC:', err);
    }

    if (directUrl) {
        // Create HTML5 Video element
        const video = document.createElement('video');
        video.id = 'dd-backdrop-video';
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            border: none;
            opacity: 0;
            z-index: 0.5;
            transition: opacity 2s ease;
            pointer-events: none;
        `;
        
        // Ensure image is styled for transition
        img.style.position = 'relative';
        img.style.zIndex = '0';
        img.style.transition = 'opacity 2s ease';

        // Add error and ended event handlers to recover from black screen
        video.onerror = () => {
            console.warn('[Trailer] Background video error encountered. Fading back to image.');
            fadeBackToImage(video, img, savedBannerSrc);
        };
        video.onended = () => {
            console.log('[Trailer] Background video ended. Fading back to image.');
            fadeBackToImage(video, img, savedBannerSrc);
        };

        wrap.appendChild(video);
        currentTrailerVideo = video;

        const onReady = () => {
            if (currentTrailerVideo !== video) return;
            img.style.opacity = '0';
            video.style.opacity = '0.7'; // Blend nicely with dark theme

            // Show Sound and Full Screen buttons since background video is active
            const audioBtn = document.getElementById('dd-audio-btn');
            const fullscreenBtn = document.getElementById('dd-fullscreen-btn');
            if (audioBtn) {
                audioBtn.style.display = 'inline-flex';
                audioBtn.innerHTML = `<i class="fas fa-volume-mute" style="font-size: 1.1rem;"></i>`;
            }
            if (fullscreenBtn) {
                fullscreenBtn.style.display = 'inline-flex';
            }

            // Play snippet (e.g. 20 seconds) then fade back to image
            trailerTimeout = setTimeout(() => {
                fadeBackToImage(video, img, savedBannerSrc);
            }, 20000);
        };

        // HLS / DASH → Shaka Player; plain mp4/webm → native <video src>
        const isHls = directUrl.includes('.m3u8') || directUrl.includes('manifest');
        if (isHls && window.shaka && window.shaka.Player) {
            try {
                shaka.polyfill.installAll();
                const shakaPlayer = new shaka.Player();
                shakaPlayer.attach(video).then(() => {
                    shakaPlayer.configure({ streaming: { bufferingGoal: 10 } });
                    return shakaPlayer.load(directUrl);
                }).then(() => {
                    video.play().catch(() => {});
                    video.onloadeddata = onReady;
                }).catch(err => {
                    console.warn('[Trailer] Shaka HLS load failed:', err);
                    // Fallback to direct src
                    video.src = directUrl;
                    video.onloadeddata = onReady;
                });
            } catch (e) {
                console.warn('[Trailer] Shaka init failed:', e);
                video.src = directUrl;
                video.onloadeddata = onReady;
            }
        } else {
            video.src = directUrl;
            video.onloadeddata = onReady;
        }
    }
    // No iframe fallback — YouTube embeds produce Error 153 under file:// protocol.
    // If yt-dlp failed, we simply keep the high-res banner image visible.
}


function fadeBackToImage(video, img, savedSrc) {
    if (img) {
        // ── Fix 3b: Restore the saved high-res banner if the src was lost or changed ──
        if (savedSrc && img.src !== savedSrc) {
            img.src = savedSrc;
        }
        // Clear any lingering blur/transform from progressive loading
        img.style.filter = '';
        img.style.transform = '';
        img.style.opacity = '1';
    }
    if (video) {
        video.style.opacity = '0';
        setTimeout(() => {
            if (video && video.parentNode) {
                if (typeof video.pause === 'function') video.pause();
                video.src = '';
                video.remove();
            }
        }, 2000);
    }
}


window.stopBackgroundTrailer = function() {
    if (trailerTimeout) {
        clearTimeout(trailerTimeout);
        trailerTimeout = null;
    }
    const video = document.getElementById('dd-backdrop-video');
    if (video) {
        if (typeof video.pause === 'function') video.pause();
        video.src = '';
        video.remove();
    }
    const img = document.getElementById('dd-backdrop-img');
    if (img) {
        img.style.opacity = '1';
    }
    currentTrailerVideo = null;

    // Reset trailer UI buttons/classes
    const trailerActions = document.getElementById('dd-trailer-actions');
    const youtubeBtn = document.getElementById('dd-youtube-btn');
    const audioBtn = document.getElementById('dd-audio-btn');
    const fullscreenBtn = document.getElementById('dd-fullscreen-btn');
    if (trailerActions) trailerActions.style.display = 'none';
    if (youtubeBtn) youtubeBtn.style.display = 'none';
    if (audioBtn) audioBtn.style.display = 'none';
    if (fullscreenBtn) fullscreenBtn.style.display = 'none';

    const detailContainer = document.getElementById('view-discover-detail');
    if (detailContainer) {
        detailContainer.classList.remove('trailer-fullscreen-mode');
    }
};

// Global keydown handler to exit fullscreen backdrop mode on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const detailContainer = document.getElementById('view-discover-detail');
        if (detailContainer && detailContainer.classList.contains('trailer-fullscreen-mode')) {
            detailContainer.classList.remove('trailer-fullscreen-mode');
            const video = document.getElementById('dd-backdrop-video');
            if (video) {
                video.style.opacity = '0.7';
            }
        }
    }
});
