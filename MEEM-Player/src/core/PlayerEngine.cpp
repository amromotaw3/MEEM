#include "PlayerEngine.h"
#include <QFileInfo>
#include <QDir>
#include <QDebug>
#include <QCoreApplication>
#include <QTimer>

#ifdef _WIN32
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <endpointvolume.h>

static void forceUnmuteWindowsAudioSession() {
    HRESULT hrCo = CoInitialize(nullptr);
    IMMDeviceEnumerator *enumerator = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_INPROC_SERVER,
                                  __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
    if (SUCCEEDED(hr) && enumerator) {
        IMMDevice *device = nullptr;
        hr = enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device);
        if (SUCCEEDED(hr) && device) {
            IAudioSessionManager2 *mgr = nullptr;
            hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_INPROC_SERVER, nullptr, (void**)&mgr);
            if (SUCCEEDED(hr) && mgr) {
                IAudioSessionEnumerator *sessionEnum = nullptr;
                hr = mgr->GetSessionEnumerator(&sessionEnum);
                if (SUCCEEDED(hr) && sessionEnum) {
                    int count = 0;
                    sessionEnum->GetCount(&count);
                    DWORD currentPid = GetCurrentProcessId();
                    for (int i = 0; i < count; ++i) {
                        IAudioSessionControl *ctl = nullptr;
                        if (SUCCEEDED(sessionEnum->GetSession(i, &ctl)) && ctl) {
                            IAudioSessionControl2 *ctl2 = nullptr;
                            if (SUCCEEDED(ctl->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&ctl2))) {
                                DWORD pid = 0;
                                ctl2->GetProcessId(&pid);
                                if (pid == currentPid) {
                                    ISimpleAudioVolume *vol = nullptr;
                                    if (SUCCEEDED(ctl2->QueryInterface(__uuidof(ISimpleAudioVolume), (void**)&vol))) {
                                        BOOL isMuted = FALSE;
                                        vol->GetMute(&isMuted);
                                        float level = 0.0f;
                                        vol->GetMasterVolume(&level);
                                        if (isMuted || level < 0.1f) {
                                            vol->SetMute(FALSE, nullptr);
                                            vol->SetMasterVolume(1.0f, nullptr);
                                        }
                                        vol->Release();
                                    }
                                }
                                ctl2->Release();
                            }
                            ctl->Release();
                        }
                    }
                    sessionEnum->Release();
                }
                mgr->Release();
            }
            device->Release();
        }
        enumerator->Release();
    }
    if (SUCCEEDED(hrCo)) {
        CoUninitialize();
    }
}
#endif

PlayerEngine::PlayerEngine(QObject *parent) : QObject(parent) {
#ifdef _WIN32
    forceUnmuteWindowsAudioSession();
    QString pluginDir = QCoreApplication::applicationDirPath() + "/plugins";
    if (QDir(pluginDir).exists()) {
        QString envStr = QString("VLC_PLUGIN_PATH=%1").arg(QDir::toNativeSeparators(pluginDir));
        _putenv(envStr.toLocal8Bit().constData());
    } else {
        _putenv("VLC_PLUGIN_PATH=plugins");
    }
#endif

    const char *vlc_args[] = {
        "--quiet",
        "--no-xlib",
        "--no-video-title-show",
        "--subsdec-encoding=UTF-8",
        "--avcodec-hw=dxva2",
        "--avcodec-threads=0",
        "--directx-hw-yuv=1",
        "--d3d11-hw-blending=1",
        "--audio-time-stretch",
        "--video-filter=adjust",
        "--network-caching=3000",
        "--file-caching=300",
        "--live-caching=1000",
        "--disc-caching=500",
        "--sout-mux-caching=1000",
        "--clock-jitter=0",
        "--clock-synchro=0",
        "--http-reconnect",
        "--adaptive-maxwidth=3840",
        "--adaptive-maxheight=2160",
        "--preferred-resolution=2160",
        "--http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    };

    m_instance = libvlc_new(sizeof(vlc_args) / sizeof(vlc_args[0]), vlc_args);
    if (!m_instance) {
        m_instance = libvlc_new(0, nullptr);
    }

    if (m_instance) {
        m_player = libvlc_media_player_new(m_instance);
        if (m_player) {
            m_eventManager = libvlc_media_player_event_manager(m_player);
            attachEvents();
        }
    }
}

PlayerEngine::~PlayerEngine() {
    shutdown();
}

void PlayerEngine::attachEvents() {
    if (!m_eventManager) return;
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerPlaying, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerPaused, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerStopped, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerPositionChanged, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerTimeChanged, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerLengthChanged, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerEndReached, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerEncounteredError, handleVlcEvent, this);
    libvlc_event_attach(m_eventManager, libvlc_MediaPlayerESAdded, handleVlcEvent, this);
}

void PlayerEngine::detachEvents() {
    if (!m_eventManager) return;
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerPlaying, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerPaused, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerStopped, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerPositionChanged, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerTimeChanged, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerLengthChanged, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerEndReached, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerEncounteredError, handleVlcEvent, this);
    libvlc_event_detach(m_eventManager, libvlc_MediaPlayerESAdded, handleVlcEvent, this);
}

void PlayerEngine::muteImmediately() {
    if (m_player) {
        libvlc_media_player_stop(m_player);
    }
}

void PlayerEngine::shutdown() {
    if (!m_instance && !m_player) return; // Guard against double execution

    detachEvents();
    m_eventManager = nullptr;

    if (m_player) {
        // Detach window handle first so Direct3D/Win32 message queue doesn't deadlock
        libvlc_media_player_set_hwnd(m_player, nullptr);
        libvlc_media_player_stop(m_player);
        libvlc_media_player_release(m_player);
        m_player = nullptr;
    }
    if (m_instance) {
        libvlc_release(m_instance);
        m_instance = nullptr;
    }
    m_currentWinId = nullptr;
}

void PlayerEngine::setWindowHandle(void *winId) {
    m_currentWinId = winId;
    if (m_player && winId) {
        libvlc_media_player_set_hwnd(m_player, winId);
    }
}

bool PlayerEngine::loadMedia(const QString &fileOrUrl, const QString &audioUrl) {
    if (fileOrUrl.isEmpty() || !m_instance || !m_player) return false;

    m_audioTrackPrimed = false;

    if (m_player) {
        libvlc_media_player_stop(m_player);
    }

    libvlc_media_t *media = nullptr;
    QFileInfo fi(fileOrUrl);
    if (fi.exists()) {
        QString cleanPath = QDir::toNativeSeparators(fi.absoluteFilePath());
        m_currentMediaPath = cleanPath;
        media = libvlc_media_new_path(m_instance, cleanPath.toUtf8().constData());
    } else {
        m_currentMediaPath = fileOrUrl;
        media = libvlc_media_new_location(m_instance, fileOrUrl.toUtf8().constData());
    }

    if (!media) return false;

    if (!audioUrl.isEmpty()) {
        m_pendingAudioSlave = audioUrl;
        libvlc_media_slaves_add(media, libvlc_media_slave_type_audio, 4, audioUrl.toUtf8().constData());
        QString slaveOpt = QString(":input-slave=%1").arg(audioUrl);
        libvlc_media_add_option(media, slaveOpt.toUtf8().constData());
    } else {
        m_pendingAudioSlave.clear();
    }

    libvlc_media_add_option(media, ":network-caching=5000");
    libvlc_media_add_option(media, ":http-reconnect");
    libvlc_media_add_option(media, ":http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");

    libvlc_media_player_set_media(m_player, media);
    libvlc_media_release(media);

    if (m_currentWinId) {
        setWindowHandle(m_currentWinId);
    }

    libvlc_media_player_set_rate(m_player, m_speed);
    libvlc_audio_set_mute(m_player, m_muted ? 1 : 0);
    libvlc_audio_set_volume(m_player, m_volume > 0 ? m_volume : 100);

    QString title = fi.exists() ? fi.fileName() : m_currentMediaPath;
    emit mediaLoaded(title);
    return true;
}

void PlayerEngine::play() {
    if (m_player) {
        if (m_currentWinId) {
            setWindowHandle(m_currentWinId);
        }
        if (m_isPaused) {
            libvlc_media_player_pause(m_player);
            m_isPaused = false;
        } else if (!isPlaying()) {
            libvlc_media_player_play(m_player);
            m_isPaused = false;
        }
        libvlc_audio_set_mute(m_player, m_muted ? 1 : 0);
        libvlc_audio_set_volume(m_player, m_volume > 0 ? m_volume : 100);
        ensureAudioTrackSelected();
        emit stateChanged("playing");
    }
}

void PlayerEngine::pause() {
    if (m_player && isPlaying()) {
        libvlc_media_player_pause(m_player);
        m_isPaused = true;
        emit stateChanged("paused");
    }
}

void PlayerEngine::togglePlay() {
    if (!m_player) return;
    if (isPlaying()) {
        pause();
    } else {
        play();
    }
}

void PlayerEngine::stop() {
    if (m_player) {
        libvlc_media_player_stop(m_player);
        libvlc_media_player_set_media(m_player, nullptr);
        m_currentMediaPath = "";
        m_isPaused = false;
        emit stateChanged("stopped");
        emit timeChanged(0);
        emit positionChanged(0.0f);
    }
}

bool PlayerEngine::isPlaying() const {
    return m_player ? (libvlc_media_player_is_playing(m_player) != 0) : false;
}

void PlayerEngine::seekPosition(float pos) {
    if (m_player && pos >= 0.0f && pos <= 1.0f) {
        libvlc_media_player_set_position(m_player, pos);
    }
}

void PlayerEngine::seekTime(qint64 ms) {
    if (!m_player) return;
    qint64 dur = getDuration();
    if (dur > 0) {
        qint64 target = qBound<qint64>(0, ms, dur);
        libvlc_media_player_set_time(m_player, target);
    } else {
        libvlc_media_player_set_time(m_player, qMax<qint64>(0, ms));
    }
}

qint64 PlayerEngine::getTime() const {
    return m_player ? qMax<qint64>(0, libvlc_media_player_get_time(m_player)) : 0;
}

qint64 PlayerEngine::getDuration() const {
    return m_player ? qMax<qint64>(0, libvlc_media_player_get_length(m_player)) : 0;
}

void PlayerEngine::setVolume(int volume) {
    m_volume = qBound(0, volume, 200);
    if (m_player) {
        libvlc_audio_set_volume(m_player, m_volume);
    }
}

bool PlayerEngine::toggleMute() {
    m_muted = !m_muted;
    if (m_player) {
        libvlc_audio_set_mute(m_player, m_muted ? 1 : 0);
    }
    return m_muted;
}

void PlayerEngine::setSpeed(float speed) {
    m_speed = qBound(0.25f, speed, 4.0f);
    if (m_player) {
        libvlc_media_player_set_rate(m_player, m_speed);
    }
}

float PlayerEngine::getSpeed() const {
    if (m_player) {
        float r = libvlc_media_player_get_rate(m_player);
        return r > 0.0f ? r : m_speed;
    }
    return m_speed;
}

QVector<QPair<int, QString>> PlayerEngine::getVideoTracks() const {
    QVector<QPair<int, QString>> res;
    if (!m_player) return res;
    libvlc_track_description_t *tracks = libvlc_video_get_track_description(m_player);
    libvlc_track_description_t *curr = tracks;
    while (curr) {
        res.append({curr->i_id, QString::fromUtf8(curr->psz_name ? curr->psz_name : "")});
        curr = curr->p_next;
    }
    if (tracks) libvlc_track_description_list_release(tracks);
    return res;
}

int PlayerEngine::getVideoTrack() const {
    return m_player ? libvlc_video_get_track(m_player) : -1;
}

void PlayerEngine::setVideoTrack(int trackId) {
    if (m_player) libvlc_video_set_track(m_player, trackId);
}

QVector<QPair<int, QString>> PlayerEngine::getAudioTracks() const {
    QVector<QPair<int, QString>> res;
    if (!m_player) return res;
    libvlc_track_description_t *tracks = libvlc_audio_get_track_description(m_player);
    libvlc_track_description_t *curr = tracks;
    while (curr) {
        res.append({curr->i_id, QString::fromUtf8(curr->psz_name ? curr->psz_name : "")});
        curr = curr->p_next;
    }
    if (tracks) libvlc_track_description_list_release(tracks);
    return res;
}

int PlayerEngine::getAudioTrack() const {
    return m_player ? libvlc_audio_get_track(m_player) : -1;
}

void PlayerEngine::setAudioTrack(int trackId) {
    if (m_player) libvlc_audio_set_track(m_player, trackId);
}

QVector<QPair<int, QString>> PlayerEngine::getSubtitleTracks() const {
    QVector<QPair<int, QString>> res;
    if (!m_player) return res;
    libvlc_track_description_t *tracks = libvlc_video_get_spu_description(m_player);
    libvlc_track_description_t *curr = tracks;
    while (curr) {
        res.append({curr->i_id, QString::fromUtf8(curr->psz_name ? curr->psz_name : "")});
        curr = curr->p_next;
    }
    if (tracks) libvlc_track_description_list_release(tracks);
    return res;
}

int PlayerEngine::getSubtitleTrack() const {
    return m_player ? libvlc_video_get_spu(m_player) : -1;
}

void PlayerEngine::setSubtitleTrack(int trackId) {
    if (m_player) libvlc_video_set_spu(m_player, trackId);
}

void PlayerEngine::setSubtitleDelay(qint64 ms) {
    m_subDelayMs = ms;
    if (m_player) {
        libvlc_video_set_spu_delay(m_player, ms * 1000LL);
    }
}

qint64 PlayerEngine::getSubtitleDelay() const {
    if (m_player) {
        return libvlc_video_get_spu_delay(m_player) / 1000LL;
    }
    return m_subDelayMs;
}

void PlayerEngine::setAudioDelay(qint64 ms) {
    m_audioDelayMs = ms;
    if (m_player) {
        libvlc_audio_set_delay(m_player, ms * 1000LL);
    }
}

qint64 PlayerEngine::getAudioDelay() const {
    if (m_player) {
        return libvlc_audio_get_delay(m_player) / 1000LL;
    }
    return m_audioDelayMs;
}

void PlayerEngine::applyVideoAdjustments() {
    if (!m_player) return;
    libvlc_video_set_adjust_int(m_player, libvlc_adjust_Enable, 1);
    libvlc_video_set_adjust_float(m_player, libvlc_adjust_Brightness, m_brightness);
    libvlc_video_set_adjust_float(m_player, libvlc_adjust_Contrast, m_contrast);
    libvlc_video_set_adjust_float(m_player, libvlc_adjust_Saturation, m_saturation);
    libvlc_video_set_adjust_float(m_player, libvlc_adjust_Gamma, m_gamma);
}

void PlayerEngine::setBrightness(float b) {
    m_brightness = qBound(0.0f, b, 2.0f);
    if (m_player) {
        libvlc_video_set_adjust_int(m_player, libvlc_adjust_Enable, 1);
        libvlc_video_set_adjust_float(m_player, libvlc_adjust_Brightness, m_brightness);
    }
    emit videoAdjustChanged(m_brightness, m_contrast, m_saturation, m_gamma);
}

void PlayerEngine::setContrast(float c) {
    m_contrast = qBound(0.0f, c, 2.0f);
    if (m_player) {
        libvlc_video_set_adjust_int(m_player, libvlc_adjust_Enable, 1);
        libvlc_video_set_adjust_float(m_player, libvlc_adjust_Contrast, m_contrast);
    }
    emit videoAdjustChanged(m_brightness, m_contrast, m_saturation, m_gamma);
}

void PlayerEngine::setSaturation(float s) {
    m_saturation = qBound(0.0f, s, 3.0f);
    if (m_player) {
        libvlc_video_set_adjust_int(m_player, libvlc_adjust_Enable, 1);
        libvlc_video_set_adjust_float(m_player, libvlc_adjust_Saturation, m_saturation);
    }
    emit videoAdjustChanged(m_brightness, m_contrast, m_saturation, m_gamma);
}

void PlayerEngine::setGamma(float g) {
    m_gamma = qBound(0.1f, g, 5.0f);
    if (m_player) {
        libvlc_video_set_adjust_int(m_player, libvlc_adjust_Enable, 1);
        libvlc_video_set_adjust_float(m_player, libvlc_adjust_Gamma, m_gamma);
    }
    emit videoAdjustChanged(m_brightness, m_contrast, m_saturation, m_gamma);
}

void PlayerEngine::resetVideoAdjust() {
    m_brightness = 1.0f;
    m_contrast = 1.0f;
    m_saturation = 1.0f;
    m_gamma = 1.0f;
    applyVideoAdjustments();
    emit videoAdjustChanged(m_brightness, m_contrast, m_saturation, m_gamma);
}

MediaStats PlayerEngine::getMediaStats() const {
    MediaStats stats;
    if (!m_player) return stats;

    libvlc_media_t *media = libvlc_media_player_get_media(m_player);
    if (!media) return stats;

    libvlc_media_stats_t vlcStats;
    if (libvlc_media_get_stats(media, &vlcStats)) {
        stats.droppedFrames = vlcStats.i_lost_pictures;
        stats.displayedFrames = vlcStats.i_displayed_pictures;
        stats.decodedVideo = vlcStats.i_decoded_video;
        stats.decodedAudio = vlcStats.i_decoded_audio;
        stats.inputBitrate = vlcStats.f_input_bitrate * 8000.0f;
        stats.bitrate = vlcStats.f_demux_bitrate * 8000.0f;
    }

    libvlc_media_track_t **tracks = nullptr;
    unsigned int count = libvlc_media_tracks_get(media, &tracks);
    if (tracks) {
        for (unsigned int i = 0; i < count; ++i) {
            if (tracks[i]->i_type == libvlc_track_video && tracks[i]->video) {
                stats.width = tracks[i]->video->i_width;
                stats.height = tracks[i]->video->i_height;
                if (tracks[i]->video->i_frame_rate_den > 0) {
                    stats.fps = (float)tracks[i]->video->i_frame_rate_num / (float)tracks[i]->video->i_frame_rate_den;
                }
                char fourcc[5] = {0};
                memcpy(fourcc, &tracks[i]->i_codec, 4);
                stats.videoCodec = QString::fromLatin1(fourcc).trimmed().toUpper();
            } else if (tracks[i]->i_type == libvlc_track_audio && tracks[i]->audio) {
                char fourcc[5] = {0};
                memcpy(fourcc, &tracks[i]->i_codec, 4);
                stats.audioCodec = QString::fromLatin1(fourcc).trimmed().toUpper();
            }
        }
        libvlc_media_tracks_release(tracks, count);
    }
    return stats;
}

bool PlayerEngine::loadExternalSubtitle(const QString &subPath) {
    QFileInfo fi(subPath);
    if (m_player && fi.exists()) {
        QString norm = QDir::toNativeSeparators(fi.absoluteFilePath());
        return libvlc_video_set_subtitle_file(m_player, norm.toUtf8().constData()) != 0;
    }
    return false;
}

void PlayerEngine::setAspectRatio(const QString &ratioStr) {
    if (!m_player) return;
    if (ratioStr == "Fill" || ratioStr == "Fit" || ratioStr.isEmpty()) {
        libvlc_video_set_aspect_ratio(m_player, nullptr);
    } else {
        libvlc_video_set_aspect_ratio(m_player, ratioStr.toUtf8().constData());
    }
}

bool PlayerEngine::takeSnapshot(const QString &outputFilepath) {
    if (!m_player) return false;
    return libvlc_video_take_snapshot(m_player, 0, outputFilepath.toUtf8().constData(), 0, 0) == 0;
}

void PlayerEngine::ensureAudioTrackSelected() {
    if (!m_player) return;

#ifdef _WIN32
    forceUnmuteWindowsAudioSession();
#endif

    int cur = libvlc_audio_get_track(m_player);
    libvlc_track_description_t *tracks = libvlc_audio_get_track_description(m_player);
    libvlc_track_description_t *curr = tracks;
    if (cur <= 0) {
        while (curr) {
            if (curr->i_id > 0) {
                libvlc_audio_set_track(m_player, curr->i_id);
                cur = curr->i_id;
                break;
            }
            curr = curr->p_next;
        }
    }
    if (tracks) {
        libvlc_track_description_list_release(tracks);
    }

    if (cur > 0) {
        m_audioTrackPrimed = true;
        libvlc_audio_set_mute(m_player, m_muted ? 1 : 0);
        libvlc_audio_set_volume(m_player, m_volume > 0 ? m_volume : 100);
    }
}

void PlayerEngine::handleVlcEvent(const libvlc_event_t *event, void *userData) {
    PlayerEngine *engine = static_cast<PlayerEngine *>(userData);
    if (!engine || !event) return;

    // VLC fires this callback from its internal thread.
    // Use QueuedConnection to safely marshal signals back to the Qt main thread.
    switch (event->type) {
    case libvlc_MediaPlayerPlaying:
        engine->m_isPaused = false;
        QMetaObject::invokeMethod(engine, [engine]() {
            if (engine->m_player) {
                engine->ensureAudioTrackSelected();
                libvlc_audio_set_mute(engine->m_player, engine->m_muted ? 1 : 0);
                libvlc_audio_set_volume(engine->m_player, engine->m_volume > 0 ? engine->m_volume : 100);
            }
            emit engine->stateChanged("playing");
        }, Qt::QueuedConnection);
        break;
    case libvlc_MediaPlayerPaused:
        engine->m_isPaused = true;
        QMetaObject::invokeMethod(engine, [engine]() {
            emit engine->stateChanged("paused");
        }, Qt::QueuedConnection);
        break;
    case libvlc_MediaPlayerStopped:
        engine->m_isPaused = false;
        QMetaObject::invokeMethod(engine, [engine]() {
            emit engine->stateChanged("stopped");
        }, Qt::QueuedConnection);
        break;
    case libvlc_MediaPlayerPositionChanged: {
        float pos = event->u.media_player_position_changed.new_position;
        QMetaObject::invokeMethod(engine, [engine, pos]() {
            emit engine->positionChanged(pos);
        }, Qt::QueuedConnection);
        break;
    }
    case libvlc_MediaPlayerTimeChanged: {
        libvlc_time_t t = event->u.media_player_time_changed.new_time;
        QMetaObject::invokeMethod(engine, [engine, t]() {
            emit engine->timeChanged(t);
        }, Qt::QueuedConnection);
        break;
    }
    case libvlc_MediaPlayerLengthChanged: {
        libvlc_time_t len = event->u.media_player_length_changed.new_length;
        QMetaObject::invokeMethod(engine, [engine, len]() {
            emit engine->durationChanged(len);
        }, Qt::QueuedConnection);
        break;
    }
    case libvlc_MediaPlayerEndReached:
        QMetaObject::invokeMethod(engine, [engine]() {
            emit engine->stateChanged("ended");
        }, Qt::QueuedConnection);
        break;
    case libvlc_MediaPlayerEncounteredError:
        QMetaObject::invokeMethod(engine, [engine]() {
            emit engine->stateChanged("error");
        }, Qt::QueuedConnection);
        break;
    case libvlc_MediaPlayerESAdded:
        QMetaObject::invokeMethod(engine, [engine]() {
            engine->ensureAudioTrackSelected();
        }, Qt::QueuedConnection);
        break;
    default:
        break;
    }
}


