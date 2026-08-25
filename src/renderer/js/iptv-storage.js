/**
 * MediaVault v2 - IPTV IndexedDB Storage Service
 * Caches large IPTV playlists, channels, and sources locally so they don't have to be fetched
 * or parsed on every application load.
 */

(function (global) {
  'use strict';

  const DB_NAME = 'MediaVault_IPTV_v2';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Store 1: IPTV Sources (Playlists / Accounts)
        if (!db.objectStoreNames.contains('sources')) {
          db.createObjectStore('sources', { keyPath: 'id' });
        }

        // Store 2: IPTV Channels
        if (!db.objectStoreNames.contains('channels')) {
          const channelStore = db.createObjectStore('channels', { keyPath: 'id' });
          channelStore.createIndex('sourceId', 'sourceId', { unique: false });
          channelStore.createIndex('category', 'category', { unique: false });
          channelStore.createIndex('isFavorite', 'isFavorite', { unique: false });
        }

        // Store 3: Favorites
        if (!db.objectStoreNames.contains('favorites')) {
          db.createObjectStore('favorites', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });

    return dbPromise;
  }

  const IptvStorage = {
    async getSources() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sources', 'readonly');
        const store = tx.objectStore('sources');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async saveSource(source) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sources', 'readwrite');
        const store = tx.objectStore('sources');
        const req = store.put(source);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async deleteSource(sourceId) {
      const db = await openDB();
      return new Promise(async (resolve, reject) => {
        try {
          const tx = db.transaction(['sources', 'channels'], 'readwrite');
          tx.objectStore('sources').delete(sourceId);

          const channelStore = tx.objectStore('channels');
          const index = channelStore.index('sourceId');
          const range = IDBKeyRange.only(sourceId);

          const cursorReq = index.openCursor(range);
          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              channelStore.delete(cursor.primaryKey);
              cursor.continue();
            }
          };

          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        } catch (err) {
          reject(err);
        }
      });
    },

    async cacheChannels(sourceId, channels) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('channels', 'readwrite');
        const store = tx.objectStore('channels');
        const index = store.index('sourceId');

        const keysReq = index.getAllKeys(IDBKeyRange.only(sourceId));
        keysReq.onsuccess = () => {
          const keys = keysReq.result || [];
          for (let i = 0; i < keys.length; i++) {
            store.delete(keys[i]);
          }
          if (Array.isArray(channels)) {
            for (let i = 0; i < channels.length; i++) {
              store.put({ ...channels[i], sourceId });
            }
          }
        };

        tx.oncomplete = () => resolve(channels ? channels.length : 0);
        tx.onerror = () => reject(tx.error);
      });
    },

    async getChannels(sourceId, category = 'All', search = '') {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('channels', 'readonly');
        const store = tx.objectStore('channels');
        const index = store.index('sourceId');

        const request = index.getAll(IDBKeyRange.only(sourceId));

        request.onsuccess = () => {
          let list = request.result || [];
          const cleanSearch = (search || '').toLowerCase().trim();
          const cleanCat = (category || 'All').trim();

          if (cleanCat !== 'All' && cleanCat !== '⭐ Favorites') {
            list = list.filter(c => (c.category || c.groupTitle || '') === cleanCat);
          } else if (cleanCat === '⭐ Favorites') {
            list = list.filter(c => c.isFavorite);
          }

          if (cleanSearch) {
            list = list.filter(c =>
              (c.name || '').toLowerCase().includes(cleanSearch) ||
              (c.category || '').toLowerCase().includes(cleanSearch)
            );
          }

          resolve(list);
        };

        request.onerror = () => reject(request.error);
      });
    },

    async toggleFavorite(channelId, isFav) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['channels', 'favorites'], 'readwrite');
        const channelStore = tx.objectStore('channels');
        const favStore = tx.objectStore('favorites');

        const getReq = channelStore.get(channelId);
        getReq.onsuccess = () => {
          const ch = getReq.result;
          if (ch) {
            ch.isFavorite = isFav;
            channelStore.put(ch);
            if (isFav) {
              favStore.put(ch);
            } else {
              favStore.delete(channelId);
            }
          }
        };

        tx.oncomplete = () => resolve(isFav);
        tx.onerror = () => reject(tx.error);
      });
    }
  };

  global.IptvStorage = IptvStorage;
})(typeof window !== 'undefined' ? window : this);
