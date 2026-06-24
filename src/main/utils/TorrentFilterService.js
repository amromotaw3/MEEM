/**
 * TorrentFilterService - Handles parsing of torrent titles and verification of episodes.
 * Optimized for both standard TV Shows (SxxExx) and Anime (Absolute Numbering).
 */
class TorrentFilterService {
    /**
     * Extracts Season and Episode information from a torrent title.
     * @param {string} title - The raw torrent title.
     * @returns {{season: number|null, episode: number|null, isPack: boolean}}
     */
    static parseTitle(title) {
        if (!title) return { season: null, episode: null, isPack: false, seasonRange: null };
        
        // Clean title for easier matching (replace dots, underscores, brackets with spaces)
        const clean = title.replace(/[\.\_\(\)\[\]]/g, ' ').trim();

        // 1. Detect Season Packs (e.g., "Season 1 Complete", "S01 Full Pack", "S01-S03")
        // Also detect episode ranges like "01-12" which indicate a pack
        const packPatterns = [
            { re: /(?:season|s)\s*(\d+)\s*(?:complete|full|pack|collection|bundle)/i, map: (m) => ({ s: parseInt(m[1]) }) },
            { re: /s(\d+)\s*-\s*s(\d+)/i, map: (m) => ({ s: parseInt(m[1]), e: parseInt(m[2]) }) },
            { re: /s(\d+)\s*-\s*(\d+)/i, map: (m) => ({ s: parseInt(m[1]), e: parseInt(m[2]) }) },
            { re: /(?:complete|full)\s*season\s*(\d+)/i, map: (m) => ({ s: parseInt(m[1]) }) },
            { re: /s(\d+)\s+(\d+)\s*-\s*(\d+)/i, map: (m) => ({ s: parseInt(m[1]), isEpRange: true }) },
            { re: /\s(\d+)\s*-\s*(\d+)\s*(?:$|\.|\s)/, map: (m) => ({ isEpRange: true }) }
        ];

        for (const p of packPatterns) {
            const match = clean.match(p.re);
            if (match) {
                const info = p.map(match);
                return { 
                    season: info.s || null, 
                    episode: null, 
                    isPack: true, 
                    seasonRange: (info.s && info.e) ? { start: info.s, end: info.e } : null 
                };
            }
        }

        // 2. Standard TV Show Formats (S01E05, 1x05, Season 1 Episode 5)
        const standardPatterns = [
            /(?:s|season)\s*(\d+)\s*(?:e|episode|x)\s*(\d+)/i,
            /(\d+)x(\d+)/i,
            /s(\d+)e(\d+)/i
        ];

        for (const pattern of standardPatterns) {
            const match = clean.match(pattern);
            if (match) {
                return { 
                    season: parseInt(match[1]), 
                    episode: parseInt(match[2]), 
                    isPack: false,
                    seasonRange: null
                };
            }
        }

        // 3. Anime / Simple Episode Formats (Absolute Numbering)
        // We look for these only if a season wasn't found above.
        // We prioritize explicit "Episode" or "E" prefixes.
        const explicitEpPattern = /(?:\b(?:e|episode|ep)|(?:\s|^|\[)حلقة)\s*(\d{1,4})(?:\s|$|v\d)/i;
        const explicitMatch = clean.match(explicitEpPattern);
        if (explicitMatch) {
            return { season: null, episode: parseInt(explicitMatch[1]), isPack: false, seasonRange: null };
        }

        // Fallback: Look for an isolated number, but prefer the one that is NOT 480/720/1080/2160
        const absolutePatterns = [
            /(?:[\-\s])\s*(\d{1,4})(?:\s|$|v\d)/gi,
            /\s+(\d{1,4})\s*$/g
        ];

        const commonResolutions = [480, 576, 720, 1080, 2160];
        let bestEp = null;

        for (const pattern of absolutePatterns) {
            let match;
            while ((match = pattern.exec(clean)) !== null) {
                const ep = parseInt(match[1]);
                // Skip common resolutions and years
                if (commonResolutions.includes(ep) || ep > 2010) continue;
                
                // If we found a number, it's a candidate.
                bestEp = ep;
            }
            if (bestEp !== null) break;
        }

        if (bestEp !== null) {
            return { season: null, episode: bestEp, isPack: false, seasonRange: null };
        }

        return { season: null, episode: null, isPack: false, seasonRange: null };
    }

    /**
     * Verifies if a torrent title matches the requested media criteria.
     * @param {Object} params
     * @param {string} params.torrentTitle - Title to check.
     * @param {number} params.requestedSeason - The season number (TMDB style).
     * @param {number} params.requestedEpisode - The episode number (TMDB style).
     * @param {number} [params.absoluteEpisodeNumber] - The absolute episode number (Kitsu style).
     * @param {boolean} [params.isAnime] - Whether the content is anime.
     * @param {number} [params.fileIdx] - The specific file index within a pack.
     * @returns {boolean}
     */
    static verifyEpisodeMatch({ torrentTitle, requestedSeason, requestedEpisode, absoluteEpisodeNumber, isAnime, fileIdx }) {
        // Coerce to numbers to prevent string/number mismatch (e.g. "5" === 5 → false)
        requestedSeason = requestedSeason != null ? Number(requestedSeason) : null;
        requestedEpisode = requestedEpisode != null ? Number(requestedEpisode) : null;
        absoluteEpisodeNumber = absoluteEpisodeNumber != null ? Number(absoluteEpisodeNumber) : null;

        // If the addon has already resolved the torrent and mapped a specific file index for the episode, it's a match
        if (fileIdx !== null && fileIdx !== undefined) {
            return true;
        }

        const parsed = this.parseTitle(torrentTitle);

        // Rule 1: Reject Season Packs if no file index is provided
        if (parsed.isPack) {
            return false;
        }

        // Rule 2: Anime logic (Check absolute episode first, then standard S/E)
        if (isAnime) {
            // Check absolute number (e.g. 30)
            if (absoluteEpisodeNumber && parsed.episode === absoluteEpisodeNumber) return true;
            
            // Check if it matches requested S/E (some anime torrents use S02E05)
            if (parsed.season === requestedSeason && parsed.episode === requestedEpisode) return true;

            // If it's anime and we only found an episode number (no season), 
            // and it doesn't match the absolute number, it's likely wrong.
            return false;
        }

        // Rule 3: Standard TV Show logic
        // It must have the correct season AND the correct episode.
        return parsed.season === requestedSeason && parsed.episode === requestedEpisode;
    }
}

module.exports = TorrentFilterService;
