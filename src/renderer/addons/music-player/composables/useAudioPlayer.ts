import { ref, computed, watch } from 'vue';
import type { Track, LyricLine, RepeatMode, SleepTimerState } from '../types/music';
import { parseLRC, fetchLyricsFromLrclib } from '../services/lrcParser';
import {
  saveTrackOffline,
  getOfflineTrackUrl,
  isTrackOffline,
  deleteOfflineTrack,
} from '../services/offlineStorage';

// Singleton State (Shared across all components)
const audio = new Audio();
const currentTrack = ref<Track | null>(null);
const isPlaying = ref(false);
const isLoading = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(0.8);
const isMuted = ref(false);
const queue = ref<Track[]>([]);
const queueIndex = ref(-1);
const repeatMode = ref<RepeatMode>('off');
const isShuffle = ref(false);
const isFullScreen = ref(false);

const currentLyrics = ref<LyricLine[]>([]);
const isLyricsLoading = ref(false);

const sleepTimer = ref<SleepTimerState>({
  isActive: false,
  mode: null,
  durationMinutes: 0,
  remainingSeconds: 0,
});

let sleepInterval: any = null;
const downloadProgressMap = ref<Record<string | number, number>>({});

// Audio event listeners setup
let isInitialized = false;

function initAudioListeners() {
  if (isInitialized) return;
  isInitialized = true;

  audio.volume = volume.value;

  audio.addEventListener('play', () => {
    isPlaying.value = true;
    isLoading.value = false;
    updateMediaSession();
  });

  audio.addEventListener('pause', () => {
    isPlaying.value = false;
    updateMediaSession();
  });

  audio.addEventListener('waiting', () => {
    isLoading.value = true;
  });

  audio.addEventListener('playing', () => {
    isLoading.value = false;
    isPlaying.value = true;
  });

  audio.addEventListener('canplay', () => {
    isLoading.value = false;
  });

  audio.addEventListener('timeupdate', () => {
    currentTime.value = audio.currentTime;
  });

  audio.addEventListener('loadedmetadata', () => {
    duration.value = audio.duration || currentTrack.value?.duration || 0;
  });

  audio.addEventListener('ended', () => {
    handleTrackEnded();
  });

  audio.addEventListener('error', (e) => {
    console.error('[AudioPlayer] Native audio error:', e);
    isLoading.value = false;
    isPlaying.value = false;
  });
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !currentTrack.value) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: currentTrack.value.title,
    artist: currentTrack.value.artist,
    album: currentTrack.value.album || 'MEEM Music',
    artwork: currentTrack.value.coverUrl
      ? [{ src: currentTrack.value.coverUrl, sizes: '512x512', type: 'image/png' }]
      : [],
  });

  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => previous());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) seek(details.seekTime);
  });
}

function handleTrackEnded() {
  // Check Sleep Timer End of Track
  if (sleepTimer.value.isActive && sleepTimer.value.mode === 'end_of_track') {
    pause();
    cancelSleepTimer();
    return;
  }

  if (repeatMode.value === 'one') {
    seek(0);
    play();
    return;
  }

  if (queueIndex.value < queue.value.length - 1) {
    next();
  } else if (repeatMode.value === 'all' && queue.value.length > 0) {
    queueIndex.value = 0;
    playTrack(queue.value[0]);
  } else {
    isPlaying.value = false;
  }
}

async function loadLyrics(track: Track) {
  currentLyrics.value = [];
  isLyricsLoading.value = true;

  if (track.lrc) {
    currentLyrics.value = parseLRC(track.lrc);
    isLyricsLoading.value = false;
    return;
  }

  const fetched = await fetchLyricsFromLrclib(
    track.title,
    track.artist,
    track.album,
    track.duration
  );

  if (fetched?.syncedLyrics) {
    currentLyrics.value = parseLRC(fetched.syncedLyrics);
  } else if (fetched?.plainLyrics) {
    // Fallback un-synced lines
    currentLyrics.value = fetched.plainLyrics
      .split('\n')
      .map((text, i) => ({ id: i, time: i * 5, text }));
  }

  isLyricsLoading.value = false;
}

async function playTrack(track: Track) {
  initAudioListeners();
  currentTrack.value = track;
  isLoading.value = true;

  // Check if available in Offline IndexedDB first
  const offlineUrl = await getOfflineTrackUrl(track.id);
  const playUrl = offlineUrl || track.url;

  if (audio.src !== playUrl) {
    audio.src = playUrl;
    audio.load();
  }

  try {
    await audio.play();
    isPlaying.value = true;
  } catch (err) {
    console.warn('[AudioPlayer] Autoplay prevented or stream error:', err);
  } finally {
    isLoading.value = false;
  }

  // Check offline status for UI badge
  track.isOffline = !!offlineUrl || (await isTrackOffline(track.id));
  loadLyrics(track);
  updateMediaSession();
}

// ─── PUBLIC ACTIONS ─────────────────────────────────────────────────────────

export function useAudioPlayer() {
  initAudioListeners();

  const progressPercent = computed(() => {
    if (!duration.value) return 0;
    return (currentTime.value / duration.value) * 100;
  });

  const activeLyricIndex = computed(() => {
    if (!currentLyrics.value.length) return -1;
    const time = currentTime.value;
    for (let i = currentLyrics.value.length - 1; i >= 0; i--) {
      if (time >= currentLyrics.value[i].time) {
        return i;
      }
    }
    return 0;
  });

  function play(track?: Track, newQueue?: Track[]) {
    if (newQueue && newQueue.length > 0) {
      queue.value = [...newQueue];
      if (track) {
        const found = queue.value.findIndex((t) => t.id === track.id);
        queueIndex.value = found !== -1 ? found : 0;
      } else {
        queueIndex.value = 0;
      }
      playTrack(queue.value[queueIndex.value]);
      return;
    }

    if (track) {
      const idx = queue.value.findIndex((t) => t.id === track.id);
      if (idx !== -1) {
        queueIndex.value = idx;
      } else {
        queue.value.push(track);
        queueIndex.value = queue.value.length - 1;
      }
      playTrack(track);
      return;
    }

    if (currentTrack.value) {
      audio.play();
      isPlaying.value = true;
    } else if (queue.value.length > 0) {
      queueIndex.value = 0;
      playTrack(queue.value[0]);
    }
  }

  function pause() {
    audio.pause();
    isPlaying.value = false;
  }

  function togglePlay() {
    if (isPlaying.value) {
      pause();
    } else {
      play();
    }
  }

  function seek(seconds: number) {
    const clamped = Math.max(0, Math.min(seconds, duration.value || audio.duration || 0));
    audio.currentTime = clamped;
    currentTime.value = clamped;
  }

  function next() {
    if (!queue.value.length) return;
    if (isShuffle.value) {
      const randomIdx = Math.floor(Math.random() * queue.value.length);
      queueIndex.value = randomIdx;
    } else if (queueIndex.value < queue.value.length - 1) {
      queueIndex.value++;
    } else if (repeatMode.value === 'all') {
      queueIndex.value = 0;
    } else {
      return;
    }
    playTrack(queue.value[queueIndex.value]);
  }

  function previous() {
    if (currentTime.value > 3) {
      seek(0);
      return;
    }
    if (!queue.value.length) return;
    if (queueIndex.value > 0) {
      queueIndex.value--;
      playTrack(queue.value[queueIndex.value]);
    } else {
      seek(0);
    }
  }

  function setVolume(val: number) {
    const clamped = Math.max(0, Math.min(1, val));
    volume.value = clamped;
    audio.volume = clamped;
    isMuted.value = clamped === 0;
  }

  function toggleMute() {
    if (isMuted.value) {
      audio.volume = volume.value || 0.8;
      isMuted.value = false;
    } else {
      audio.volume = 0;
      isMuted.value = true;
    }
  }

  function toggleRepeat() {
    if (repeatMode.value === 'off') repeatMode.value = 'all';
    else if (repeatMode.value === 'all') repeatMode.value = 'one';
    else repeatMode.value = 'off';
  }

  function toggleShuffle() {
    isShuffle.value = !isShuffle.value;
  }

  function addToQueue(track: Track) {
    queue.value.push(track);
  }

  function removeFromQueue(index: number) {
    queue.value.splice(index, 1);
    if (index < queueIndex.value) {
      queueIndex.value--;
    }
  }

  // ─── SLEEP TIMER ──────────────────────────────────────────────────────────
  function setSleepTimer(option: number | 'end_of_track') {
    cancelSleepTimer();

    if (option === 'end_of_track') {
      sleepTimer.value = {
        isActive: true,
        mode: 'end_of_track',
        durationMinutes: 0,
        remainingSeconds: 0,
      };
      return;
    }

    const totalSeconds = option * 60;
    sleepTimer.value = {
      isActive: true,
      mode: 'duration',
      durationMinutes: option,
      remainingSeconds: totalSeconds,
    };

    sleepInterval = setInterval(() => {
      if (sleepTimer.value.remainingSeconds > 0) {
        sleepTimer.value.remainingSeconds--;
      } else {
        pause();
        cancelSleepTimer();
      }
    }, 1000);
  }

  function cancelSleepTimer() {
    if (sleepInterval) clearInterval(sleepInterval);
    sleepInterval = null;
    sleepTimer.value = {
      isActive: false,
      mode: null,
      durationMinutes: 0,
      remainingSeconds: 0,
    };
  }

  // ─── OFFLINE DOWNLOADS ───────────────────────────────────────────────────
  async function downloadTrack(track: Track) {
    try {
      downloadProgressMap.value[track.id] = 0;
      await saveTrackOffline(track, (percent) => {
        downloadProgressMap.value[track.id] = percent;
      });
      track.isOffline = true;
      if (currentTrack.value?.id === track.id) {
        currentTrack.value.isOffline = true;
      }
      delete downloadProgressMap.value[track.id];
    } catch (e) {
      console.error('[AudioPlayer] Download failed:', e);
      delete downloadProgressMap.value[track.id];
    }
  }

  async function removeDownload(trackId: string | number) {
    await deleteOfflineTrack(trackId);
    if (currentTrack.value?.id === trackId) {
      currentTrack.value.isOffline = false;
    }
    const inQueue = queue.value.find((t) => t.id === trackId);
    if (inQueue) inQueue.isOffline = false;
  }

  function toggleFullScreen(value?: boolean) {
    isFullScreen.value = typeof value === 'boolean' ? value : !isFullScreen.value;
  }

  return {
    // State
    currentTrack,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    progressPercent,
    volume,
    isMuted,
    queue,
    queueIndex,
    repeatMode,
    isShuffle,
    isFullScreen,
    currentLyrics,
    isLyricsLoading,
    activeLyricIndex,
    sleepTimer,
    downloadProgressMap,

    // Controls
    play,
    pause,
    togglePlay,
    seek,
    next,
    previous,
    setVolume,
    toggleMute,
    toggleRepeat,
    toggleShuffle,
    addToQueue,
    removeFromQueue,
    setSleepTimer,
    cancelSleepTimer,
    downloadTrack,
    removeDownload,
    toggleFullScreen,
  };
}
