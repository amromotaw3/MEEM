const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../src/renderer/renderer.js');
let js = fs.readFileSync(file, 'utf8');

function replaceOnce(label, from, to) {
  if (js.includes(to.split('\n')[0].trim())) {
    console.log('skip:', label);
    return;
  }
  if (!js.includes(from)) {
    console.warn('MISSING:', label);
    return;
  }
  js = js.replace(from, to);
  console.log('applied:', label);
}

if (!js.includes('function agentDebugLog')) {
  const insert = `
  

  function normalizeProfiles(profiles) {
    if (!Array.isArray(profiles)) return [];
    return profiles.map((p) => ({
      id: p.id,
      name: (p.name || p.profile_name || 'Profile').trim(),
      avatar: p.avatar || p.avatar_url || AVATARS[0],
      banner: p.banner || p.banner_url || null,
      playback: p.playback || {},
      watchlist: p.watchlist || [],
      pinned: p.pinned || [],
      vaultPin: p.pin || p.vaultPin || null,
      lockedItems: p.locked_items || p.lockedItems || []
    }));
  }

  function ensureDefaultAddons() {
    if (!appData.installedAddons) appData.installedAddons = [];
    const hasTorrentio = appData.installedAddons.some((a) => (a.url || '').includes('torrentio'));
    if (!hasTorrentio) {
      appData.installedAddons.unshift({
        id: 'torrentio',
        name: 'Torrentio',
        url: 'https://torrentio.strem.fun',
        manifestUrl: 'https://torrentio.strem.fun/manifest.json',
        icon: '⚡',
        types: ['movie', 'series', 'anime'],
        isCustom: true
      });
    }
    const hasCinemeta = appData.installedAddons.some((a) => (a.url || '').includes('cinemeta'));
    if (!hasCinemeta) {
      appData.installedAddons.push({
        id: 'com.rpdb.cinemeta',
        name: 'Cinemeta (with ratings)',
        url: 'https://cinemeta.ratingposterdb.com',
        manifestUrl: 'https://cinemeta.ratingposterdb.com/manifest.json',
        icon: '🎬',
        types: ['movie', 'series'],
        isCustom: true
      });
    }
  }
`;
  const anchor = "  function deepMerge(t, s) { if (!s || typeof s !== 'object') return t; const o = { ...t }; for (const k of Object.keys(s)) { o[k] = s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? deepMerge(o[k] || {}, s[k]) : s[k]; } return o; }";
  js = js.replace(anchor, anchor + insert);
  console.log('applied: helpers');
}

replaceOnce(
  'auth orbs',
  "    overlay.innerHTML = `\n      <div class=\"auth-card\" role=\"dialog\"",
  "    overlay.innerHTML = `\n      <div class=\"auth-orbs\" aria-hidden=\"true\">\n        <div style=\"top:-20%;left:-20%;width:80%;height:80%;background:radial-gradient(circle,rgba(168,85,247,0.35) 0%,transparent 70%);animation:splashOrbit 8s infinite ease-in-out\"></div>\n        <div style=\"bottom:-20%;right:-20%;width:80%;height:80%;background:radial-gradient(circle,rgba(79,70,229,0.3) 0%,transparent 70%);animation:splashOrbit 12s infinite ease-in-out reverse\"></div>\n        <div style=\"top:20%;right:-30%;width:70%;height:70%;background:radial-gradient(circle,rgba(139,92,246,0.25) 0%,transparent 70%);animation:splashOrbit 10s infinite linear\"></div>\n      </div>\n      <div class=\"auth-card\" role=\"dialog\""
);

replaceOnce(
  'handleAuthLogin',
  `        appData.user = resp.user || resp;
        appData.profiles = resp.profiles || [];
        appData.authenticated = true;
        persist();`,
  `        appData.user = resp.user || resp;
        appData.profiles = normalizeProfiles(resp.profiles || []);
        appData.authenticated = true;
        ensureDefaultAddons();

        persist();`
);

replaceOnce(
  'runAuthFlow',
  `      if (resp?.authenticated) {
        appData.user = resp.user;
        appData.profiles = resp.profiles || [];
        appData.activeProfileId = resp.activeProfileId || (resp.profiles?.[0]?.id || null);
        persist();
        authFlowCompleted = true;`,
  `      agentDebugLog('renderer.js:runAuthFlow', 'loadData result', { authenticated: !!resp?.authenticated, profileCount: (resp?.profiles || []).length, hasUser: !!resp?.user }, 'H1');
      if (resp?.authenticated) {
        appData.user = resp.user;
        appData.profiles = normalizeProfiles(resp.profiles || []);
        appData.activeProfileId = resp.activeProfileId || (resp.profiles?.[0]?.id || null);
        appData.authenticated = true;
        ensureDefaultAddons();
        persist();
        authFlowCompleted = true;`
);

replaceOnce(
  'setSelectedBanner',
  `  function setSelectedBanner(url) {
    appData.globalBanner = url;
    persist();
    renderProfileWidget();
  }`,
  `  function setSelectedBanner(url) {
    const targetId = editingProfileId || appData.activeProfileId;
    const profile = targetId ? appData.profiles.find((p) => p.id === targetId) : null;
    if (profile) profile.banner = url;
    else appData.globalBanner = url;
    persist();
    renderProfilePicker();
    renderProfileWidget();

  }`
);

replaceOnce(
  'profile-confirm edit banner',
  '          profile.avatar = selectedAvatar;',
  '          profile.avatar = selectedAvatar;\n          if (!profile.banner && appData.globalBanner) profile.banner = appData.globalBanner;'
);

replaceOnce(
  'profile-confirm new banner',
  `          avatar: selectedAvatar,
          playback: {},`,
  `          avatar: selectedAvatar,
          banner: appData.globalBanner || null,
          playback: {},`
);

replaceOnce(
  'btn-intro-start',
  `      $('#profile-modal').style.display = 'flex';`,
  ''
);

replaceOnce(
  'character pick',
  `      el.onclick = () => {
        $('#fav-results-list').style.display = 'none';`,
  `      el.onclick = () => {
        if (currentFavModalMode === 'avatar' && (item.type === 'character' || item.source === 'jikan' || item.source === 'anilist')) {
          const src = item.poster || item.poster_path || item.image;
          if (src) {
            setSelectedAvatar(src.startsWith('http') ? src : localImg(src));
            showToast('Avatar updated');
            const _m = $('#fav-avatar-modal');
            if (_m) { _m.style.display = 'none'; _m.classList.remove('modal-active'); }
            try { document.body.classList.remove('modal-open'); } catch (e) { }

            return;
          }
        }
        $('#fav-results-list').style.display = 'none';`
);

replaceOnce(
  'avatar grid width',
  "        targetGrid.style.alignItems = 'center';",
  "        targetGrid.style.alignItems = 'center';\n        targetGrid.style.width = '100%';\n        targetGrid.style.minWidth = '100%';"
);

replaceOnce(
  'boot',
  '      appData = deepMerge(appData, saved);',
  `      appData = deepMerge(appData, saved);
      if (saved?.profiles?.length) appData.profiles = normalizeProfiles(appData.profiles);
      if (saved?.authenticated) appData.authenticated = saved.authenticated;
      if (saved?.user) appData.user = saved.user;
      ensureDefaultAddons();
      agentDebugLog('renderer.js:boot', 'data loaded', { authenticated: !!appData.authenticated, profileCount: appData.profiles?.length || 0, addonCount: appData.installedAddons?.length || 0 }, 'H1');`
);

replaceOnce(
  'loadStreams log query',
  "        console.log('[Streams] Calling searchAddons with:', query);",
  "        console.log('[Streams] Calling searchAddons with:', query);\n        agentDebugLog('renderer.js:loadStreams', 'searchAddons query', { type: query.type, hasImdb: !!query.imdbId, hasKitsu: !!query.kitsuId }, 'H3');"
);

replaceOnce(
  'loadStreams log result',
  '        streams = await window.api.searchAddons(query);',
  "        streams = await window.api.searchAddons(query);\n        agentDebugLog('renderer.js:loadStreams', 'searchAddons result', { count: (streams || []).length }, 'H3');"
);

fs.writeFileSync(file, js);
console.log('Done.');
