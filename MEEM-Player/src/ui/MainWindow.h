#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QTimer>
#include <QPoint>
#include "../core/PlayerEngine.h"
#include "../core/PlaylistManager.h"
#include "VideoCanvasWidget.h"
#include "ControlBarWidget.h"
#include "PlaylistDrawer.h"
#include "SettingsDrawer.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

    void playIndex(int index, const QString &audioUrl = "");
    void toggleFullscreen();
    void togglePiP();
    void toggleNerdStats();

    PlaylistManager *getPlaylistManager() { return &m_playlistMgr; }
    PlayerEngine *getPlayerEngine() { return &m_playerEngine; }

    void setMediaTitle(const QString &title, const QString &subtitle = "");
    void setPoster(const QString &posterPath);
    void toggleMaximize();

    void setupPlaybackSync(const QString &pbKey, const QString &profileId, const QString &syncFile, int syncPort);
    void reportPlaybackProgress(bool force = false, bool isEnded = false);
    void setPendingStartTime(float sec);
    void setYouTubeContext(const QString &videoId, const QString &quality);
    void changeYouTubeQuality(const QString &quality);
    void setMediaIds(const QString &tmdbId, const QString &imdbId, const QString &mediaType, int season, int episode, const QString &tmdbApiKey, const QString &subdlApiKey);
    void autoFetchTmdbMetadata();

protected:
    void resizeEvent(QResizeEvent *event) override;
    void moveEvent(QMoveEvent *event) override;
    void showEvent(QShowEvent *event) override;
    void hideEvent(QHideEvent *event) override;
    void closeEvent(QCloseEvent *event) override;
    void changeEvent(QEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    bool nativeEvent(const QByteArray &eventType, void *message, qintptr *result) override;
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    PlayerEngine m_playerEngine;
    PlaylistManager m_playlistMgr;

    VideoCanvasWidget *m_videoCanvas = nullptr;
    TopBarWidget *m_topBar = nullptr;
    BottomBarWidget *m_bottomBar = nullptr;
    PlaylistDrawer *m_playlistDrawer = nullptr;
    SettingsDrawer *m_settingsDrawer = nullptr;

    // Nerd Stats Overlay HUD
    QWidget *m_statsOverlay = nullptr;
    QLabel *m_statsLabel = nullptr;
    QTimer m_statsTimer;

    QTimer m_mouseCheckTimer;
    QTimer m_autohideTimer;
    QPoint m_lastCursorPos;
    bool m_isFullscreen = false;
    bool m_isPiP = false;
    QRect m_prePiPGeometry;

    QString m_syncPbKey;
    QString m_syncBaseId;
    QString m_syncProfileId;
    QString m_syncFile;
    int m_syncPort = 0;
    qint64 m_lastReportedWall = 0;
    float m_lastReportedSec = -1.0f;
    float m_pendingStartTimeSec = 0.0f;
    bool m_initialSeekDone = false;
    QString m_overrideTitle;
    QString m_overrideSubtitle;
    QString m_ytVideoId;
    QString m_ytQuality = "1080";

    QString m_tmdbId;
    QString m_imdbId;
    QString m_mediaType = "tv";
    int m_season = 0;
    int m_episode = 0;
    QString m_tmdbApiKey = "14cc163152a514d455d31590ab8d4d8c";
    QString m_subdlApiKey;
    class QNetworkAccessManager *m_netMgr = nullptr;

    void initUi();
    void setupConnections();
    void updateOverlayGeometry();

    void checkGlobalMouseMove();
    void showOverlays();
    void hideOverlays();

    void openFilesDialog();
    void openFolderDialog();
    void openPlaylistDialog();
    void openSubtitleDialog();
};

#endif // MAINWINDOW_H
