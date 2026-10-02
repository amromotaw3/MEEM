/* ── Unified Cinematic Detail & Data Orchestrator (V4 - Mobile Polish) ── */
const DEFAULT_TMDB_KEY = '4e44d9029b1270a757cddc766a1bcb63';

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
            url = url.replace(/live\.metahub\.space/, 'images.metahub.space');
            url = url.replace(/\/background\/(medium|small)\//, '/background/large/');
        } else if (url.includes('image.tmdb.org/t/p/')) {
            url = url.replace(/\/t\/p\/[^\/]+/, '/t/p/original');
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
        const fullUrl = `https://image.tmdb.org/t/p/original${cleanPath}`;
        return (typeof window.localImg === 'function') ? window.localImg(fullUrl) : fullUrl;
    }

    const imdbId = url.replace(/^\//, '').replace(/\/(img|background\.jpg)$/, '');
    const type = isHighRes ? 'background/large' : 'poster/medium';
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

window.checkIsSameMedia = function(a, b) {
    if (!a || !b) return false;
    if (typeof window.isSameItem === 'function') return window.isSameItem(a, b);
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) return true;
    const aImdb = a.imdb_id || a.imdbId || (String(a.id || '').startsWith('tt') ? a.id : null);
    const bImdb = b.imdb_id || b.imdbId || (String(b.id || '').startsWith('tt') ? b.id : null);
    if (aImdb && bImdb && String(aImdb) === String(bImdb)) return true;
    const getT = window.getTmdbIdStr || ((i) => (i?.tmdbId || i?.tmdb_id || null));
    const aT = getT(a);
    const bT = getT(b);
    if (aT && bT && String(aT) === String(bT)) return true;
    const aK = a.kitsuId || a.kitsu_id || (String(a.id || '').startsWith('kitsu:') ? String(a.id).replace('kitsu:', '') : null);
    const bK = b.kitsuId || b.kitsu_id || (String(b.id || '').startsWith('kitsu:') ? String(b.id).replace('kitsu:', '') : null);
    if (aK && bK && String(aK) === String(bK)) return true;
    const tA = (a.title || a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const tB = (b.title || b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tA && tB && tA === tB && tA.length >= 2) return true;
    return false;
};

window.toggleItemInCustomList = function(listId, targetItem) {
    const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData.activeProfileId);
    if (!profile || !targetItem) return;
    
    const list = profile.custom_lists?.find(l => l.id === listId);
    if (!list) return;

    list.items = list.items || [];
    const checkFn = window.checkIsSameMedia;
    const index = list.items.findIndex(i => checkFn(i, targetItem));

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
        if (typeof window.showToast === 'function') window.showToast(`Added to "${list.name}"`);
    } else {
        list.items.splice(index, 1);
        if (typeof window.showToast === 'function') window.showToast(`Removed from "${list.name}"`);
    }

    if (typeof window.persist === 'function') window.persist(true);
    if (typeof window.updateWatchlistUI === 'function') window.updateWatchlistUI();
    if (typeof window.renderLibCustomLists === 'function') window.renderLibCustomLists();
    if (typeof window.renderBentoWatchlist === 'function') window.renderBentoWatchlist();
    if (window.currentView === 'custom-list-detail' && typeof window.renderCustomListDetail === 'function') window.renderCustomListDetail(listId);
};

window.renderUnifiedDetail = async function(item) {
    window.currentUnifiedDetailItem = item;
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
        const isKitsu = item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || !!item.anime_id || !!item.mal_id || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));
        const isAnime = isKitsu || item.isAnime || !!item.mal_id || !!item.anime_id || (item.genre && String(item.genre).toLowerCase().includes('anime')) || (item.genres && item.genres.some(g => String(g.name || g).toLowerCase().includes('anime')));
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
        const tmdbKey = window.appData?.tmdbKey || DEFAULT_TMDB_KEY;
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
        if (numericTmdbId) {
            console.log(`[UnifiedDetail] Numeric TMDB ID detected: ${numericTmdbId}. Resolving to IMDb ID...`);
            const isSeries = mediaType === 'tv' || mediaType === 'series';
            let resolvedImdbId = null;
            
            if (tmdbKey) {
                const tmdbUrl = isSeries 
                    ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/external_ids?api_key=${tmdbKey}`
                    : `https://api.themoviedb.org/3/movie/${numericTmdbId}?api_key=${tmdbKey}`;
                try {
                    const tmdbRes = await fetch(tmdbUrl).then(r => r.json());
                    resolvedImdbId = tmdbRes?.imdb_id || tmdbRes?.external_ids?.imdb_id;
                } catch (err) {
                    console.warn(`[UnifiedDetail] TMDB API resolution note:`, err.message);
                }
            }

            if (!resolvedImdbId || !String(resolvedImdbId).startsWith('tt')) {
                try {
                    const type2 = isSeries ? 'series' : 'movie';
                    const elfRes = await fetch(`https://tmdb.elfhosted.com/meta/${type2}/tmdb:${numericTmdbId}.json`, { signal: AbortSignal.timeout(4000) }).then(r => r.json());
                    resolvedImdbId = elfRes?.meta?.imdb_id || elfRes?.meta?.imdbId;
                    if (elfRes?.meta) {
                        extra1 = elfRes.meta;
                        if (!item.title && elfRes.meta.name) item.title = elfRes.meta.name;
                    }
                } catch (e2) {}
            }

            if (resolvedImdbId && String(resolvedImdbId).startsWith('tt')) {
                console.log(`[UnifiedDetail] Resolved TMDB ID ${numericTmdbId} → IMDb ${resolvedImdbId}`);
                cinemetaId = resolvedImdbId;
                item.imdbId = resolvedImdbId;
                item.imdb_id = resolvedImdbId;
                if (window.currentDetailItem) {
                    window.currentDetailItem.imdbId = resolvedImdbId;
                    window.currentDetailItem.imdb_id = resolvedImdbId;
                }
                if (window.currentUnifiedDetailItem) {
                    window.currentUnifiedDetailItem.imdbId = resolvedImdbId;
                    window.currentUnifiedDetailItem.imdb_id = resolvedImdbId;
                }
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
            let malId = item.mal_id || item.malId || (String(item.id).startsWith('mal:') ? String(item.id).replace('mal:', '') : null);
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
                    rating: unifiedResponse.rating,
                    score: unifiedResponse.rating,
                    mal_rating: unifiedResponse.rating,
                    malScore: unifiedResponse.rating,
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
            // Western Media: Cinemeta metadata + Fanart.tv enhancement + Direct TMDB (for guaranteed 4K backdrops & official logos)
            const tmdbKey = window.appData?.tmdbKey || DEFAULT_TMDB_KEY;
            const fetchTmdbDetails = async () => {
                try {
                    let tid = item.tmdbId || item.tmdb_id || (cinemetaId && /^\d+$/.test(String(cinemetaId)) ? cinemetaId : null);
                    if (!tid && cinemetaId && String(cinemetaId).startsWith('tt') && tmdbKey) {
                        const findRes = await fetch(`https://api.themoviedb.org/3/find/${cinemetaId}?api_key=${tmdbKey}&external_source=imdb_id`, { signal: AbortSignal.timeout(3500) }).then(r => r.json()).catch(() => null);
                        const match = findRes?.movie_results?.[0] || findRes?.tv_results?.[0];
                        if (match) tid = match.id;
                    }
                    if (tid && tmdbKey) {
                        const typePath = (mediaType === 'tv' || mediaType === 'series') ? 'tv' : 'movie';
                        const details = await fetch(`https://api.themoviedb.org/3/${typePath}/${tid}?api_key=${tmdbKey}&append_to_response=images,external_ids,credits`, { signal: AbortSignal.timeout(3500) }).then(r => r.json()).catch(() => null);
                        return details;
                    }
                } catch (e) {}
                return null;
            };

            const isAnimeSearch = isAnime || item.source === 'kitsu' || item.source === 'mal' || item.isAnime || !!item.mal_id || (item.genre && String(item.genre).toLowerCase().includes('anime')) || (item.genres && item.genres.some(g => String(g.name || g).toLowerCase().includes('anime')));

            let [cinemetaRes, fanartRes, tmdbDetailsRes, anilistRes] = await Promise.all([
                (cinemetaId && String(cinemetaId).startsWith('tt')) ? window.api.invoke('cinemeta-details', { id: cinemetaId, type: mediaType }).catch(() => null) : Promise.resolve(null),
                (cinemetaId && window.api && window.api.fanartGetImages) ? window.api.fanartGetImages(cinemetaId, mediaType).catch(() => null) : Promise.resolve(null),
                fetchTmdbDetails(),
                (isAnimeSearch) ? window.api.invoke('anilist-media-detailed', { title: item.title_english || item.title || item.name }).catch(() => null) : Promise.resolve(null)
            ]);
            if (anilistRes) anilist = anilistRes;

            // Auto-enrich anime from AniList if TMDB reveals Japanese animation
            if (!anilist && tmdbDetailsRes) {
                const isJp = tmdbDetailsRes.origin_country?.includes('JP') || tmdbDetailsRes.original_language === 'ja' || (tmdbDetailsRes.genres || []).some(g => g.id === 16 || (g.name || '').toLowerCase() === 'animation');
                if (isJp) {
                    try {
                        const targetTitle = tmdbDetailsRes.name || tmdbDetailsRes.title || item.title || item.name;
                        anilist = await window.api.invoke('anilist-media-detailed', { title: targetTitle }).catch(() => null);
                    } catch (_) {}
                }
            }

            // If Cinemeta details was not fetched initially, but TMDB provides an IMDb ID, fetch Cinemeta now
            const resolvedImdbId = cinemetaRes?.imdb_id || cinemetaRes?.meta?.imdb_id || (cinemetaId && String(cinemetaId).startsWith('tt') ? cinemetaId : null) || tmdbDetailsRes?.imdb_id || tmdbDetailsRes?.external_ids?.imdb_id;
            if (!cinemetaRes && resolvedImdbId) {
                try {
                    cinemetaRes = await window.api.invoke('cinemeta-details', { id: resolvedImdbId, type: mediaType }).catch(() => null);
                } catch (e) {}
            }

            cinemeta = cinemetaRes;
            fanartImages = fanartRes;

            const baseCinemeta = cinemeta?.meta || cinemeta || item;
            const originalImdbRating = cinemeta?.imdb_rating || cinemeta?.meta?.imdbRating || cinemeta?.meta?.rating || baseCinemeta.imdbRating || baseCinemeta.imdb_rating || item.imdbRating || item.imdb_rating;

            if (tmdbDetailsRes) {
                const tmdbBg = tmdbDetailsRes.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbDetailsRes.backdrop_path}` : null;
                const tmdbPost = tmdbDetailsRes.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbDetailsRes.poster_path}` : null;
                const tmdbLogos = tmdbDetailsRes.images?.logos?.map(l => ({
                    url: `https://image.tmdb.org/t/p/original${l.file_path}`,
                    iso_639_1: l.iso_639_1
                })) || [];

                cinemeta = {
                    ...baseCinemeta,
                    ...tmdbDetailsRes,
                    imdbRating: originalImdbRating || null,
                    imdb_rating: originalImdbRating || null,
                    tmdbRating: (tmdbDetailsRes.vote_average != null && tmdbDetailsRes.vote_average > 0) ? tmdbDetailsRes.vote_average : null,
                    tmdb_rating: (tmdbDetailsRes.vote_average != null && tmdbDetailsRes.vote_average > 0) ? tmdbDetailsRes.vote_average : null,
                    backdrop_path: tmdbBg || baseCinemeta.background || item.backdrop_path,
                    poster_path: tmdbPost || baseCinemeta.poster || item.poster_path,
                    logos: tmdbLogos.length ? tmdbLogos : (fanartImages?.logos || [])
                };

                if (resolvedImdbId) {
                    cinemeta.imdb_id = resolvedImdbId;
                    cinemeta.imdbId = resolvedImdbId;
                    item.imdb_id = resolvedImdbId;
                    item.imdbId = resolvedImdbId;
                }

                if (!fanartImages) fanartImages = {};
                if (tmdbBg && (!fanartImages.backgrounds || !fanartImages.backgrounds.length)) {
                    fanartImages.backgrounds = [{ url: tmdbBg }];
                }
                if (tmdbLogos.length && (!fanartImages.logos || !fanartImages.logos.length)) {
                    fanartImages.logos = tmdbLogos;
                }
            } else if (originalImdbRating) {
                cinemeta = {
                    ...baseCinemeta,
                    imdbRating: originalImdbRating,
                    imdb_rating: originalImdbRating
                };
            }
        }

        let resolvedCinemeta = cinemeta?.meta || cinemeta;
        
        // Cache for UI refresh
        window._lastTmdbData = resolvedCinemeta;
        window._lastImageData = resolvedCinemeta;
        window._lastExtraData = extra1;

        // 4. Update UI
        await populateUnifiedUI(item, resolvedCinemeta, fanartImages || resolvedCinemeta, extra1, anilist);
        
        // Trigger background trailer playback asynchronously
        resolveTrailerYoutubeUrl(item, resolvedCinemeta, extra1, anilist).then(ytUrl => {
            if (ytUrl) {
                window.currentTrailerYoutubeUrl = ytUrl;
                const youtubeBtn = document.getElementById('dd-youtube-btn');
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

window.updateCardRatingBadges = function(mediaKey, rating) {
    if (!mediaKey) return;
    const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData?.activeProfileId);
    const mediaRating = parseFloat(rating || (profile?.ratings && profile.ratings[mediaKey]) || (window.mediaRatingsCache && window.mediaRatingsCache[mediaKey]) || 0);

    const cards = document.querySelectorAll(`[data-id="${mediaKey}"], [data-item-id="${mediaKey}"]`);
    cards.forEach(card => {
        // Hover badge at bottom-left of card poster
        let hoverBadge = card.querySelector('.card-hover-star-badge');
        // Permanent user star badge inside info container
        let userBadge = card.querySelector('.card-user-star-badge');

        if (mediaRating > 0) {
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                if (mediaRating >= i) {
                    starsHtml += '<i class="fas fa-star"></i>';
                } else if (mediaRating === i - 0.5) {
                    starsHtml += '<i class="fas fa-star-half-alt"></i>';
                } else {
                    starsHtml += '<i class="far fa-star" style="opacity:0.35;"></i>';
                }
            }

            if (!userBadge) {
                userBadge = document.createElement('div');
                userBadge.className = 'card-user-star-badge';
                const targetWrap = card.querySelector('.bento-wl-details, .discover-info, .card-details, .cw-details, .media-details, .search-card-info, .discover-meta') || card;
                targetWrap.appendChild(userBadge);
            }
            userBadge.title = `Your Rating: ${mediaRating}/5`;
            userBadge.innerHTML = `<span class="user-stars">${starsHtml}</span><span class="user-score">${mediaRating}/5</span>`;

            if (!hoverBadge) {
                hoverBadge = document.createElement('div');
                hoverBadge.className = 'card-hover-star-badge';
                card.appendChild(hoverBadge);
            }
            const starIcon = (mediaRating % 1 !== 0) ? 'fa-star-half-alt' : 'fa-star';
            hoverBadge.title = `Your Rating: ${mediaRating}/5`;
            hoverBadge.innerHTML = `<i class="fas ${starIcon}"></i> <span>${mediaRating}/5</span>`;
        } else {
            if (userBadge) userBadge.remove();
            if (hoverBadge) hoverBadge.remove();
        }
    });
};

window.refreshAllCardRatingBadges = function() {
    const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData?.activeProfileId);
    const ratingsMap = { ...(window.mediaRatingsCache || {}), ...(profile?.ratings || {}) };

    const cards = document.querySelectorAll('.discover-card, .card, .bento-wl-card, .continue-card, .media-card, .search-result-card, .show-card, .movie-card, .cw-card');
    cards.forEach(card => {
        const mediaId = card.getAttribute('data-id') || card.getAttribute('data-item-id') || card.dataset?.id || card.dataset?.itemId;
        if (!mediaId) return;
        const rating = parseFloat(ratingsMap[mediaId] || 0);
        window.updateCardRatingBadges(mediaId, rating);
    });
};

// Automatic Observer to attach user star ratings to dynamically rendered cards
if (typeof MutationObserver !== 'undefined' && !window._cardRatingObserver) {
    let _ratingDebounce = null;
    window._cardRatingObserver = new MutationObserver(() => {
        if (_ratingDebounce) clearTimeout(_ratingDebounce);
        _ratingDebounce = setTimeout(() => {
            if (typeof window.refreshAllCardRatingBadges === 'function') {
                window.refreshAllCardRatingBadges();
            }
        }, 150);
    });
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            const mainView = document.getElementById('main-content') || document.body;
            if (mainView) window._cardRatingObserver.observe(mainView, { childList: true, subtree: true });
        });
    } else {
        const mainView = document.getElementById('main-content') || document.body;
        if (mainView) window._cardRatingObserver.observe(mainView, { childList: true, subtree: true });
    }
}

function initDetailRatingWidget(mediaItem) {
    const widget = document.getElementById('dd-star-rating-widget');
    const ratingText = document.getElementById('dd-user-rating-text');
    if (!widget) return;

    const mediaKey = String(mediaItem?.id || mediaItem?.imdb_id || mediaItem?.imdbId || mediaItem?.path || '');
    const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData?.activeProfileId);
    let curRating = parseFloat((profile?.ratings && profile.ratings[mediaKey]) || (window.mediaRatingsCache && window.mediaRatingsCache[mediaKey]) || 0);

    const updateStars = (val, isHover = false) => {
        const stars = widget.querySelectorAll('.dd-star');
        stars.forEach(s => {
            const sVal = parseInt(s.getAttribute('data-val'), 10);
            const icon = s.querySelector('i');
            if (!icon) return;

            if (val >= sVal) {
                s.classList.add('active');
                icon.className = 'fas fa-star';
            } else if (val === sVal - 0.5) {
                s.classList.add('active');
                icon.className = 'fas fa-star-half-alt';
            } else {
                s.classList.remove('active');
                icon.className = 'fas fa-star';
            }
        });
        if (ratingText) {
            if (val > 0) {
                ratingText.textContent = `${val}/5`;
                ratingText.style.color = '#fbbf24';
            } else {
                ratingText.textContent = 'Rate';
                ratingText.style.color = 'rgba(255, 255, 255, 0.6)';
            }
        }
    };

    widget.setAttribute('data-rating', curRating);
    updateStars(curRating);

    const stars = widget.querySelectorAll('.dd-star');
    stars.forEach(s => {
        const sVal = parseInt(s.getAttribute('data-val'), 10);

        const calcRatingFromEvent = (e) => {
            const rect = s.getBoundingClientRect();
            const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);
            return isLeftHalf ? (sVal - 0.5) : sVal;
        };

        s.onmousemove = (e) => {
            const hoverVal = calcRatingFromEvent(e);
            updateStars(hoverVal, true);
        };

        s.onmouseleave = () => {
            const activeVal = parseFloat(widget.getAttribute('data-rating')) || 0;
            updateStars(activeVal);
        };

        s.onclick = async (e) => {
            e.stopPropagation();
            const clickVal = calcRatingFromEvent(e);
            widget.setAttribute('data-rating', clickVal);
            updateStars(clickVal);

            if (profile) {
                profile.ratings = profile.ratings || {};
                profile.ratings[mediaKey] = clickVal;
            }
            window.mediaRatingsCache = window.mediaRatingsCache || {};
            window.mediaRatingsCache[mediaKey] = clickVal;

            if (typeof window.persist === 'function') window.persist(true);

            if (window.bridge?.saveMediaRating) {
                window.bridge.saveMediaRating({
                    profileId: profile?.id || 'default',
                    userId: window.currentSession?.user?.id || null,
                    profileName: profile?.name || 'User',
                    mediaId: mediaKey,
                    mediaTitle: mediaItem.title || mediaItem.name || '',
                    rating: clickVal
                }).catch(err => console.warn('[Rating] save error:', err));
            }

            if (typeof showToast === 'function') {
                showToast(`Rated ${clickVal} ★`);
            }

            if (typeof window.updateCardRatingBadges === 'function') {
                window.updateCardRatingBadges(mediaKey, clickVal);
            }
        };
    });
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
    const isMetaActive = (typeof window.isMetadataProviderActive === 'function' && window.isMetadataProviderActive()) ||
                         ((window.appData?.tmdbKey || DEFAULT_TMDB_KEY) && window.appData?.tmdbEnabled !== false) ||
                         (window.appData?.installedAddons || []).some(a => (a.id || a.name || a.url || '').toLowerCase().includes('cinemeta'));
    const isLocalTV = isTV && item.episodes && item.episodes.length > 0;
    const showTmdbNotice = isLocalTV && !isMetaActive;

    container.innerHTML = `
        <div class="dd-container">
            <button class="dd-exit-fullscreen-btn" id="dd-exit-fullscreen-btn" type="button" style="display: none;">
                <i class="fas fa-eye"></i> Show UI
            </button>
            <div class="dd-backdrop-wrap">
                <img src="${backdropUrl || lowResBackdrop}" data-hi-res="${backdropUrl}" id="dd-backdrop-img" class="dd-backdrop-img">
                <div class="dd-backdrop-overlay"></div>
            </div>

            <!-- PC Side Panel (Episodes/Streams) -->
            <div class="dd-side-panel" id="dd-side-panel">
                <div class="dd-panel-header">
                    <h3 id="dd-panel-title">Episodes</h3>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn-streams-about" onclick="window.showStreamsAboutModal()" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; padding: 6px 12px; border-radius: 12px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s;" title="How Streams & Addons Work">
                            <i class="fas fa-info-circle" style="color: #ffffff;"></i> About
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
                    <button class="btn-streams-about" onclick="window.showStreamsAboutModal()" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; padding: 6px 12px; border-radius: 12px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;" title="How Streams & Addons Work">
                        <i class="fas fa-info-circle" style="color: #ffffff;"></i> About
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
                        <span class="dd-tag dd-runtime-tag" id="dd-duration" style="display:none;"></span>
                        <span class="dd-tag" id="dd-year">${(item.release_date || item.first_air_date || item.year || '').slice(0, 4) || '----'}</span>
                        <div id="dd-ratings-wrap" class="dd-ratings-wrap">
                            <span class="dd-rating-badge dd-rating-imdb" id="dd-rating">
                                <span class="dd-rating-val">★ ${(parseFloat(item.imdbRating || item.vote_average || item.rating) || 0).toFixed(1)}</span>
                                <span class="dd-rating-source">${item.source === 'tmdb' ? 'TMDB' : (item.imdbRating || String(item.id).startsWith('tt') ? 'IMDb' : 'Rating')}</span>
                            </span>
                        </div>
                    </div>

                    <div class="dd-user-rating-section" id="dd-user-rating-section">
                        <span class="dd-user-rating-label">RATE THIS</span>
                        <div class="dd-star-rating-widget" id="dd-star-rating-widget" data-rating="0" title="Click to rate (1 - 5 stars)">
                            <span class="dd-star" data-val="1"><i class="fas fa-star"></i></span>
                            <span class="dd-star" data-val="2"><i class="fas fa-star"></i></span>
                            <span class="dd-star" data-val="3"><i class="fas fa-star"></i></span>
                            <span class="dd-star" data-val="4"><i class="fas fa-star"></i></span>
                            <span class="dd-star" data-val="5"><i class="fas fa-star"></i></span>
                            <span class="dd-user-rating-text" id="dd-user-rating-text">Rate</span>
                        </div>
                    </div>

                    <div id="dd-extra-info" class="dd-pills-container"></div>

                    <div class="dd-summary-section">
                        <h4 class="dd-section-label">SUMMARY</h4>
                        <p id="dd-overview" class="dd-overview-text">${escapeHTML(item.overview || 'Loading details...')}</p>
                        <div class="dd-summary-actions" id="dd-summary-actions" style="display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                            <button class="dd-read-more-btn" id="dd-read-more-btn" type="button" style="display: none; margin-top: 0;">
                                <i class="fas fa-chevron-down"></i> Read More
                            </button>
                        </div>
                    </div>

                    ${showTmdbNotice ? `
                    <div class="tmdb-notice-banner" style="margin: 0 0 25px 0; padding: 18px 24px; background: #000000; border: 1.5px solid rgba(255, 255, 255, 0.45); border-radius: 16px; display: flex; align-items: center; justify-content: space-between; gap: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.95), 0 0 25px rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); max-width: 750px; transition: all 0.3s ease; flex-wrap: wrap;">
                        <div style="display: flex; gap: 15px; align-items: center; flex: 1; min-width: 280px;">
                            <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.08); border: 1.5px solid rgba(255, 255, 255, 0.7); display: flex; align-items: center; justify-content: center; color: #ffffff; box-shadow: 0 0 20px rgba(255, 255, 255, 0.15); flex-shrink: 0;">
                                <i class="fas fa-magic" style="font-size: 18px; color: #ffffff;"></i>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 3px; text-align: left;">
                                <div style="font-size: 14px; font-weight: 800; color: #ffffff; letter-spacing: 0.3px;">Install Cinemeta or Add TMDB API Key</div>
                                <div style="font-size: 12.5px; color: rgba(255, 255, 255, 0.75); line-height: 1.5; font-weight: 500;">
                                    Install the Cinemeta add-on or add your TMDB API key in Settings to automatically fetch episode posters and titles.
                                </div>
                            </div>
                        </div>
                        <button class="btn-primary" style="background: #ffffff; border: none; color: #000000; padding: 10px 22px; font-size: 12px; font-weight: 800; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.3s ease; box-shadow: 0 4px 20px rgba(255, 255, 255, 0.3); white-space: nowrap;" onclick="if(typeof window.closeUnifiedDetail === 'function') window.closeUnifiedDetail(); if(typeof window.switchView === 'function') window.switchView('settings');" onmouseover="this.style.background='#f4f4f5'; this.style.transform='translateY(-2px)';" onmouseout="this.style.background='#ffffff'; this.style.transform='none';">
                            <i class="fas fa-cog" style="color: #000000;"></i> <span style="color: #000000; font-weight: 800;">SETTINGS / ADDONS</span>
                        </button>
                    </div>
                    ` : ''}

                    <div class="dd-bottom-actions">
                        <button class="dd-btn-main primary-premium dd-action-pill" id="dd-play-btn-top" onclick="window.openEpisodes()">${isTV ? '<i class="fas fa-list-ol"></i> Show Episodes' : '<i class="fas fa-play-circle" style="font-size: 0.95rem;"></i> Watch Now'}</button>
                        <button class="dd-btn-main primary-premium dd-action-pill dd-yt-trailer-btn" id="dd-youtube-btn" type="button" title="Watch Trailer on YouTube" style="display: none;">
                            <i class="fab fa-youtube"></i> <span>Watch Trailer</span>
                        </button>
                        <div class="dd-list-dropdown">
                            <button class="dd-btn-main primary-premium dd-action-pill" id="btn-main-list" type="button"><i class="fas fa-plus-circle" style="font-size: 0.95rem;"></i> Add to Library</button>
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
                                        <button id="btn-submit-new-list" type="button" style="background: #ffffff; border: none; color: #000000; padding: 6px 14px; font-size: 11px; font-weight: 800; border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 10px rgba(255,255,255,0.2);">Create</button>
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                        <button class="dd-btn-main primary-premium dd-action-pill" id="dd-go-back-btn" type="button"><i class="fas fa-chevron-left"></i> Go Back</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Initialize interactive star rating widget
    if (typeof initDetailRatingWidget === 'function') {
        initDetailRatingWidget(item);
    }

    window.getTmdbIdStr = (i) => {
        if (!i) return null;
        let tid = i.tmdbId || i.tmdb_id;
        if (i.id && String(i.id).startsWith('tmdb:')) tid = String(i.id).replace('tmdb:', '');
        if (i.id && String(i.id).startsWith('kitsu:')) tid = null;
        return tid ? String(tid) : null;
    };

    const checkIsSameMedia = (a, b) => {
        if (!a || !b) return false;
        if (typeof window.isSameItem === 'function') return window.isSameItem(a, b);
        if (String(a.id) === String(b.id)) return true;
        const aImdb = a.imdb_id || a.imdbId || (String(a.id).startsWith('tt') ? a.id : null);
        const bImdb = b.imdb_id || b.imdbId || (String(b.id).startsWith('tt') ? b.id : null);
        if (aImdb && bImdb && aImdb === bImdb) return true;
        const aT = getTmdbIdStr(a);
        const bT = getTmdbIdStr(b);
        if (aT && bT && aT === bT) return true;
        const aK = a.kitsuId || a.kitsu_id || (String(a.id).startsWith('kitsu:') ? String(a.id).replace('kitsu:', '') : null);
        const bK = b.kitsuId || b.kitsu_id || (String(b.id).startsWith('kitsu:') ? String(b.id).replace('kitsu:', '') : null);
        if (aK && bK && String(aK) === String(bK)) return true;
        const tA = (a.title || a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const tB = (b.title || b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (tA && tB && tA === tB && tA.length >= 2) return true;
        return false;
    };

    const toggleItemInCustomList = (listId, targetItem) => {
        const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData.activeProfileId);
        if (!profile) return;
        
        const list = profile.custom_lists?.find(l => l.id === listId);
        if (!list) return;

        list.items = list.items || [];
        const index = list.items.findIndex(i => checkIsSameMedia(i, targetItem));

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
        if (typeof window.renderBentoWatchlist === 'function') window.renderBentoWatchlist();
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
        const isWatchlist = (profile?.watchlist || []).some(w => checkIsSameMedia(w, item));
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
        const customLists = (profile?.custom_lists || []).filter(l => l.type !== 'music');
        const activeCustomLists = customLists.filter(list =>
            list.items?.some(i => checkIsSameMedia(i, item))
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
            const customLists = (profile.custom_lists || []).filter(l => l.type !== 'music');

            if (customLists.length > 0) {
                const titleDiv = document.createElement('div');
                titleDiv.className = 'dd-menu-subtitle';
                titleDiv.style.cssText = 'padding: 6px 12px; font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 5px;';
                titleDiv.textContent = 'Collections';
                customListsContainer.appendChild(titleDiv);

                customLists.forEach(list => {
                    const inList = (list.items || []).some(i => checkIsSameMedia(i, item));

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
            img.style.filter = '';
            return;
        }

        const loader = new Image();
        loader.src = hiRes;
        loader.onload = () => {
            img.src = hiRes;
            img.classList.remove('dd-backdrop-loading');
            img.style.filter = '';
        };
        loader.onerror = () => {
            img.classList.remove('dd-backdrop-loading');
            img.style.filter = '';
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
    return new Promise(async (resolve) => {
        const { escapeHTML } = window;
        const isKitsu = item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || !!item.anime_id || !!item.mal_id || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));
        const isAnime = isKitsu ||
            item.isAnime ||
            !!item.mal_id ||
            !!item.anime_id ||
            (item.genre && String(item.genre).toLowerCase().includes('anime')) ||
            (item.genres && item.genres.some(g => String(g.name || g).toLowerCase().includes('anime'))) ||
            ((item.original_language === 'ja' || item.country === 'Japan' || (item.origin_country && item.origin_country.includes('JP')) || (tmdb?.origin_country && tmdb.origin_country.includes('JP')) || tmdb?.original_language === 'ja') &&
             (item.genre?.includes('Animation') || item.genres?.some(g => (g.name || g) === 'Animation' || g.id === 16) || tmdb?.genres?.some(g => g.name === 'Animation' || g.id === 16)));
        
        // Show IMDb badge for all media including anime
        const imdbBadge = document.getElementById('dd-imdb-badge');
        if (imdbBadge) {
            imdbBadge.style.display = 'inline-block';
        }

        const bdImg = document.getElementById('dd-backdrop') || document.getElementById('dd-backdrop-img');
        const logoImg = document.getElementById('dd-logo');
        const titleText = document.getElementById('dd-title');

        // 1. Determine best backdrop URLs
        let lowSrc = null;
        let highSrc = null;

        const kitsuBackdrop = item.backdrop_path || item.backdrop || extra1?.attributes?.coverImage || extra1?.backdrop_path || item.poster;
        const alBackdrop = anilist?.bannerImage;
        const bPath = tmdb?.backdrop_path || (isKitsu && alBackdrop ? alBackdrop : kitsuBackdrop);

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
            lowSrc = highSrc = alBackdrop;
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

        if (images && images.backgrounds && images.backgrounds.length > 0) {
            const bestBg = images.backgrounds[0];
            highSrc = bestBg.url;
            lowSrc = bestBg.url;
        }

        if (!highSrc && !lowSrc) {
            const fallbackPoster = item.poster_path || item.poster || tmdb?.poster_path || tmdb?.poster || extra1?.poster_path;
            if (fallbackPoster) {
                lowSrc = highSrc = window.getTMDBImageUrl(fallbackPoster, true);
            }
        }

        const targetBackdrop = highSrc || lowSrc || 'imgs/no-backdrop.png';

        // 2. Determine best logo URL
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

        // 3. Preload helper with hardware decode
        const preloadImage = (url) => {
            if (!url || url === 'imgs/no-backdrop.png') return Promise.resolve(null);
            const resolved = (typeof window.localImg === 'function') ? window.localImg(url) : url;
            return new Promise((res) => {
                const img = new Image();
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    if (typeof img.decode === 'function') {
                        img.decode().then(() => res(resolved)).catch(() => res(resolved));
                    } else {
                        res(resolved);
                    }
                };
                img.onload = finish;
                img.onerror = () => { done = true; res(null); };
                img.src = resolved;
                setTimeout(() => { if (!done) { done = true; res(resolved); } }, 3500);
            });
        };

        // Preload backdrop & logo in parallel before showing content
        const [loadedBackdrop, loadedLogo] = await Promise.all([
            preloadImage(targetBackdrop),
            logoUrl ? preloadImage(logoUrl) : Promise.resolve(null)
        ]);

        // Apply decoded backdrop
        if (bdImg) {
            bdImg.src = loadedBackdrop || targetBackdrop;
            bdImg.style.opacity = '1';
            bdImg.style.filter = '';
        }

        // Apply decoded logo or title fallback
        if (loadedLogo && logoImg) {
            logoImg.src = loadedLogo;
            logoImg.style.display = 'block';
            logoImg.style.opacity = '1';
            if (titleText) {
                titleText.style.display = 'none';
                titleText.style.opacity = '0';
            }
        } else {
            if (titleText) {
                titleText.style.display = 'block';
                titleText.style.opacity = '1';
            }
            if (logoImg) {
                logoImg.style.display = 'none';
                logoImg.style.opacity = '0';
            }
        }

    const metaContainer = document.getElementById('dd-meta');
    if (metaContainer) {
        // Multi-Source Ratings Rendering
        let ratingsWrap = document.getElementById('dd-ratings-wrap');
        if (!ratingsWrap) {
            ratingsWrap = document.createElement('div');
            ratingsWrap.id = 'dd-ratings-wrap';
            ratingsWrap.className = 'dd-ratings-wrap';
            const oldRatingEl = document.getElementById('dd-rating');
            if (oldRatingEl) {
                oldRatingEl.replaceWith(ratingsWrap);
            } else {
                metaContainer.prepend(ratingsWrap);
            }
        }
        ratingsWrap.innerHTML = '';

        let imdbScore = null;
        let tmdbScore = null;
        let malScore = null;
        let kitsuScore = null;

        // 1. IMDb Rating: check tmdb object, item, extra1
        const rawImdb = tmdb?.imdbRating || tmdb?.imdb_rating || extra1?.imdbRating || extra1?.imdb_rating || item.imdbRating || item.imdb_rating || (window.currentDetailItem?.imdbRating || window.currentDetailItem?.imdb_rating);
        if (rawImdb != null) {
            const v = parseFloat(rawImdb);
            if (!isNaN(v) && v > 0 && v <= 10) imdbScore = v;
        }

        // 2. TMDB Rating: check tmdb_rating, tmdbRating, or vote_average
        const rawTmdb = tmdb?.tmdb_rating || tmdb?.tmdbRating || item.tmdb_rating || item.tmdbRating || (item.source === 'tmdb' ? item.vote_average : null) || (tmdb?.vote_average && (!imdbScore || Math.abs(parseFloat(tmdb.vote_average) - imdbScore) > 0.01 || tmdb.vote_count) ? tmdb.vote_average : null);
        if (rawTmdb != null) {
            const v = parseFloat(rawTmdb);
            if (!isNaN(v) && v > 0 && v <= 10) tmdbScore = v;
        }

        // 3. Anime (MAL & Kitsu)
        const isStrictAnime = isAnime || isKitsu || !!item.mal_id || !!item.anime_id || (item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || item.source === 'anilist');
        if (isStrictAnime) {
            const rawMal = tmdb?.malScore || tmdb?.mal_rating || tmdb?.mal_score || extra1?.score || extra1?.rating || item.malScore || item.mal_rating || anilist?.score || (anilist?.averageScore ? anilist.averageScore / 10 : null);
            if (rawMal != null) {
                const v = parseFloat(rawMal);
                if (!isNaN(v) && v > 0 && v <= 10) malScore = v;
            }

            const rawKitsu = extra1?.attributes?.averageRating || extra1?.averageRating;
            if (rawKitsu != null) {
                const v = parseFloat(rawKitsu);
                if (!isNaN(v) && v > 0) {
                    kitsuScore = v > 10 ? v / 10 : v;
                }
            }
        }

        // Build array of badges to show
        const badgesToRender = [];

        if (imdbScore != null) {
            badgesToRender.push({
                source: 'IMDb',
                score: imdbScore.toFixed(1),
                cls: 'dd-rating-imdb',
                title: 'IMDb Rating'
            });
        }

        if (malScore != null && !badgesToRender.some(b => b.source === 'MAL')) {
            badgesToRender.push({
                source: 'MAL',
                score: malScore.toFixed(1),
                cls: 'dd-rating-mal',
                title: 'MyAnimeList Community Score'
            });
        }

        if (kitsuScore != null && !badgesToRender.some(b => b.source === 'Kitsu')) {
            badgesToRender.push({
                source: 'Kitsu',
                score: kitsuScore.toFixed(1),
                cls: 'dd-rating-kitsu',
                title: 'Kitsu Community Score'
            });
        }

        // Fallback if none resolved
        if (badgesToRender.length === 0) {
            const fallbackVal = parseFloat(item.rating || item.vote_average || tmdb?.rating || 0);
            if (!isNaN(fallbackVal) && fallbackVal > 0) {
                badgesToRender.push({
                    source: isAnime ? 'Score' : 'Rating',
                    score: fallbackVal.toFixed(1),
                    cls: 'dd-rating-imdb',
                    title: 'Rating'
                });
            } else {
                badgesToRender.push({
                    source: 'Rating',
                    score: 'N/A',
                    cls: 'dd-rating-imdb',
                    title: 'No Rating Available'
                });
            }
        }

        const safeEscape = (str) => {
            if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        badgesToRender.forEach(b => {
            const badge = document.createElement('span');
            badge.className = `dd-rating-badge ${b.cls}`;
            badge.title = b.title;
            badge.innerHTML = `
                <span class="dd-rating-source">${safeEscape(b.source)}</span>
                <span class="dd-rating-val">★ ${b.score}</span>
            `;
            ratingsWrap.appendChild(badge);
        });

        const kitsuYear = String(extra1?.year || extra1?.releaseInfo || item.release_date || item.first_air_date || item.releaseYear || '').slice(0, 4);
        const year = (isKitsu && kitsuYear) ? kitsuYear : String(tmdb?.release_date || tmdb?.first_air_date || tmdb?.year || tmdb?.released || kitsuYear || '----').slice(0, 4);
        const runtime = tmdb?.runtime || (tmdb?.episode_run_time ? tmdb?.episode_run_time[0] : null) || extra1?.runtime;
        
        const yearEl = document.getElementById('dd-year');
        if (yearEl) {
            if (isKitsu) {
                yearEl.textContent = kitsuYear || '----';
            } else {
                const displayYear = tmdb?.first_air_date ? `${year}-${String(tmdb.last_air_date || '').slice(0,4)}` : (tmdb?.year || tmdb?.released || year || '----');
                yearEl.textContent = displayYear;
            }
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
        
        // Hide yellow hardcoded IMDb badge
        const imdbBadge = document.getElementById('dd-imdb-badge');
        if (imdbBadge) imdbBadge.style.display = 'none';

        // Clear any previous badges
        Array.from(metaContainer.querySelectorAll('.dd-rating-tag-age')).forEach(e => e.remove());
        Array.from(metaContainer.querySelectorAll('.dd-id-tag')).forEach(e => e.remove());
        Array.from(metaContainer.querySelectorAll('.dd-meta-badges-column')).forEach(e => e.remove());
    }

    const extraInfo = document.getElementById('dd-extra-info');
    if (extraInfo) {
        extraInfo.innerHTML = '';
        const allGenres = extractAllGenres(item, tmdb, extra1, anilist);
        if (allGenres.length > 0) {
            extraInfo.appendChild(createPillGroup('GENRES', allGenres));
        }

        // Extract Studios / Producers
        let studioList = [];
        if (tmdb?.production_companies && Array.isArray(tmdb.production_companies)) {
            studioList = tmdb.production_companies.slice(0, 5).map(c => c.name).filter(Boolean);
        } else if (extra1?.production_companies && Array.isArray(extra1.production_companies)) {
            studioList = extra1.production_companies.slice(0, 5).map(c => c.name).filter(Boolean);
        } else if (anilist?.studios?.nodes && Array.isArray(anilist.studios.nodes)) {
            studioList = anilist.studios.nodes.slice(0, 5).map(s => s.name).filter(Boolean);
        }

        let castList = [];
        if (tmdb?.credits?.cast && Array.isArray(tmdb.credits.cast)) {
            castList = tmdb.credits.cast.slice(0, 6).map(c => c.name || c.original_name).filter(Boolean);
        } else if (extra1?.cast && Array.isArray(extra1.cast)) {
            castList = extra1.cast.slice(0, 6).map(c => typeof c === 'string' ? c : (c.name || '')).filter(Boolean);
        } else if (item.cast && Array.isArray(item.cast)) {
            castList = item.cast.slice(0, 6).map(c => typeof c === 'string' ? c : (c.name || '')).filter(Boolean);
        } else if (anilist?.characters?.edges && Array.isArray(anilist.characters.edges)) {
            castList = anilist.characters.edges.slice(0, 6).map(e => e.node?.name?.userPreferred || e.node?.name?.full).filter(Boolean);
        }

        const finalStudiosProducers = studioList.length > 0 ? studioList : castList;
        if (finalStudiosProducers.length > 0) {
            extraInfo.appendChild(createPillGroup('STUDIOS & PRODUCERS', finalStudiosProducers));
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
            overview.classList.remove('expanded');
            const readMoreBtn = summarySec.querySelector('#dd-read-more-btn');
            if (readMoreBtn) {
                readMoreBtn.style.display = 'none';
                readMoreBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Read More';
            }

            // Only show "Read More" button if text actually overflows the clamped box
            requestAnimationFrame(() => {
                const isOverflowing = overview.scrollHeight > overview.clientHeight + 2;
                if (isOverflowing && readMoreBtn) {
                    readMoreBtn.style.display = 'inline-flex';
                    readMoreBtn.onclick = (e) => {
                        e.stopPropagation();
                        const isExpanded = overview.classList.toggle('expanded');
                        readMoreBtn.innerHTML = isExpanded
                            ? '<i class="fas fa-chevron-up"></i> Read Less'
                            : '<i class="fas fa-chevron-down"></i> Read More';
                    };
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
            const tmdbKey = window.appData?.tmdbKey || '4e44d9029b1270a757cddc766a1bcb63';
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
    const fetchTmdbSeasonStills = prefetchTmdbSeasonStills;

    const renderEpisodeSkeletons = (count = 6) => {
        return Array.from({ length: count }).map(() => `
            <div class="dd-ep-skeleton-card">
                <div class="dd-ep-skeleton-thumb"></div>
                <div class="dd-ep-skeleton-info">
                    <div class="dd-ep-skeleton-title"></div>
                    <div class="dd-ep-skeleton-date"></div>
                </div>
            </div>
        `).join('');
    };

    // Apply fetched stills and ratings to already-rendered episode cards
    const applyTmdbStillsToCards = (listEl, stillsMap, seasonN) => {
        if (!stillsMap || !Object.keys(stillsMap).length || !listEl) return;
        let cards = seasonN != null ? listEl.querySelectorAll(`.dd-ep-card[data-season="${seasonN}"]`) : listEl.querySelectorAll('.dd-ep-card');
        if (!cards || cards.length === 0) cards = listEl.querySelectorAll('.dd-ep-card');
        cards.forEach(card => {
            const epN = parseInt(card.dataset.episode);
            const entry = stillsMap[epN];
            if (!entry) return;
            const imdbRating = typeof entry === 'object' ? (entry.imdbRating || entry.imdb_rating) : null;
            const voteAverage = typeof entry === 'object' ? entry.vote_average : null;
            const chosenRating = (imdbRating && parseFloat(imdbRating) > 0) ? imdbRating : voteAverage;
            const epName = typeof entry === 'object' ? entry.name : null;
            const stillUrl = typeof entry === 'string' ? entry : (entry?.still_path || entry?.stillPath || entry?.still || entry?.stillUrl || entry?.still_url);

            if (stillUrl) {
                const img = card.querySelector('img');
                const epImgDiv = card.querySelector('.dd-ep-img');
                if (img && img.isConnected) {
                    const fullStill = stillUrl.startsWith('http') ? stillUrl : `https://image.tmdb.org/t/p/w400${stillUrl}`;
                    if (img.src !== fullStill) {
                        const preload = new Image();
                        preload.onload = () => {
                            if (img && img.isConnected) {
                                img.src = fullStill;
                                img.classList.add('is-ready');
                                if (epImgDiv) epImgDiv.classList.add('img-loaded');
                            }
                        };
                        preload.src = fullStill;
                    }
                }
            }

            if (chosenRating && parseFloat(chosenRating) > 0) {
                const metaRow = card.querySelector('.dd-ep-meta-row');
                if (metaRow) {
                    let rEl = card.querySelector('.dd-ep-rating');
                    if (!rEl || (imdbRating && parseFloat(imdbRating) > 0) || !rEl.dataset.hasImdb) {
                        if (!rEl) {
                            rEl = document.createElement('span');
                            rEl.className = 'dd-ep-rating';
                            rEl.style.cssText = 'display:inline-flex;align-items:center;gap:3px;background:rgba(245,197,24,0.18);color:#F5C518;font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px;margin-left:auto;letter-spacing:0.3px;';
                            metaRow.appendChild(rEl);
                        }
                        if (imdbRating && parseFloat(imdbRating) > 0) {
                            rEl.dataset.hasImdb = 'true';
                        }
                        rEl.innerHTML = `<i class="fas fa-star" style="font-size:8px;"></i>${parseFloat(chosenRating).toFixed(1)}`;
                    }
                }
            }

            if (epName && !epName.toLowerCase().startsWith('episode')) {
                const nameEl = card.querySelector('.dd-ep-name');
                if (nameEl && !nameEl.textContent.includes(epName)) {
                    const formatted = `EP ${epN} • ${epName}`;
                    nameEl.textContent = formatted;
                    nameEl.title = formatted;
                }
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
        const batchSize = 30;
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
                // Snappy micro-stagger for the first few cards (max 0.09s total), instant for the rest
                card.style.animationDelay = (currentIdx === 0 && i < 6) ? `${i * 0.015}s` : '0s';
                card.onclick = () => window.selectUnifiedEpisode(currentSeason, epNum, finalTitle, epThumb || '', v.path || '');

                const epImgDiv = document.createElement('div');
                epImgDiv.className = 'dd-ep-img';

                const imgEl = document.createElement('img');
                imgEl.loading = 'lazy';
                imgEl.decoding = 'async';
                imgEl.alt = finalTitle;

                imgEl.onload = () => {
                    imgEl.classList.add('is-ready');
                    epImgDiv.classList.add('img-loaded');
                };

                imgEl.onerror = () => {
                    imgEl.onerror = null;
                    imgEl.src = isUnreleased ? 'imgs/no-backdrop.png' : (currentItem.backdrop_path || currentItem.poster_path || 'imgs/no-backdrop.png');
                    imgEl.classList.add('is-ready');
                    epImgDiv.classList.add('img-loaded');
                };

                imgEl.src = thumbUrl;
                if (imgEl.complete && imgEl.naturalWidth > 0) {
                    imgEl.classList.add('is-ready');
                    epImgDiv.classList.add('img-loaded');
                }

                epImgDiv.appendChild(imgEl);

                const epNumDiv = document.createElement('div');
                epNumDiv.className = 'dd-ep-number';
                epNumDiv.textContent = `EP ${epNum}`;
                epImgDiv.appendChild(epNumDiv);

                if (isUnreleased) {
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#fff;letter-spacing:1px;z-index:3;';
                    overlay.textContent = 'UPCOMING';
                    epImgDiv.appendChild(overlay);
                }

                // Check playback progress & watched state for this episode
                const profile = window.currentProfile || window.appData?.profiles?.find(p => p.id === window.appData?.activeProfileId);
                const pb = profile?.playback || {};
                const mainId = String(currentItem?.id || currentItem?.imdb_id || currentItem?.tmdbId || '');
                const cleanImdb = (currentItem?.imdb_id || currentItem?.imdbId || '').replace(/^tt/, '');

                const possibleKeys = [
                    `${mainId}_S${currentSeason}E${epNum}`,
                    `${mainId}_s${currentSeason}e${epNum}`,
                    `${mainId}_E${epNum}`,
                    `tt${cleanImdb}_S${currentSeason}E${epNum}`,
                    `tt${cleanImdb}_E${epNum}`,
                    v.path
                ].filter(Boolean);

                let pbData = null;
                for (const k of possibleKeys) {
                    if (pb[k] && (pb[k].duration > 0 || pb[k].time > 0)) {
                        pbData = pb[k];
                        break;
                    }
                }
                if (!pbData) {
                    for (const [k, d] of Object.entries(pb)) {
                        if (!d) continue;
                        const meta = d.meta || {};
                        if (
                            (meta.showId === mainId || meta.id === mainId || (cleanImdb && String(k).includes(cleanImdb))) &&
                            (meta.episode == epNum) &&
                            (meta.season == currentSeason || !meta.season || currentSeason == 1)
                        ) {
                            pbData = d;
                            break;
                        }
                    }
                }

                if (pbData) {
                    const time = pbData.time || 0;
                    const dur = pbData.duration || 1;
                    const pct = dur > 0 ? Math.min(100, Math.max(0, (time / dur) * 100)) : 0;
                    const isWatched = pbData.watched || pct >= 85;

                    if (isWatched) {
                        const watchedBadge = document.createElement('div');
                        watchedBadge.className = 'dd-ep-watched-badge';
                        watchedBadge.title = 'Watched';
                        watchedBadge.innerHTML = '<i class="fas fa-check"></i>';
                        epImgDiv.appendChild(watchedBadge);

                        const progressBar = document.createElement('div');
                        progressBar.className = 'dd-ep-progress-bar';
                        progressBar.innerHTML = '<div class="dd-ep-progress-fill" style="width: 100%;"></div>';
                        epImgDiv.appendChild(progressBar);
                    } else if (pct >= 2) {
                        const progressBar = document.createElement('div');
                        progressBar.className = 'dd-ep-progress-bar';
                        progressBar.innerHTML = `<div class="dd-ep-progress-fill" style="width: ${pct.toFixed(1)}%;"></div>`;
                        epImgDiv.appendChild(progressBar);
                    }
                }

                const hasRealImdb = (v.imdbRating != null && parseFloat(v.imdbRating) > 0) || (v.imdb_rating != null && parseFloat(v.imdb_rating) > 0);
                const rawVote = (v.imdbRating != null && parseFloat(v.imdbRating) > 0)
                    ? v.imdbRating
                    : (v.imdb_rating != null && parseFloat(v.imdb_rating) > 0)
                        ? v.imdb_rating
                        : (v.rating != null && parseFloat(v.rating) > 0)
                            ? v.rating
                            : v.vote_average;
                const epRating = parseFloat(rawVote);
                const ratingHtml = (!isNaN(epRating) && epRating > 0)
                    ? `<span class="dd-ep-rating" ${hasRealImdb ? 'data-has-imdb="true"' : ''} style="display:inline-flex;align-items:center;gap:3px;background:rgba(245,197,24,0.15);color:#F5C518;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:auto;"><i class="fas fa-star" style="font-size:8px;"></i>${epRating.toFixed(1)}</span>`
                    : '';

                const formattedTitle = (finalTitle && !finalTitle.toLowerCase().startsWith('episode') && finalTitle !== String(epNum))
                    ? `EP ${epNum} • ${finalTitle}`
                    : (finalTitle || `Episode ${epNum}`);

                const infoDiv = document.createElement('div');
                infoDiv.className = 'dd-ep-info';
                infoDiv.innerHTML = `
                    <div class="dd-ep-name" title="${(window.escapeHTML || (s=>s))(formattedTitle)}">${(window.escapeHTML || (s=>s))(formattedTitle)}</div>
                    <div class="dd-ep-meta-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;">
                        <span class="dd-ep-date" style="font-size:11px;color:rgba(255,255,255,0.5);">${displayDate}</span>
                        ${ratingHtml}
                    </div>
                `;

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
                        } else {
                            fetchTmdbSeasonStills(sid, seasonNum).then(stillsMap => applyTmdbStillsToCards(listEl, stillsMap, seasonNum));
                        }
                    }).catch(() => {
                        fetchTmdbSeasonStills(sid, seasonNum).then(stillsMap => applyTmdbStillsToCards(listEl, stillsMap, seasonNum));
                    });
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

        const item = window.currentUnifiedDetailItem || window.currentDetailItem;
        const checkIsSameMedia = window.checkIsSameMedia || ((a, b) => a && b && String(a.id) === String(b.id));
        const toggleItemInCustomList = window.toggleItemInCustomList || (() => {});
        const createNewCustomList = (name, itemToAdd) => {
            if (typeof window.createNewCustomList === 'function') {
                window.createNewCustomList(name, itemToAdd);
            }
        };

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
                    <button id="panel-btn-create-list" style="background: #ffffff; border: none; color: #000000; padding: 10px 18px; font-size: 13px; font-weight: 800; border-radius: 10px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 15px rgba(255, 255, 255, 0.25);">Create</button>
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
            inWatchlist = (profile.watchlist || []).filter(Boolean).some(w => checkIsSameMedia(w, item));
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
                return (list.items || []).filter(Boolean).some(i => checkIsSameMedia(i, item));
            } catch (e) {
                console.error('[ListsPanel] Error checking inCustomList:', e);
                return false;
            }
        };

        const lists = [
            { id: 'watchlist', name: 'My List (Watching)', items: (profile.watchlist || []).filter(Boolean), isSpecial: true },
            { id: 'watched', name: 'Watched', items: [], isSpecial: true },
            ...(profile.custom_lists || []).filter(Boolean).filter(l => l.type !== 'music' && l.type !== 'song' && l.type !== 'audio')
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
        if (!isTV && window.appData && window.appData.autoChooseBestStream) {
            // For movies with Smart Auto-Play: Do NOT open the side panel UI at all.
            // Search streams in background and directly launch the player with the best stream.
            const resolvedImdb = item.imdb_id || item.imdbId || window.currentDetailItem?.imdb_id || window.currentDetailItem?.imdbId || window.currentUnifiedDetailItem?.imdb_id || window.currentUnifiedDetailItem?.imdbId || null;
            const payload = {
                ...window.currentDetailItem,
                ...item,
                imdb_id: resolvedImdb,
                imdbId: resolvedImdb
            };
            if (typeof window.loadStreams === 'function') {
                window.loadStreams(payload, 'movie');
            }
            return;
        }

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
                
                const offlineEps = item.episodes.map(ep => ({
                    episode: ep.episode,
                    episode_number: ep.episode,
                    season: ep.season || 1,
                    name: ep.title || `Episode ${ep.episode}`,
                    still_path: null,
                    air_date: null,
                    path: ep.path
                }));

                // Render local episodes immediately with zero waiting!
                renderEpisodesInBatches(listEl, offlineEps, offlineEps[0]?.season || 1, false);

                // Fetch episode details / thumbnails asynchronously and enrich the list in background
                (async () => {
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

                        const isAnime = false;
                        let apiEpisodes = null;

                        const tmdbKey = window.appData?.tmdbKey || DEFAULT_TMDB_KEY;
                        const tmdbEnabled = window.appData?.tmdbEnabled !== false;

                        if (tmdbKey && tmdbEnabled && (imdbId || tmdbId)) {
                            try {
                                if (imdbId && !tmdbId) {
                                    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
                                    const findRes = await fetch(findUrl).then(r => r.json()).catch(() => null);
                                    if (findRes && findRes.tv_results && findRes.tv_results.length > 0) {
                                        tmdbId = findRes.tv_results[0].id;
                                    }
                                }

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
                                                still_path: ep.still_path ? `https://image.tmdb.org/t/p/w400${ep.still_path}` : null,
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

                        if (apiEpisodes && apiEpisodes.length > 0) {
                            const stillsMap = {};
                            const titlesMap = {};
                            apiEpisodes.forEach(ae => {
                                if (ae.still_path) stillsMap[ae.episode] = ae.still_path;
                                if (ae.name) titlesMap[ae.episode] = ae.name;
                            });
                            applyTmdbStillsToCards(listEl, stillsMap, offlineEps[0]?.season || 1);

                            // Smoothly update titles if they were generic
                            const cards = listEl.querySelectorAll(`.dd-ep-card[data-season="${offlineEps[0]?.season || 1}"]`);
                            cards.forEach(card => {
                                const epN = parseInt(card.dataset.episode);
                                const newTitle = titlesMap[epN];
                                if (newTitle) {
                                    const titleEl = card.querySelector('.dd-ep-name');
                                    if (titleEl && (titleEl.textContent.startsWith('Episode') || !titleEl.textContent.trim())) {
                                        titleEl.textContent = newTitle;
                                    }
                                }
                            });
                        }
                    } catch (err) {
                        console.error('[DETAIL] Failed to enrich local episodes metadata:', err);
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

                // Enrich anime episodes with TMDB stills and ratings
                const targetLookupId = item?.tmdb_id || item?.tmdbId || item?.imdb_id || item?.imdbId || item?.title || item?.name || extra1?.name || item?.id;
                window.api.invoke('tmdb-season-details', targetLookupId, 1).then(tmdbData => {
                    if (tmdbData && tmdbData.episodes && tmdbData.episodes.length > 0) {
                        const map = {};
                        tmdbData.episodes.forEach(te => {
                            map[te.episode_number] = {
                                still: te.still_path,
                                vote_average: te.vote_average || te.rating,
                                name: te.name
                            };
                        });
                        applyTmdbStillsToCards(listEl, map, 1);
                    }
                }).catch(() => {});
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

                    // Enrich anime episodes with TMDB stills and ratings
                    const targetLookupId = item?.tmdb_id || item?.tmdbId || item?.imdb_id || item?.imdbId || item?.title || item?.name || kitsuData?.name || malId;
                    window.api.invoke('tmdb-season-details', targetLookupId, 1).then(tmdbData => {
                        if (tmdbData && tmdbData.episodes && tmdbData.episodes.length > 0) {
                            const map = {};
                            tmdbData.episodes.forEach(te => {
                                map[te.episode_number] = {
                                    still: te.still_path,
                                    vote_average: te.vote_average || te.rating,
                                    name: te.name
                                };
                            });
                            applyTmdbStillsToCards(listEl, map, 1);
                        }
                    }).catch(() => {});
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
                            <div style="display: flex; align-items: center; justify-content: flex-start; margin-bottom: 12px;">
                                <button class="dd-panel-back-to-ep" onclick="window.backToEpisodes()"><i class="fas fa-chevron-left"></i> Back to Episodes</button>
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
            const resolvedImdb = item.imdb_id || item.imdbId || window.currentDetailItem?.imdb_id || window.currentDetailItem?.imdbId || window.currentUnifiedDetailItem?.imdb_id || window.currentUnifiedDetailItem?.imdbId || null;
            const payload = {
                ...window.currentDetailItem,
                ...item,
                imdb_id: resolvedImdb,
                imdbId: resolvedImdb
            };
            window.loadStreams(payload, 'movie');
        }
    };

    window.loadUnifiedEpisodes = async (tvId, seasonNum, isKitsu = false, isJikan = false) => {
        const list = document.getElementById('dd-unified-ep-list');
        if (list) {
            list.style.display = 'flex';
        }
        const streamContainer = document.getElementById('dd-streams-container-unified');
        if (streamContainer) streamContainer.style.display = 'none';

        if (isJikan) {
            if (list) list.innerHTML = renderEpisodeSkeletons(6);
            const data = await window.api.invoke('jikan-episodes', tvId);
            if (data && data.data) {
                const listEl = document.getElementById('dd-unified-ep-list');
                if (!listEl) return;
                const formatted = data.data.map(ep => ({
                    episode_number: ep.mal_id,
                    season_number: 1,
                    name: ep.title || `Episode ${ep.mal_id}`,
                    still_path: ep.images?.jpg?.image_url || null,
                    air_date: ep.aired
                }));
                renderEpisodesInBatches(listEl, formatted, 1, false);
            } else {
                if (document.getElementById('dd-unified-ep-list')) {
                    document.getElementById('dd-unified-ep-list').innerHTML = '<div style="padding: 20px; color: var(--text-muted);">No episodes found.</div>';
                }
            }
            return;
        }

        if (isKitsu) {
            if (list) list.innerHTML = renderEpisodeSkeletons(6);
            const data = await window.api.invoke('kitsu-details', tvId);
            // track which Kitsu season/anime id we loaded episodes for
            try { window._lastUnifiedKitsuSeasonId = String(tvId).replace('kitsu:', ''); } catch (e) { window._lastUnifiedKitsuSeasonId = tvId; }
            if (data && data.videos) {
                const listEl = document.getElementById('dd-unified-ep-list');
                if (!listEl) return;
                renderEpisodesInBatches(listEl, data.videos, 1, true);

                // Enrich with TMDB in background for stills and ratings
                const targetTvId = data.tmdb_id || window.currentDetailItem?.tmdb_id || window.currentDetailItem?.tmdbId || window.currentDetailItem?.title || window.currentDetailItem?.name || data?.name || tvId;
                const activeSeason = data.seasons?.find(s => String(s.id) === String(tvId).replace('kitsu:', '')) || data.seasons?.find(s => s.active);
                const tmdbSeasonNum = activeSeason ? activeSeason.season_number : 1;
                window.api.invoke('tmdb-season-details', targetTvId, tmdbSeasonNum).then(tmdbData => {
                    if (tmdbData && tmdbData.episodes && tmdbData.episodes.length > 0) {
                        const map = {};
                        tmdbData.episodes.forEach(te => {
                            map[te.episode_number] = {
                                still: te.still_path,
                                imdbRating: te.imdbRating || te.imdb_rating || null,
                                vote_average: te.imdbRating || te.imdb_rating || te.vote_average || te.rating,
                                name: te.name
                            };
                        });
                        applyTmdbStillsToCards(listEl, map, 1);
                    }
                }).catch(() => {});
            }
            return;
        }

        // ── Normal Series (TMDB / Cinemeta) ──
        // 1. Instant Render: check if this season's episodes already exist in memory from Cinemeta!
        let instantEpisodes = null;
        if (window._lastTmdbData && Array.isArray(window._lastTmdbData.videos)) {
            const seasonVids = window._lastTmdbData.videos.filter(v => Number(v.season) === Number(seasonNum));
            if (seasonVids.length > 0) {
                instantEpisodes = seasonVids.map(v => ({
                    episode_number: v.episode,
                    season_number: v.season,
                    name: v.title || v.name || `Episode ${v.episode}`,
                    still_path: v.thumbnail || v.still || v.still_path || v.image || null,
                    air_date: v.released || null,
                    imdbRating: v.imdbRating || v.rating || 0,
                    imdb_rating: v.imdbRating || v.rating || 0,
                    vote_average: v.imdbRating || v.rating || v.vote_average || 0
                }));
            }
        }

        if (instantEpisodes && instantEpisodes.length > 0 && list) {
            // Render immediately with ZERO waiting for network!
            renderEpisodesInBatches(list, instantEpisodes, seasonNum, false);

            // In background, fetch TMDB season details to enrich stills and update cards smoothly
            window.api.invoke('tmdb-season-details', tvId, seasonNum).then(res => {
                if (res && res.episodes && res.episodes.length > 0) {
                    const map = {};
                    res.episodes.forEach(ep => {
                        map[ep.episode_number] = {
                            still: ep.still_path,
                            imdbRating: ep.imdbRating || ep.imdb_rating || null,
                            vote_average: ep.imdbRating || ep.imdb_rating || ep.vote_average || ep.rating,
                            name: ep.name
                        };
                    });
                    applyTmdbStillsToCards(list, map, seasonNum);
                }
            }).catch(() => {});
            return;
        }

        // 2. Not cached in memory yet: show realistic skeleton cards while fetching
        if (list) {
            list.innerHTML = renderEpisodeSkeletons(6);
        }

        let data = await window.api.invoke('tmdb-season-details', tvId, seasonNum).catch(() => null);
        
        if ((!data || !data.episodes || data.episodes.length === 0) && window._lastTmdbData && window._lastTmdbData.videos) {
            const seasonVids = window._lastTmdbData.videos.filter(v => Number(v.season) === Number(seasonNum));
            if (seasonVids.length > 0) {
                data = { episodes: seasonVids.map(v => ({
                    episode_number: v.episode,
                    season_number: v.season,
                    name: v.title || v.name || `Episode ${v.episode}`,
                    still_path: v.thumbnail,
                    air_date: v.released
                })) };
            }
        }

        if (!data || !data.episodes || data.episodes.length === 0) {
            const currentItemObj = window.currentDetailItem || window.currentUnifiedDetailItem || item;
            const malId = currentItemObj?.mal_id || currentItemObj?.malId || (String(currentItemObj?.id || '').startsWith('mal:') ? String(currentItemObj.id).replace('mal:', '') : null);
            if (malId) {
                const jikanData = await window.api.invoke('jikan-episodes', malId).catch(() => null);
                if (jikanData && jikanData.data && jikanData.data.length > 0) {
                    data = { episodes: jikanData.data.map(ep => ({
                        episode_number: ep.mal_id,
                        season_number: 1,
                        name: ep.title || `Episode ${ep.mal_id}`,
                        still_path: ep.images?.jpg?.image_url,
                        air_date: ep.aired
                    })) };
                }
            }
        }

        if (data && data.episodes && data.episodes.length > 0) {
            const listEl = document.getElementById('dd-unified-ep-list');
            if (listEl) renderEpisodesInBatches(listEl, data.episodes, seasonNum, false);
        } else {
            if (document.getElementById('dd-unified-ep-list')) {
                document.getElementById('dd-unified-ep-list').innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">No episodes found.</div>';
            }
        }
    };

    window.selectUnifiedEpisode = (season, episode, name, thumbnail, path = '') => {
        let thumbUrl = thumbnail;
        if (thumbnail && !thumbnail.startsWith('http')) {
            thumbUrl = window.getTMDBImageUrl(thumbnail, true);
        }
        // If we previously loaded a Kitsu season, prefer that kitsu id for searching streams
        const kitsuSeasonId = window._lastUnifiedKitsuSeasonId || window.currentDetailItem?.kitsuId || null;
        const currentItemObj = window.currentDetailItem || window.currentUnifiedDetailItem || item;
        const resolvedImdb = currentItemObj?.imdb_id || currentItemObj?.imdbId || item?.imdb_id || item?.imdbId || window._lastTmdbData?.imdb_id || null;
        const payload = {
            ...currentItemObj,
            ...item,
            imdb_id: resolvedImdb,
            imdbId: resolvedImdb,
            season,
            episode,
            epTitle: name,
            thumbnail: thumbUrl,
            media_type: 'tv'
        };
        if (kitsuSeasonId) payload.kitsuId = String(kitsuSeasonId).replace('kitsu:', '');
        if (path) {
            payload.path = path;
        }
        const streamType = (currentItemObj?.source === 'jikan' || currentItemObj?.source === 'mal' || currentItemObj?.source === 'kitsu' || payload.kitsuId) ? 'anime' : 'tv';

        if (!window.appData || !window.appData.autoChooseBestStream) {
            const list = document.getElementById('dd-unified-ep-list');
            const streamContainer = document.getElementById('dd-streams-container-unified');
            if (list) list.style.display = 'none';
            if (streamContainer) streamContainer.style.display = 'block';
        } else {
            if (window.showToast) window.showToast(`Finding best stream for Episode ${episode}...`);
        }

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
    const rawList = [];
    const rawCandidates = [
        anilist?.genres,
        extra1?.genres,
        extra1?.genre,
        tmdb?.genres,
        tmdb?.genre,
        item?.genres,
        item?.genre
    ];

    const normalizeGenre = (str) => {
        if (!str || typeof str !== 'string') return null;
        let s = str.trim();
        if (!s || s.length <= 1) return null;
        
        // Handle common splits & combined names
        if (s.toLowerCase() === 'sci-fi & fantasy' || s.toLowerCase() === 'scifi & fantasy') {
            return ['Sci-Fi', 'Fantasy'];
        }
        if (s.toLowerCase() === 'action & adventure') {
            return ['Action', 'Adventure'];
        }
        if (s.toLowerCase() === 'war & politics') {
            return ['War', 'Politics'];
        }
        
        // Capitalize words nicely
        s = s.replace(/\b\w/g, l => l.toUpperCase());
        if (s.toLowerCase() === 'sci-fi' || s.toLowerCase() === 'science fiction') s = 'Sci-Fi';
        if (s.toLowerCase() === 'tv movie') s = 'TV Movie';
        return [s];
    };

    rawCandidates.forEach(candidate => {
        if (!candidate) return;
        if (Array.isArray(candidate)) {
            candidate.forEach(g => {
                if (!g) return;
                if (typeof g === 'string') {
                    g.split(/[,/|]/).forEach(sub => {
                        const norm = normalizeGenre(sub);
                        if (norm) rawList.push(...norm);
                    });
                } else if (typeof g === 'object' && (g.name || g.label)) {
                    const norm = normalizeGenre(g.name || g.label);
                    if (norm) rawList.push(...norm);
                }
            });
        } else if (typeof candidate === 'string') {
            candidate.split(/[,/|]/).forEach(sub => {
                const norm = normalizeGenre(sub);
                if (norm) rawList.push(...norm);
            });
        }
    });

    // Deduplicate case-insensitively
    const seen = new Set();
    const result = [];
    for (const g of rawList) {
        const lower = g.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            result.push(g);
        }
    }

    if (result.length > 5 && result.includes('Animation')) {
        const animIdx = result.indexOf('Animation');
        result.splice(animIdx, 1);
        result.push('Animation');
    }

    return result.slice(0, 8);
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
async function resolveTrailerYoutubeUrl(item, cinemeta, extra1, anilist) {
    try {
        const cleanTitle = (item?.title || item?.name || extra1?.title || extra1?.canonicalTitle || anilist?.title?.english || anilist?.title?.romaji || '').trim();
        const isAnime = item?.type === 'anime' || item?.media_type === 'anime' || !!extra1?.attributes || !!anilist || String(item?.id || '').startsWith('kitsu:') || String(item?.id || '').startsWith('mal:');
        let youtubeUrl = null;

        // 1. For Anime: prioritize local YouTube search to get official, globally unrestricted trailer (bypasses HIDIVE/Crunchyroll US geo-blocks)
        if (isAnime && cleanTitle) {
            try {
                const searchRes = await window.api.invoke('youtube-search', { query: `${cleanTitle} Official Trailer`, filter: 'video' }).catch(() => null);
                if (searchRes && searchRes.results && searchRes.results.length > 0) {
                    const topV = searchRes.results.find(v => {
                        const t = (v.title || '').toLowerCase();
                        return t.includes('trailer') || t.includes('pv') || t.includes('teaser') || t.includes('official');
                    }) || searchRes.results[0];
                    const vId = topV?.id || topV?.videoId;
                    if (vId) {
                        youtubeUrl = `https://www.youtube.com/watch?v=${vId}`;
                    }
                }
            } catch (_) {}
        }

        // 2. Western media & General media from Cinemeta
        if (!youtubeUrl) {
            const meta = cinemeta?.meta || cinemeta || item;
            if (meta?.trailers && meta.trailers.length > 0) {
                const yt = meta.trailers.find(t => t.type === 'Trailer' || t.type === 'trailer' || t.source);
                if (yt && yt.source) {
                    youtubeUrl = (yt.source.includes('://') || yt.source.includes('watch?')) ? yt.source : `https://www.youtube.com/watch?v=${yt.source}`;
                }
            }
            if (!youtubeUrl && meta?.youtubeId) {
                youtubeUrl = `https://www.youtube.com/watch?v=${meta.youtubeId}`;
            }
        }

        // 3. TMDB Videos Fallback
        if (!youtubeUrl) {
            const tmdbKey = window.appData?.tmdbKey || DEFAULT_TMDB_KEY;
            const imdbId = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
            let tmdbId = item.tmdbId || item.tmdb_id;
            
            if (tmdbKey && (imdbId || tmdbId || cleanTitle)) {
                if (!tmdbId && imdbId) {
                    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
                    const findRes = await fetch(findUrl).then(r => r.json()).catch(() => null);
                    const isTv = item.type === 'series' || item.type === 'tv';
                    const resultsList = isTv ? findRes?.tv_results : findRes?.movie_results;
                    if (resultsList && resultsList[0]) {
                        tmdbId = resultsList[0].id;
                    }
                }
                if (tmdbId) {
                    const isTv = item.type === 'series' || item.type === 'tv';
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

        // 4. Secondary fallback via YouTube search if still not found
        if (!youtubeUrl && cleanTitle) {
            try {
                const searchRes = await window.api.invoke('youtube-search', { query: `${cleanTitle} Official Trailer`, filter: 'video' }).catch(() => null);
                if (searchRes && searchRes.results && searchRes.results.length > 0) {
                    const topV = searchRes.results[0];
                    const vId = topV?.id || topV?.videoId;
                    if (vId) {
                        youtubeUrl = `https://www.youtube.com/watch?v=${vId}`;
                    }
                }
            } catch (_) {}
        }

        // 5. Last fallback: AniList / Kitsu
        if (!youtubeUrl) {
            if (anilist?.trailer?.id && (anilist?.trailer?.site || '').toLowerCase() === 'youtube') {
                youtubeUrl = `https://www.youtube.com/watch?v=${anilist.trailer.id}`;
            } else if (extra1?.attributes?.youtubeVideoId) {
                youtubeUrl = `https://www.youtube.com/watch?v=${extra1.attributes.youtubeVideoId}`;
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
                    shakaPlayer.configure({
                        abr: {
                            enabled: true,
                            defaultBandwidthEstimate: 100000000 // 100 Mbps for crystal clear HD trailer playback
                        },
                        streaming: { bufferingGoal: 10 }
                    });
                    return shakaPlayer.load(directUrl);
                }).then(() => {
                    try {
                        const tracks = shakaPlayer.getVariantTracks();
                        if (tracks && tracks.length > 0) {
                            const bestTrack = tracks.reduce((prev, curr) => ((curr.height || 0) > (prev.height || 0) ? curr : prev), tracks[0]);
                            if (bestTrack) {
                                shakaPlayer.selectVariantTrack(bestTrack, true);
                            }
                        }
                    } catch (trErr) {}
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
