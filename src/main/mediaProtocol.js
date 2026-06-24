const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.m4v': 'video/x-m4v', '.ts': 'video/mp2t'
};

function resolveMediaPathFromRequest(request) {
  const url = new URL(request.url);
  let rawPath = decodeURIComponent(url.pathname || '');

  if (process.platform === 'win32') {
    if (url.host && /^[a-zA-Z]:$/.test(url.host)) {
      rawPath = url.host + rawPath;
    } else if (rawPath.startsWith('/') && /^\/[a-zA-Z]:/.test(rawPath)) {
      rawPath = rawPath.slice(1);
    }
  }

  return path.normalize(rawPath);
}

function createMediaResponse(request, rawPath) {
  if (!fs.existsSync(rawPath)) {
    return new Response('File not found', { status: 404 });
  }

  const stat = fs.statSync(rawPath);
  const fileSize = stat.size;
  const rangeHeader = request.headers.get('range');
  const ext = path.extname(rawPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const { Readable } = require('stream');

  const streamFactory = (start, end) => {
    const stream = fs.createReadStream(rawPath, { start, end });
    return Readable.toWeb(stream);
  };

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    return new Response(streamFactory(start, end), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType
      }
    });
  }

  return new Response(streamFactory(0, fileSize - 1), {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    }
  });
}

function createMediaProtocolHandler() {
  return (request) => {
    try {
      const rawPath = resolveMediaPathFromRequest(request);
      return createMediaResponse(request, rawPath);
    } catch (e) {
      console.error('[PROTOCOL] media:// error:', e);
      return new Response('Internal error', { status: 500 });
    }
  };
}

/**
 * Converts filesystem paths / legacy URLs to media:// for the native player window.
 * HTTP(S) and magnet URLs are passed through unchanged.
 */
function toMediaProtocolUrl(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';

  if (/^(media|https?|data|blob|magnet):/i.test(s)) {
    if (/^media:\/\//i.test(s)) return s;
    return s;
  }

  let filePath = s;
  if (/^local-file:\/\//i.test(filePath)) {
    filePath = decodeURIComponent(filePath.replace(/^local-file:\/\//i, ''));
  } else if (/^media-img:\/\//i.test(filePath)) {
    let raw = '';
    const rawUrl = filePath;
    if (rawUrl.startsWith('media-img:///')) {
      raw = decodeURIComponent(rawUrl.slice(13));
    } else if (rawUrl.startsWith('media-img://')) {
      const remainder = decodeURIComponent(rawUrl.slice(12));
      const driveMatch = remainder.match(/^([a-zA-Z]):(\/|\\|$)/);
      if (driveMatch) {
        raw = remainder;
      } else {
        const singleLetterMatch = remainder.match(/^([a-zA-Z])(\/|\\)/);
        if (singleLetterMatch) {
          raw = singleLetterMatch[1].toUpperCase() + ':' + remainder.slice(1);
        } else {
          const { BANNERS_DIR } = require('./store');
          raw = path.join(BANNERS_DIR, remainder);
        }
      }
    }
    filePath = raw;
  }

  const normalized = path.normalize(filePath.replace(/\//g, path.sep));
  const posix = normalized.replace(/\\/g, '/');
  const encoded = encodeURI(posix).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `media:///${encoded}`;
}

module.exports = {
  toMediaProtocolUrl,
  createMediaProtocolHandler,
  MEDIA_SCHEME: 'media'
};
