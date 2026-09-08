import type { Track } from '../types/music';

const DB_NAME = 'MEEM_Music_Offline_DB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_tracks';

interface OfflineRecord {
  id: string | number;
  track: Track;
  audioBlob: Blob;
  coverBlob?: Blob;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Downloads audio and cover streams, tracks progress, and saves to IndexedDB for offline access.
 */
export async function saveTrackOffline(
  track: Track,
  onProgress?: (percent: number) => void
): Promise<string> {
  const db = await openDB();

  // 1. Fetch audio with progress
  const response = await fetch(track.url);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.statusText} (${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  let receivedBytes = 0;
  let chunks: Uint8Array[] = [];

  if (response.body && contentLength > 0) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.length;
        if (onProgress) {
          const progress = Math.min(100, Math.round((receivedBytes / contentLength) * 100));
          onProgress(progress);
        }
      }
    }
  }

  const audioBlob = chunks.length > 0
    ? new Blob(chunks as unknown as BlobPart[], { type: response.headers.get('content-type') || 'audio/mpeg' })
    : await response.blob();

  // 2. Fetch cover art if present
  let coverBlob: Blob | undefined;
  if (track.coverUrl) {
    try {
      const coverRes = await fetch(track.coverUrl);
      if (coverRes.ok) {
        coverBlob = await coverRes.blob();
      }
    } catch (_) {
      // Cover art download failure is non-fatal
    }
  }

  const record: OfflineRecord = {
    id: track.id,
    track: {
      ...track,
      isOffline: true,
    },
    audioBlob,
    coverBlob,
    savedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => resolve(URL.createObjectURL(audioBlob));
    req.onerror = () => reject(req.error);
  });
}

/**
 * Checks if a track exists in offline IndexedDB storage.
 */
export async function isTrackOffline(id: string | number): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => resolve(false);
  });
}

/**
 * Returns an offline track's local Blob URL for immediate playback.
 */
export async function getOfflineTrackUrl(id: string | number): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
      if (req.result && req.result.audioBlob) {
        resolve(URL.createObjectURL(req.result.audioBlob));
      } else {
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
  });
}

/**
 * Retrieves all saved offline tracks.
 */
export async function getAllOfflineTracks(): Promise<Track[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records: OfflineRecord[] = req.result || [];
      const tracks = records.map((r) => {
        const coverUrl = r.coverBlob ? URL.createObjectURL(r.coverBlob) : r.track.coverUrl;
        const localAudioUrl = URL.createObjectURL(r.audioBlob);
        return {
          ...r.track,
          coverUrl,
          url: localAudioUrl,
          isOffline: true,
        };
      });
      resolve(tracks);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes a track from offline storage.
 */
export async function deleteOfflineTrack(id: string | number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
