#ifndef PLAYERENGINE_H
#define PLAYERENGINE_H

#include <QObject>
#include <QString>
#include <QPair>
#include <QVector>
#include "vlc/vlc.h"

struct MediaStats {
    QString videoCodec = "N/A";
    QString audioCodec = "N/A";
    int width = 0;
    int height = 0;
    float fps = 0.0f;
    float bitrate = 0.0f;
    int droppedFrames = 0;
    int displayedFrames = 0;
    int decodedVideo = 0;
    int decodedAudio = 0;
    float inputBitrate = 0.0f;
};

class PlayerEngine : public QObject {
    Q_OBJECT

public:
    explicit PlayerEngine(QObject *parent = nullptr);
    ~PlayerEngine();

    void shutdown();
    void muteImmediately();
    void setWindowHandle(void *winId);
    bool loadMedia(const QString &fileOrUrl, const QString &audioUrl = "");

    void play();
    void pause();
    void togglePlay();
    void stop();

    bool isPlaying() const;
    void seekPosition(float pos);
    void seekTime(qint64 ms);

    qint64 getTime() const;
    qint64 getDuration() const;

    void setVolume(int volume);
    int getVolume() const { return m_volume; }
    bool toggleMute();

    void setSpeed(float speed);
    float getSpeed() const;

    QVector<QPair<int, QString>> getVideoTracks() const;
    int getVideoTrack() const;
    void setVideoTrack(int trackId);

    QVector<QPair<int, QString>> getAudioTracks() const;
    int getAudioTrack() const;
    void setAudioTrack(int trackId);

    QVector<QPair<int, QString>> getSubtitleTracks() const;
    int getSubtitleTrack() const;
    void setSubtitleTrack(int trackId);

    void setSubtitleDelay(qint64 ms);
    qint64 getSubtitleDelay() const;

    void setAudioDelay(qint64 ms);
    qint64 getAudioDelay() const;

    // Video Adjustments (0.0 to 2.0)
    void setBrightness(float b);
    float getBrightness() const { return m_brightness; }
    void setContrast(float c);
    float getContrast() const { return m_contrast; }
    void setSaturation(float s);
    float getSaturation() const { return m_saturation; }
    void setGamma(float g);
    float getGamma() const { return m_gamma; }
    void resetVideoAdjust();

    // Technical Stats
    MediaStats getMediaStats() const;

    bool loadExternalSubtitle(const QString &subPath);
    void setAspectRatio(const QString &ratioStr);
    bool takeSnapshot(const QString &outputFilepath);

signals:
    void positionChanged(float pos);
    void timeChanged(qint64 ms);
    void durationChanged(qint64 ms);
    void stateChanged(const QString &state);
    void mediaLoaded(const QString &mediaTitle);
    void videoAdjustChanged(float brightness, float contrast, float saturation, float gamma);

private:
    libvlc_instance_t *m_instance = nullptr;
    libvlc_media_player_t *m_player = nullptr;
    libvlc_event_manager_t *m_eventManager = nullptr;

    void *m_currentWinId = nullptr;
    QString m_currentMediaPath;
    QString m_pendingAudioSlave;
    int m_volume = 100;
    bool m_muted = false;
    bool m_isPaused = false;
    bool m_audioTrackPrimed = false;
    float m_speed = 1.0f;

    // Video adjustments
    float m_brightness = 1.0f;
    float m_contrast = 1.0f;
    float m_saturation = 1.0f;
    float m_gamma = 1.0f;

    // Delay offsets in ms
    qint64 m_subDelayMs = 0;
    qint64 m_audioDelayMs = 0;

    void attachEvents();
    void detachEvents();
    void ensureAudioTrackSelected();
    void applyVideoAdjustments();

    static void handleVlcEvent(const libvlc_event_t *event, void *userData);
};

#endif // PLAYERENGINE_H
