#include "MainWindow.h"
#include "styles.h"
#include <QFileDialog>
#include <QCursor>
#include <QKeyEvent>
#include <QCloseEvent>
#include <QApplication>
#include <QFileInfo>
#include <QDir>
#include <QLineEdit>
#include <QDebug>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonDocument>
#include <QDateTime>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QUrl>
#include <QUrlQuery>
#include <iostream>
#include <cmath>
#include <cstdlib>
#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent), m_playlistMgr("config.json", this)
{
    setWindowTitle("MEEM Player");
    resize(1152, 648); // Exact 16:9 ratio so videos fill without letterbox
    setMinimumSize(640, 360); // Flexible 16:9 min size
    setWindowFlags(Qt::WindowType::FramelessWindowHint | Qt::WindowType::Window);
    setStyleSheet("QMainWindow { background-color: #0A0A0C; } " + QString(BLACK_WHITE_STYLESHEET));

    QString icoPath = QApplication::applicationDirPath() + "/assets/ico.png";
    if (!QFileInfo::exists(icoPath)) {
        icoPath = "assets/ico.png";
    }
    if (QFileInfo::exists(icoPath)) {
        setWindowIcon(QIcon(icoPath));
    }

    initUi();
    setupConnections();

    // Initialize volume from saved config
    int savedVol = m_playlistMgr.getVolume();
    m_playerEngine.setVolume(savedVol);
    m_bottomBar->setVolume(savedVol);

    m_autohideTimer.setSingleShot(true);
    connect(&m_autohideTimer, &QTimer::timeout, this, &MainWindow::hideOverlays);

    m_mouseCheckTimer.setInterval(200);
    connect(&m_mouseCheckTimer, &QTimer::timeout, this, &MainWindow::checkGlobalMouseMove);
    m_mouseCheckTimer.start();

    // Global keyboard shortcuts event filter
    qApp->installEventFilter(this);
}

MainWindow::~MainWindow() {
    // closeEvent handles reportPlaybackProgress + shutdown before destruction.
    // Nothing to do here — avoid double-calling after m_player is already nullptr.
}

void MainWindow::initUi() {
    m_videoCanvas = new VideoCanvasWidget(this);
    m_videoCanvas->setObjectName("VideoCanvas");
    m_videoCanvas->setStyleSheet("background-color: #0A0A0C;");
    setCentralWidget(m_videoCanvas);

    QString iconsPath = QApplication::applicationDirPath() + "/assets/icons";
    if (!QFileInfo::exists(iconsPath)) {
        iconsPath = QString("assets/icons"); // dev fallback
    }

    m_videoCanvas->setIconsBasePath(iconsPath);
    m_videoCanvas->setMediaActive(false);

    // Top control bar
    m_topBar = new TopBarWidget(this);
    m_topBar->setWindowFlags(Qt::WindowType::Tool | Qt::WindowType::FramelessWindowHint | Qt::WindowType::NoDropShadowWindowHint);
    m_topBar->setAttribute(Qt::WA_TranslucentBackground, true);
    m_topBar->setAttribute(Qt::WA_NoSystemBackground, true);
    m_topBar->setAttribute(Qt::WA_ShowWithoutActivating, true);
    m_topBar->setIconsBasePath(iconsPath);
    m_topBar->setMediaActive(false);

    // Bottom control bar (hidden when idle)
    m_bottomBar = new BottomBarWidget(this);
    m_bottomBar->setWindowFlags(Qt::WindowType::Tool | Qt::WindowType::FramelessWindowHint | Qt::WindowType::NoDropShadowWindowHint);
    m_bottomBar->setAttribute(Qt::WA_TranslucentBackground, true);
    m_bottomBar->setAttribute(Qt::WA_NoSystemBackground, true);
    m_bottomBar->setAttribute(Qt::WA_ShowWithoutActivating, true);
    m_bottomBar->setIconsBasePath(iconsPath);
    m_bottomBar->hide();

    m_playlistDrawer = new PlaylistDrawer(&m_playlistMgr, this);
    m_playlistDrawer->setIconsBasePath(iconsPath);
    m_playlistDrawer->hide();

    m_settingsDrawer = new SettingsDrawer(&m_playerEngine, this);
    m_settingsDrawer->setIconsBasePath(iconsPath);
    m_settingsDrawer->hide();

    // Nerd Stats Overlay HUD
    m_statsOverlay = new QWidget(this);
    m_statsOverlay->setObjectName("StatsOverlay");
    m_statsOverlay->setFixedSize(300, 210);
    m_statsOverlay->setStyleSheet(
        "QWidget#StatsOverlay {"
        "  background: rgba(10, 10, 14, 220);"
        "  border: 1px solid rgba(255, 255, 255, 40);"
        "  border-radius: 12px;"
        "}"
    );
    QVBoxLayout *statsLayout = new QVBoxLayout(m_statsOverlay);
    statsLayout->setContentsMargins(14, 10, 14, 10);
    statsLayout->setSpacing(4);

    QLabel *statsTitle = new QLabel("NERD STATS (DIAGNOSTICS)", m_statsOverlay);
    statsTitle->setStyleSheet("font-size: 11px; font-weight: 800; color: #818CF8; letter-spacing: 1px; background: transparent;");
    statsLayout->addWidget(statsTitle);

    m_statsLabel = new QLabel("", m_statsOverlay);
    m_statsLabel->setStyleSheet("font-size: 11px; color: #E0E0EC; font-family: 'Consolas', monospace; background: transparent;");
    statsLayout->addWidget(m_statsLabel);

    m_statsOverlay->hide();

    connect(&m_statsTimer, &QTimer::timeout, this, [this]() {
        if (!m_statsOverlay || !m_statsOverlay->isVisible()) return;
        MediaStats s = m_playerEngine.getMediaStats();
        QString info = QString(
            "Resolution: %1x%2\n"
            "Framerate: %3 FPS\n"
            "Video Codec: %4\n"
            "Audio Codec: %5\n"
            "Bitrate: %6 kbps\n"
            "Dropped Frames: %7\n"
            "Displayed: %8\n"
            "Speed: %9x | Volume: %10%\n"
            "Sub Delay: %11ms | Aud: %12ms"
        )
        .arg(s.width).arg(s.height)
        .arg(QString::number(s.fps, 'f', 2))
        .arg(s.videoCodec.isEmpty() ? "H264/DXVA2" : s.videoCodec)
        .arg(s.audioCodec.isEmpty() ? "AAC/PCM" : s.audioCodec)
        .arg(static_cast<int>(s.bitrate))
        .arg(s.droppedFrames)
        .arg(s.displayedFrames)
        .arg(QString::number(m_playerEngine.getSpeed(), 'f', 2))
        .arg(m_playerEngine.getVolume())
        .arg(m_playerEngine.getSubtitleDelay())
        .arg(m_playerEngine.getAudioDelay());

        m_statsLabel->setText(info);
    });

    updateOverlayGeometry();
}

void MainWindow::setupConnections() {
    // Video canvas signals
    connect(m_videoCanvas, &VideoCanvasWidget::filesDropped, this, [this](const QStringList &paths) {
        for (const QString &p : paths) {
            QFileInfo fi(p);
            if (fi.suffix().toLower() == "srt" || fi.suffix().toLower() == "vtt") {
                m_playerEngine.loadExternalSubtitle(p);
            } else {
                m_playlistMgr.addItem(p);
            }
        }
        if (!m_playerEngine.isPlaying() && m_playlistMgr.getCurrentIndex() == -1) {
            playIndex(0);
        }
    });

    connect(m_videoCanvas, &VideoCanvasWidget::mouseMovedSignal, this, &MainWindow::showOverlays);
    connect(m_videoCanvas, &VideoCanvasWidget::clickedSignal, this, [this]() {
        m_playerEngine.togglePlay();
    });
    connect(m_videoCanvas, &VideoCanvasWidget::doubleClickedSignal, this, &MainWindow::toggleFullscreen);
    connect(m_videoCanvas, &VideoCanvasWidget::openFileRequested, this, &MainWindow::openFilesDialog);

    // Smart Gestures
    connect(m_videoCanvas, &VideoCanvasWidget::volumeAdjustRequested, this, [this](int delta) {
        int v = qBound(0, m_playerEngine.getVolume() + delta, 150);
        m_playerEngine.setVolume(v);
        m_bottomBar->setVolume(v);
        m_playlistMgr.setVolume(v);
        m_videoCanvas->showOsdToast("Volume", v);
    });

    connect(m_videoCanvas, &VideoCanvasWidget::brightnessAdjustRequested, this, [this](float delta) {
        float b = qBound(0.0f, m_playerEngine.getBrightness() + delta, 2.0f);
        m_playerEngine.setBrightness(b);
        m_videoCanvas->showOsdToast("Brightness", static_cast<int>(b * 100.0f));
    });

    // Player Engine Signals
    connect(&m_playerEngine, &PlayerEngine::positionChanged, this, [this](float pos) {
        m_bottomBar->setPositionRatio(pos);
        m_playlistMgr.updatePosition(m_playerEngine.getTime(), m_playerEngine.getDuration());
    });

    connect(&m_playerEngine, &PlayerEngine::timeChanged, this, [this](qint64 ms) {
        m_bottomBar->setTime(ms, m_playerEngine.getDuration());

        // Perform initial resume seek if pending and media is demuxed
        if (!m_initialSeekDone && m_pendingStartTimeSec > 0.0f && m_playerEngine.getDuration() > 0) {
            float curSec = (float)ms / 1000.0f;
            if (std::abs(curSec - m_pendingStartTimeSec) > 3.0f && curSec < 2.0f) {
                m_playerEngine.seekTime(static_cast<qint64>(m_pendingStartTimeSec * 1000.0f));
            } else {
                m_initialSeekDone = true;
            }
        }

        // Periodic progress reporting every 3 seconds
        qint64 nowWall = QDateTime::currentMSecsSinceEpoch();
        float timeSec = (float)ms / 1000.0f;
        if ((nowWall - m_lastReportedWall >= 3000) || (std::abs(timeSec - m_lastReportedSec) >= 4.0f)) {
            reportPlaybackProgress(false, false);
        }
    });

    connect(&m_playerEngine, &PlayerEngine::durationChanged, this, [this](qint64 ms) {
        m_bottomBar->setTime(m_playerEngine.getTime(), ms);
        if (!m_initialSeekDone && m_pendingStartTimeSec > 0.0f && ms > 0) {
            m_playerEngine.seekTime(static_cast<qint64>(m_pendingStartTimeSec * 1000.0f));
        }
    });

    connect(&m_playerEngine, &PlayerEngine::timeChanged, this, [this](qint64 ms) {
        if (ms > 100 && m_videoCanvas && m_videoCanvas->isLoading()) {
            m_videoCanvas->hideLoading();
        }
    });

    connect(&m_playerEngine, &PlayerEngine::stateChanged, this, [this](const QString &state) {
        if (state == "playing") {
            // Keep loading screen smooth until first frames arrive
            QTimer::singleShot(350, this, [this]() {
                if (m_playerEngine.isPlaying() && m_videoCanvas && m_videoCanvas->isLoading()) {
                    m_videoCanvas->hideLoading();
                }
            });
            m_bottomBar->setPlaybackState(true);
            m_settingsDrawer->refreshTracks();
            m_videoCanvas->hookChildWindows();
            if (!m_initialSeekDone && m_pendingStartTimeSec > 0.0f) {
                QTimer::singleShot(250, this, [this]() {
                    if (!m_initialSeekDone && m_pendingStartTimeSec > 0.0f) {
                        m_playerEngine.seekTime(static_cast<qint64>(m_pendingStartTimeSec * 1000.0f));
                    }
                });
            }
        } else if (state == "paused") {
            m_bottomBar->setPlaybackState(false);
            reportPlaybackProgress(true, false);
        } else if (state == "stopped") {
            m_videoCanvas->hideLoading();
            m_bottomBar->setPlaybackState(false);
            reportPlaybackProgress(true, false);
        } else if (state == "ended") {
            m_videoCanvas->hideLoading();
            reportPlaybackProgress(true, true);
            PlaylistItem *nextItem = m_playlistMgr.getNextItem();
            if (nextItem) {
                m_playerEngine.loadMedia(nextItem->path, nextItem->audioUrl);
                m_playerEngine.play();
            } else {
                m_bottomBar->setPlaybackState(false);
            }
        } else if (state == "error") {
            m_videoCanvas->hideLoading();
            m_bottomBar->setPlaybackState(false);
        }
    });

    // Top Bar signals
    connect(m_topBar, &TopBarWidget::openFileClicked, this, &MainWindow::openFilesDialog);
    connect(m_topBar, &TopBarWidget::homeClicked, this, [this]() {
        m_autohideTimer.stop();
        m_playerEngine.stop();
        m_playlistMgr.setCurrentIndex(-1);
        m_videoCanvas->hideLoading();
        m_videoCanvas->setMediaActive(false);
        m_topBar->setMediaTitle("MEEM Player", "");
        m_topBar->setMediaActive(false);
        m_bottomBar->setPositionRatio(0.0f);
        m_bottomBar->setTime(0, 0);
        m_bottomBar->hide();
        m_playlistDrawer->hide();
        m_settingsDrawer->hide();
    });

    // Bottom Bar signals
    connect(m_bottomBar, &BottomBarWidget::playPauseToggled, this, [this]() {
        m_playerEngine.togglePlay();
    });

    connect(m_bottomBar, &BottomBarWidget::prevClicked, this, [this]() {
        PlaylistItem *item = m_playlistMgr.getPreviousItem();
        if (item) {
            m_playerEngine.loadMedia(item->path, item->audioUrl);
            m_playerEngine.play();
        }
    });

    connect(m_bottomBar, &BottomBarWidget::nextClicked, this, [this]() {
        PlaylistItem *item = m_playlistMgr.getNextItem();
        if (item) {
            m_playerEngine.loadMedia(item->path, item->audioUrl);
            m_playerEngine.play();
        }
    });

    connect(m_bottomBar, &BottomBarWidget::seekRequested, &m_playerEngine, &PlayerEngine::seekPosition);
    connect(m_bottomBar, &BottomBarWidget::volumeChanged, this, [this](int v) {
        m_playerEngine.setVolume(v);
        m_playlistMgr.setVolume(v);
    });
    connect(m_bottomBar, &BottomBarWidget::muteToggled, this, [this]() {
        bool muted = m_playerEngine.toggleMute();
        if (muted) {
            m_bottomBar->setVolume(0);
        } else {
            int v = m_playerEngine.getVolume() > 0 ? m_playerEngine.getVolume() : 80;
            m_bottomBar->setVolume(v);
            m_playlistMgr.setVolume(v);
        }
    });

    connect(m_bottomBar, &BottomBarWidget::playlistToggled, this, [this]() {
        if (m_playlistDrawer->isVisible()) {
            m_playlistDrawer->hide();
        } else {
            if (m_settingsDrawer) m_settingsDrawer->hide(); // Prevent layer overlap
            if (!m_playlistDrawer->property("userMoved").toBool()) {
                QPoint gPos = mapToGlobal(QPoint(width() - m_playlistDrawer->width() - 24, 70));
                m_playlistDrawer->move(gPos);
            }
            m_playlistDrawer->refreshList();
            m_playlistDrawer->show();
            m_playlistDrawer->raise();
            m_playlistDrawer->activateWindow();
        }
    });

    connect(m_bottomBar, &BottomBarWidget::settingsToggled, this, [this]() {
        if (m_settingsDrawer->isVisible()) {
            m_settingsDrawer->hide();
        } else {
            if (m_playlistDrawer) m_playlistDrawer->hide(); // Prevent layer overlap
            if (!m_settingsDrawer->property("userMoved").toBool()) {
                QPoint gPos = mapToGlobal(QPoint(width() - m_settingsDrawer->width() - 24, 70));
                m_settingsDrawer->move(gPos);
            }
            m_settingsDrawer->refreshTracks();
            m_settingsDrawer->show();
            m_settingsDrawer->raise();
            m_settingsDrawer->activateWindow();
        }
    });

    connect(m_bottomBar, &BottomBarWidget::seekOffsetRequested, this, [this](qint64 offsetMs) {
        m_playerEngine.seekTime(m_playerEngine.getTime() + offsetMs);
    });
    connect(m_bottomBar, &BottomBarWidget::pipToggled, this, &MainWindow::togglePiP);
    connect(m_bottomBar, &BottomBarWidget::fullscreenToggled, this, &MainWindow::toggleFullscreen);

    // Playlist Drawer signals
    connect(m_playlistDrawer, &PlaylistDrawer::itemSelected, this, [this](int idx) {
        playIndex(idx);
    });
    connect(m_playlistDrawer, &PlaylistDrawer::addFilesRequested, this, &MainWindow::openFilesDialog);
    connect(m_playlistDrawer, &PlaylistDrawer::addFolderRequested, this, &MainWindow::openFolderDialog);
    connect(m_playlistDrawer, &PlaylistDrawer::clearRequested, &m_playlistMgr, &PlaylistManager::clear);

    // Settings Drawer signals
    connect(m_settingsDrawer, &SettingsDrawer::loadSubtitleRequested, this, &MainWindow::openSubtitleDialog);
    connect(m_settingsDrawer, &SettingsDrawer::qualitySelected, this, &MainWindow::changeYouTubeQuality);
    connect(m_settingsDrawer, &SettingsDrawer::toggleNerdStatsRequested, this, &MainWindow::toggleNerdStats);
}

void MainWindow::setYouTubeContext(const QString &videoId, const QString &quality) {
    m_ytVideoId = videoId;
    m_ytQuality = quality.isEmpty() ? "1080" : quality;
    if (m_settingsDrawer) {
        m_settingsDrawer->setCurrentQuality(m_ytQuality);
        m_settingsDrawer->setQualityVisible(!m_ytVideoId.isEmpty());
    }
}

void MainWindow::changeYouTubeQuality(const QString &quality) {
    m_ytQuality = quality;
    if (m_ytVideoId.isEmpty()) return;

    int port = (m_syncPort > 0) ? m_syncPort : 11470;
    QString apiUrl = QString("http://127.0.0.1:%1/api/youtube/details?v=%2&quality=%3&format=json")
                     .arg(port)
                     .arg(m_ytVideoId)
                     .arg(quality);

    qint64 currentMs = m_playerEngine.getTime();

    QNetworkAccessManager *nam = new QNetworkAccessManager(this);
    QNetworkRequest req((QUrl(apiUrl)));
    req.setHeader(QNetworkRequest::UserAgentHeader, "MEEM-Player");

    QNetworkReply *reply = nam->get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply, nam, currentMs]() {
        if (reply->error() == QNetworkReply::NoError) {
            QByteArray data = reply->readAll();
            QJsonDocument doc = QJsonDocument::fromJson(data);
            if (doc.isObject()) {
                QJsonObject obj = doc.object();
                if (obj.value("success").toBool()) {
                    QString newStreamUrl = obj.value("streamUrl").toString();
                    QString newAudioUrl = obj.value("audioStreamUrl").toString();
                    if (!newStreamUrl.isEmpty()) {
                        m_playerEngine.loadMedia(newStreamUrl, newAudioUrl);
                        m_playerEngine.play();
                        if (currentMs > 0) {
                            QTimer::singleShot(60, this, [this, currentMs]() {
                                m_playerEngine.seekTime(currentMs);
                            });
                        }
                    }
                }
            }
        }
        reply->deleteLater();
        nam->deleteLater();
    });
}

void MainWindow::playIndex(int index, const QString &audioUrl) {
    PlaylistItem *item = m_playlistMgr.setCurrentIndex(index);
    if (item) {
        // Flush previous episode progress
        if (m_lastReportedSec > 5.0f) {
            reportPlaybackProgress(true, false);
        }

        // Reset seek time for new episode unless explicitly primed for index 0
        if (index > 0) {
            m_pendingStartTimeSec = 0.0f;
        }
        m_initialSeekDone = (m_pendingStartTimeSec <= 0.0f);
        m_lastReportedSec = -1.0f;
        m_lastReportedWall = 0;

        if (!m_syncBaseId.isEmpty()) {
            if (!m_syncBaseId.contains('/') && !m_syncBaseId.contains('\\') && item->season > 0 && item->episode > 0) {
                m_syncPbKey = QString("%1_S%2E%3").arg(m_syncBaseId).arg(item->season).arg(item->episode);
            } else if (index > 0 && !item->path.isEmpty()) {
                m_syncPbKey = item->path;
            }
        }
        m_videoCanvas->show();
        m_videoCanvas->raise();
        m_videoCanvas->setMediaActive(true);

        QString displayTitle = item->title;
        QString displaySubtitle = item->showTitle;
        if (!m_overrideTitle.isEmpty()) {
            if (m_playlistMgr.getItems().size() <= 1 || item->season <= 0) {
                displayTitle = m_overrideTitle;
                if (!m_overrideSubtitle.isEmpty()) {
                    displaySubtitle = m_overrideSubtitle;
                }
            } else if (displaySubtitle.isEmpty()) {
                displaySubtitle = m_overrideTitle;
            }
        }

        m_topBar->setMediaTitle(displayTitle, displaySubtitle);
        m_topBar->setMediaActive(true);
        m_videoCanvas->showLoading(displayTitle, displaySubtitle, item ? item->thumbnail : "");
        m_bottomBar->setTime(0, 0);
        m_bottomBar->setPositionRatio(0.0f);
        m_bottomBar->show();
        m_bottomBar->raise();

        QString aUrl = audioUrl.isEmpty() ? item->audioUrl : audioUrl;
        m_playerEngine.setWindowHandle(m_videoCanvas->getNativeWinId());
        m_playerEngine.loadMedia(item->path, aUrl);
        m_playerEngine.play();
        showOverlays();

        // Pass media context to SubDL Online Subtitles drawer
        if (m_settingsDrawer) {
            QString useImdb = !item->imdbId.isEmpty() ? item->imdbId : m_imdbId;
            QString useTmdb = !item->tmdbId.isEmpty() ? item->tmdbId : m_tmdbId;
            QString useTitle = !item->showTitle.isEmpty() ? item->showTitle : (!displaySubtitle.isEmpty() ? displaySubtitle : displayTitle);
            int useSeason = (item->season > 0) ? item->season : m_season;
            int useEpisode = (item->episode > 0) ? item->episode : m_episode;
            m_settingsDrawer->setMediaContext(useImdb, useTmdb, useTitle, useSeason, useEpisode, m_subdlApiKey, m_syncPort);
        }

        // Auto load item subtitle if present
        if (!item->subPath.isEmpty() && QFile::exists(item->subPath)) {
            QTimer::singleShot(400, this, [this, sub = item->subPath]() {
                m_playerEngine.loadExternalSubtitle(sub);
            });
        }

        // Auto-fetch TMDB still images and metadata if missing
        if (item->thumbnail.isEmpty() || item->overview.isEmpty()) {
            autoFetchTmdbMetadata();
        }
    }
}

void MainWindow::setMediaTitle(const QString &title, const QString &subtitle) {
    m_overrideTitle = title;
    m_overrideSubtitle = subtitle;
    m_topBar->setMediaTitle(title, subtitle);
}

void MainWindow::setPoster(const QString &posterPath) {
    Q_UNUSED(posterPath);
}

void MainWindow::toggleFullscreen() {
    if (m_isFullscreen) {
        showNormal();
        m_isFullscreen = false;
    } else {
        showFullScreen();
        m_isFullscreen = true;
    }
    updateOverlayGeometry();
}

void MainWindow::toggleMaximize() {
    if (isMaximized()) {
        showNormal();
    } else {
        showMaximized();
    }
    m_topBar->updateMaximizeButton(isMaximized());
    updateOverlayGeometry();
}

void MainWindow::togglePiP() {
    if (m_isPiP) {
        m_isPiP = false;
        setWindowFlags(Qt::WindowType::FramelessWindowHint | Qt::WindowType::Window);
        if (m_prePiPGeometry.isValid()) {
            setGeometry(m_prePiPGeometry);
        } else {
            resize(1152, 648);
        }
        showNormal();
        show();
        raise();
        activateWindow();
    } else {
        m_prePiPGeometry = geometry();
        m_isPiP = true;
        if (m_playlistDrawer) m_playlistDrawer->hide();
        if (m_settingsDrawer) m_settingsDrawer->hide();
        if (m_statsOverlay) m_statsOverlay->hide();

        setWindowFlags(Qt::WindowType::FramelessWindowHint | Qt::WindowType::Window | Qt::WindowType::WindowStaysOnTopHint);
        resize(420, 236);

        QScreen *screen = QApplication::primaryScreen();
        if (screen) {
            QRect avail = screen->availableGeometry();
            move(avail.right() - 440, avail.bottom() - 256);
        }
        show();
        raise();
        activateWindow();
    }
    updateOverlayGeometry();
}

void MainWindow::toggleNerdStats() {
    if (!m_statsOverlay) return;
    if (m_statsOverlay->isVisible()) {
        m_statsOverlay->hide();
        m_statsTimer.stop();
    } else {
        m_statsOverlay->move(24, 70);
        m_statsOverlay->show();
        m_statsOverlay->raise();
        m_statsTimer.start(1000);
    }
}

void MainWindow::changeEvent(QEvent *event) {
    QMainWindow::changeEvent(event);
    if (event->type() == QEvent::WindowStateChange) {
        m_topBar->updateMaximizeButton(isMaximized());
        if (isMinimized()) {
            if (m_topBar) m_topBar->hide();
            if (m_bottomBar) m_bottomBar->hide();
            if (m_playlistDrawer) m_playlistDrawer->hide();
            if (m_settingsDrawer) m_settingsDrawer->hide();
        } else {
            showOverlays();
        }
        updateOverlayGeometry();
    }
}

void MainWindow::hideEvent(QHideEvent *event) {
    QMainWindow::hideEvent(event);
    if (m_topBar) m_topBar->hide();
    if (m_bottomBar) m_bottomBar->hide();
    if (m_playlistDrawer) m_playlistDrawer->hide();
    if (m_settingsDrawer) m_settingsDrawer->hide();
}

void MainWindow::closeEvent(QCloseEvent *event) {
    // 1. Immediately hide main window and all child windows so nothing lingers on screen
    hide();
    if (m_topBar) m_topBar->hide();
    if (m_bottomBar) m_bottomBar->hide();
    if (m_playlistDrawer) m_playlistDrawer->hide();
    if (m_settingsDrawer) m_settingsDrawer->hide();

    // 2. Stop overlay and mouse checking timers
    m_autohideTimer.stop();
    m_mouseCheckTimer.stop();

    // 3. Save progress before instant exit while engine time and duration are still accurate
    reportPlaybackProgress(true, false);

    // 4. Accept the close event
    event->accept();

    // 5. Instantly terminate process with zero delay.
    // NOTE: We intentionally DO NOT call libvlc_media_player_stop() here because LibVLC
    // synchronously joins remote network streaming threads (YouTube HTTP/HLS/audio slave),
    // which freezes the Win32 message pump for 5+ seconds and triggers Windows'
    // "Not Responding" ghost window dialog. TerminateProcess kills all process threads,
    // closes all sockets, and releases all resources immediately.
#ifdef _WIN32
    ::TerminateProcess(::GetCurrentProcess(), 0);
#else
    _exit(0);
#endif
}

void MainWindow::resizeEvent(QResizeEvent *event) {
    QMainWindow::resizeEvent(event);
    updateOverlayGeometry();
}

void MainWindow::moveEvent(QMoveEvent *event) {
    QMainWindow::moveEvent(event);
    updateOverlayGeometry();
}

void MainWindow::showEvent(QShowEvent *event) {
    QMainWindow::showEvent(event);
    m_playerEngine.setWindowHandle(m_videoCanvas->getNativeWinId());
    updateOverlayGeometry();

    HWND hwnd = (HWND)winId();

    // Lock overlay bars to MainWindow as owned windows (sync minimization, restore, and Z-order)
    if (m_topBar) {
        SetWindowLongPtr((HWND)m_topBar->winId(), GWLP_HWNDPARENT, (LONG_PTR)hwnd);
    }
    if (m_bottomBar) {
        SetWindowLongPtr((HWND)m_bottomBar->winId(), GWLP_HWNDPARENT, (LONG_PTR)hwnd);
    }

    // Enable native resizing, dark mode, and rounded corners
    BOOL darkMode = TRUE;
    DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &darkMode, sizeof(darkMode));
    DWORD preference = 2; // DWMWCP_ROUND
    DwmSetWindowAttribute(hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &preference, sizeof(preference));
    LONG_PTR style = GetWindowLongPtr(hwnd, GWL_STYLE);
    SetWindowLongPtr(hwnd, GWL_STYLE, style | WS_THICKFRAME);
}

bool MainWindow::nativeEvent(const QByteArray &eventType, void *message, qintptr *result) {
    MSG *msg = reinterpret_cast<MSG *>(message);
    if (msg) {
        if (msg->message == WM_WINDOWPOSCHANGED) {
            WINDOWPOS *wp = reinterpret_cast<WINDOWPOS *>(msg->lParam);
            if (wp && (!(wp->flags & SWP_NOMOVE) || !(wp->flags & SWP_NOSIZE))) {
                if (m_topBar && m_topBar->isVisible()) {
                    SetWindowPos((HWND)m_topBar->winId(), nullptr,
                                 wp->x, wp->y, wp->cx, 60,
                                 SWP_NOACTIVATE | SWP_NOZORDER);
                }
                if (m_bottomBar && m_bottomBar->isVisible()) {
                    SetWindowPos((HWND)m_bottomBar->winId(), nullptr,
                                 wp->x, wp->y + wp->cy - 80, wp->cx, 80,
                                 SWP_NOACTIVATE | SWP_NOZORDER);
                }
            }
        }

        if (msg->message == WM_MOVE || msg->message == WM_MOVING || msg->message == WM_SIZE || msg->message == WM_SIZING) {
            updateOverlayGeometry();
        }

        if (msg->message == WM_USER + 101) {
            m_playerEngine.togglePlay();
            return true;
        }

        if (msg->message == WM_NCHITTEST && !m_isFullscreen) {
            if (isMaximized()) {
                return QMainWindow::nativeEvent(eventType, message, result);
            }

            POINT pt = { GET_X_LPARAM(msg->lParam), GET_Y_LPARAM(msg->lParam) };
            RECT winRect;
            GetWindowRect((HWND)winId(), &winRect);

            const int B = 10;
            bool left   = (pt.x >= winRect.left && pt.x < winRect.left + B);
            bool right  = (pt.x >= winRect.right - B && pt.x < winRect.right);
            bool top    = (pt.y >= winRect.top && pt.y < winRect.top + B);
            bool bottom = (pt.y >= winRect.bottom - B && pt.y < winRect.bottom);

            if (top && left) { *result = HTTOPLEFT; return true; }
            if (top && right) { *result = HTTOPRIGHT; return true; }
            if (bottom && left) { *result = HTBOTTOMLEFT; return true; }
            if (bottom && right) { *result = HTBOTTOMRIGHT; return true; }

            if (left) { *result = HTLEFT; return true; }
            if (right) { *result = HTRIGHT; return true; }
            if (top) { *result = HTTOP; return true; }
            if (bottom) { *result = HTBOTTOM; return true; }
        }

        if (msg->message == WM_NCLBUTTONDOWN) {
            WPARAM hit = msg->wParam;
            if (hit >= HTLEFT && hit <= HTBOTTOMRIGHT) {
                ReleaseCapture();
                int sc = 0;
                if (hit == HTLEFT) sc = 1;
                else if (hit == HTRIGHT) sc = 2;
                else if (hit == HTTOP) sc = 3;
                else if (hit == HTTOPLEFT) sc = 4;
                else if (hit == HTTOPRIGHT) sc = 5;
                else if (hit == HTBOTTOM) sc = 6;
                else if (hit == HTBOTTOMLEFT) sc = 7;
                else if (hit == HTBOTTOMRIGHT) sc = 8;
                if (sc > 0) {
                    SendMessage((HWND)winId(), WM_SYSCOMMAND, 0xF000 + sc, msg->lParam);
                    *result = 0;
                    return true;
                }
            }
        }
    }
    return QMainWindow::nativeEvent(eventType, message, result);
}

void MainWindow::keyPressEvent(QKeyEvent *event) {
    QMainWindow::keyPressEvent(event);
}

bool MainWindow::eventFilter(QObject *watched, QEvent *event) {
    if (event->type() == QEvent::KeyPress) {
        // If user is actively typing in a QLineEdit, pass normal typing keys to it
        if (qobject_cast<QLineEdit*>(QApplication::focusWidget())) {
            QKeyEvent *kEvent = static_cast<QKeyEvent *>(event);
            if (kEvent->key() != Qt::Key_Escape && kEvent->key() != Qt::Key_Return) {
                return QMainWindow::eventFilter(watched, event);
            }
        }

        QKeyEvent *keyEvent = static_cast<QKeyEvent *>(event);
        Qt::KeyboardModifiers mods = keyEvent->modifiers();
        if (mods != Qt::NoModifier && mods != Qt::KeypadModifier) {
            return QMainWindow::eventFilter(watched, event);
        }
        int k = keyEvent->key();

        if (k == Qt::Key_Space || k == Qt::Key_K) {
            m_playerEngine.togglePlay();
            return true;
        } else if (k == Qt::Key_F || k == Qt::Key_F11) {
            toggleFullscreen();
            return true;
        } else if (k == Qt::Key_Escape) {
            if (m_isFullscreen) {
                toggleFullscreen();
            } else if (m_playlistDrawer->isVisible() || m_settingsDrawer->isVisible()) {
                m_playlistDrawer->hide();
                m_settingsDrawer->hide();
            }
            return true;
        } else if (k == Qt::Key_Left) {
            m_playerEngine.seekTime(m_playerEngine.getTime() - 5000);
            return true;
        } else if (k == Qt::Key_Right) {
            m_playerEngine.seekTime(m_playerEngine.getTime() + 5000);
            return true;
        } else if (k == Qt::Key_J) {
            m_playerEngine.seekTime(m_playerEngine.getTime() - 10000);
            return true;
        } else if (k == Qt::Key_L) {
            m_playerEngine.seekTime(m_playerEngine.getTime() + 10000);
            return true;
        } else if (k == Qt::Key_Up) {
            int v = qMin(150, m_playerEngine.getVolume() + 5);
            m_playerEngine.setVolume(v);
            m_bottomBar->setVolume(v);
            m_playlistMgr.setVolume(v);
            return true;
        } else if (k == Qt::Key_Down) {
            int v = qMax(0, m_playerEngine.getVolume() - 5);
            m_playerEngine.setVolume(v);
            m_bottomBar->setVolume(v);
            m_playlistMgr.setVolume(v);
            return true;
        } else if (k == Qt::Key_M) {
            if (m_playerEngine.getVolume() > 0) {
                m_playerEngine.setVolume(0);
                m_bottomBar->setVolume(0);
            } else {
                int saved = m_playlistMgr.getVolume() > 0 ? m_playlistMgr.getVolume() : 80;
                m_playerEngine.setVolume(saved);
                m_bottomBar->setVolume(saved);
            }
        } else if (k == Qt::Key_N) {
            toggleNerdStats();
            return true;
        } else if (k == Qt::Key_P) {
            togglePiP();
            return true;
        } else if (k == Qt::Key_PageDown) {
            PlaylistItem *item = m_playlistMgr.getNextItem();
            if (item) {
                m_playerEngine.loadMedia(item->path, item->audioUrl);
                m_playerEngine.play();
            }
            return true;
        } else if (k == Qt::Key_PageUp) {
            PlaylistItem *item = m_playlistMgr.getPreviousItem();
            if (item) {
                m_playerEngine.loadMedia(item->path, item->audioUrl);
                m_playerEngine.play();
            }
            return true;
        } else if (k == Qt::Key_S) {
            if (m_settingsDrawer->isVisible()) {
                m_settingsDrawer->hide();
            } else {
                m_playlistDrawer->hide();
                m_settingsDrawer->refreshTracks();
                m_settingsDrawer->show();
                m_settingsDrawer->raise();
            }
            return true;
        } else if (k == Qt::Key_I) {
            if (m_playlistDrawer->isVisible()) {
                m_playlistDrawer->hide();
            } else {
                m_settingsDrawer->hide();
                m_playlistDrawer->show();
                m_playlistDrawer->raise();
            }
            return true;
        } else if (k == Qt::Key_O) {
            openFilesDialog();
            return true;
        } else if (k == Qt::Key_H) {
            m_playerEngine.stop();
            m_playlistMgr.setCurrentIndex(-1);
            m_videoCanvas->setMediaActive(false);
            m_topBar->setMediaActive(false);
            m_bottomBar->hide();
            m_playlistDrawer->hide();
            m_settingsDrawer->hide();
            return true;
        }
    }
    return QMainWindow::eventFilter(watched, event);
}

void MainWindow::updateOverlayGeometry() {
    int w = width();
    int h = height();

    m_videoCanvas->setGeometry(0, 0, w, h);

    QPoint gPos = mapToGlobal(QPoint(0, 0));

    if (m_topBar) {
        m_topBar->setGeometry(gPos.x(), gPos.y(), w, 60);
    }
    if (m_bottomBar) {
        m_bottomBar->setGeometry(gPos.x(), gPos.y() + h - 80, w, 80);
    }
    if (m_playlistDrawer && m_playlistDrawer->isVisible() && !m_playlistDrawer->property("userMoved").toBool()) {
        m_playlistDrawer->move(gPos.x() + w - m_playlistDrawer->width() - 24, gPos.y() + 70);
    }
    if (m_settingsDrawer && m_settingsDrawer->isVisible() && !m_settingsDrawer->property("userMoved").toBool()) {
        m_settingsDrawer->move(gPos.x() + w - m_settingsDrawer->width() - 24, gPos.y() + 70);
    }
}

void MainWindow::checkGlobalMouseMove() {
    QPoint currentPos = QCursor::pos();
    QRect globalWinRect = frameGeometry();
    if (globalWinRect.contains(currentPos)) {
        if (currentPos != m_lastCursorPos) {
            m_lastCursorPos = currentPos;
            showOverlays();
        }
    }
}

void MainWindow::showOverlays() {
    updateOverlayGeometry();
    bool hasMedia = (m_videoCanvas->isMediaActive() && (m_playlistMgr.getCurrentIndex() >= 0 || m_playerEngine.isPlaying()));

    if (!m_topBar->isVisible()) {
        m_topBar->show();
    }
    m_topBar->raise();

    if (hasMedia) {
        if (!m_bottomBar->isVisible()) {
            m_bottomBar->show();
        }
        m_bottomBar->raise();
    } else {
        m_bottomBar->hide();
    }

    if (m_playlistDrawer && m_playlistDrawer->isVisible()) {
        m_playlistDrawer->raise();
    }
    if (m_settingsDrawer && m_settingsDrawer->isVisible()) {
        m_settingsDrawer->raise();
    }

    setCursor(Qt::ArrowCursor);
    if (m_playerEngine.isPlaying()) {
        m_autohideTimer.start(3500);
    }
}

void MainWindow::hideOverlays() {
    if (m_playerEngine.isPlaying() && !m_playlistDrawer->isVisible() && !m_settingsDrawer->isVisible()) {
        m_topBar->hide();
        m_bottomBar->hide();
        setCursor(Qt::BlankCursor);
    }
}

void MainWindow::openFilesDialog() {
    QStringList files = QFileDialog::getOpenFileNames(this, "Open Media Files", "", "Media Files (*.mp4 *.mkv *.avi *.mov *.mp3 *.flac *.wav);;All Files (*.*)");
    for (const QString &f : files) {
        m_playlistMgr.addItem(f);
    }
    if (!m_playerEngine.isPlaying() && m_playlistMgr.getCurrentIndex() == -1 && !files.isEmpty()) {
        playIndex(0);
    }
}

void MainWindow::openFolderDialog() {
    QString dir = QFileDialog::getExistingDirectory(this, "Open Media Folder");
    if (!dir.isEmpty()) {
        m_playlistMgr.addDirectory(dir);
        if (!m_playerEngine.isPlaying() && m_playlistMgr.getCurrentIndex() == -1) {
            playIndex(0);
        }
    }
}

void MainWindow::openPlaylistDialog() {
    QString pl = QFileDialog::getOpenFileName(this, "Open Playlist JSON", "", "Playlist Files (*.json);;All Files (*.*)");
    if (!pl.isEmpty()) {
        m_playlistMgr.loadFromJson(pl);
        if (!m_playlistMgr.getItems().isEmpty()) {
            playIndex(0);
        }
    }
}

void MainWindow::openSubtitleDialog() {
    QString sub = QFileDialog::getOpenFileName(this, "Select Subtitle File", "", "Subtitle Files (*.srt *.vtt *.ass);;All Files (*.*)");
    if (!sub.isEmpty()) {
        m_playerEngine.loadExternalSubtitle(sub);
    }
}

void MainWindow::setupPlaybackSync(const QString &pbKey, const QString &profileId, const QString &syncFile, int syncPort) {
    m_syncPbKey = pbKey;
    if (pbKey.contains("_S")) {
        m_syncBaseId = pbKey.section("_S", 0, 0);
    } else {
        m_syncBaseId = pbKey;
    }
    m_syncProfileId = profileId;
    m_syncFile = syncFile;
    m_syncPort = syncPort;
    m_lastReportedWall = 0;
    m_lastReportedSec = -1.0f;
}

void MainWindow::reportPlaybackProgress(bool force, bool isEnded) {
    if (m_syncPbKey.isEmpty()) return;

    qint64 timeMs = m_playerEngine.getTime();
    qint64 durMs = m_playerEngine.getDuration();
    if (timeMs < 0) timeMs = 0;

    float timeSec = (float)timeMs / 1000.0f;
    float durSec = (durMs > 0) ? ((float)durMs / 1000.0f) : 0.0f;

    if (timeSec <= 0.0f && !isEnded) return;

    m_lastReportedSec = timeSec;
    m_lastReportedWall = QDateTime::currentMSecsSinceEpoch();

    bool watched = false;
    if (isEnded) {
        watched = true;
    } else if (durSec > 0.0f) {
        watched = (timeSec / durSec >= 0.90f) || (durSec > 300.0f && durSec - timeSec <= 60.0f);
    }

    QJsonObject obj;
    obj["key"] = m_syncPbKey;
    obj["profileId"] = m_syncProfileId;
    obj["time"] = timeSec;
    obj["duration"] = durSec;
    obj["watched"] = watched;
    obj["force"] = force;
    obj["isEnded"] = isEnded;
    obj["lastWatched"] = QDateTime::currentMSecsSinceEpoch();

    QJsonDocument doc(obj);
    QByteArray jsonBytes = doc.toJson(QJsonDocument::Compact);

    // 1. Stdout print for parent process
    std::cout << "[MEEM_PLAYBACK_PROGRESS] " << jsonBytes.constData() << std::endl;
    std::fflush(stdout);

    // 2. File write (for bulletproof persistence)
    if (!m_syncFile.isEmpty()) {
        QFile file(m_syncFile);
        if (file.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
            file.write(jsonBytes);
            file.flush();
            file.close();
        }
    }
}

void MainWindow::setPendingStartTime(float sec) {
    m_pendingStartTimeSec = sec;
    m_initialSeekDone = false;
}

void MainWindow::setMediaIds(const QString &tmdbId, const QString &imdbId, const QString &mediaType, int season, int episode, const QString &tmdbApiKey, const QString &subdlApiKey) {
    if (!tmdbId.isEmpty()) m_tmdbId = tmdbId;
    if (!imdbId.isEmpty()) m_imdbId = imdbId;
    if (!mediaType.isEmpty()) m_mediaType = mediaType;
    if (season > 0) m_season = season;
    if (episode > 0) m_episode = episode;
    if (!tmdbApiKey.isEmpty()) m_tmdbApiKey = tmdbApiKey;
    if (!subdlApiKey.isEmpty()) m_subdlApiKey = subdlApiKey;

    autoFetchTmdbMetadata();
}

void MainWindow::autoFetchTmdbMetadata() {
    if (!m_netMgr) m_netMgr = new QNetworkAccessManager(this);

    // Step 1: If TMDB ID is missing, try resolving it via IMDb ID or Show Title
    if (m_tmdbId.isEmpty()) {
        if (!m_imdbId.isEmpty()) {
            QUrl findUrl(QString("https://api.themoviedb.org/3/find/%1?api_key=%2&external_source=imdb_id").arg(m_imdbId).arg(m_tmdbApiKey));
            QNetworkRequest req(findUrl);
            QNetworkReply *reply = m_netMgr->get(req);
            connect(reply, &QNetworkReply::finished, this, [this, reply]() {
                if (reply->error() == QNetworkReply::NoError) {
                    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
                    if (doc.isObject()) {
                        QJsonObject root = doc.object();
                        QJsonArray tvResults = root.value("tv_results").toArray();
                        QJsonArray movieResults = root.value("movie_results").toArray();
                        if (!tvResults.isEmpty()) {
                            m_tmdbId = QString::number(tvResults.first().toObject().value("id").toInt());
                            m_mediaType = "tv";
                            autoFetchTmdbMetadata();
                        } else if (!movieResults.isEmpty()) {
                            m_tmdbId = QString::number(movieResults.first().toObject().value("id").toInt());
                            m_mediaType = "movie";
                            autoFetchTmdbMetadata();
                        }
                    }
                }
                reply->deleteLater();
            });
            return;
        } else {
            // Search TMDB using showTitle or overrideTitle
            QString searchTitle = m_overrideTitle;
            PlaylistItem *curr = m_playlistMgr.getCurrentItem();
            if (curr && !curr->showTitle.isEmpty()) {
                searchTitle = curr->showTitle;
            } else if (!m_playlistMgr.getItems().isEmpty() && !m_playlistMgr.getItems().first().showTitle.isEmpty()) {
                searchTitle = m_playlistMgr.getItems().first().showTitle;
            }

            if (!searchTitle.isEmpty()) {
                QUrl sUrl(QString("https://api.themoviedb.org/3/search/multi?api_key=%1&query=%2")
                          .arg(m_tmdbApiKey)
                          .arg(QUrl::toPercentEncoding(searchTitle)));
                QNetworkRequest req(sUrl);
                QNetworkReply *reply = m_netMgr->get(req);
                connect(reply, &QNetworkReply::finished, this, [this, reply]() {
                    if (reply->error() == QNetworkReply::NoError) {
                        QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
                        if (doc.isObject()) {
                            QJsonArray results = doc.object().value("results").toArray();
                            if (!results.isEmpty()) {
                                QJsonObject first = results.first().toObject();
                                m_tmdbId = QString::number(first.value("id").toInt());
                                m_mediaType = first.value("media_type").toString("tv");
                                autoFetchTmdbMetadata();
                            }
                        }
                    }
                    reply->deleteLater();
                });
                return;
            }
        }
    }

    if (m_tmdbId.isEmpty()) return;

    // Step 2: Now that we have m_tmdbId:
    if (m_mediaType == "movie") {
        QUrl movieUrl(QString("https://api.themoviedb.org/3/movie/%1?api_key=%2").arg(m_tmdbId).arg(m_tmdbApiKey));
        QNetworkRequest req(movieUrl);
        QNetworkReply *reply = m_netMgr->get(req);
        connect(reply, &QNetworkReply::finished, this, [this, reply]() {
            if (reply->error() == QNetworkReply::NoError) {
                QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
                if (doc.isObject()) {
                    QJsonObject obj = doc.object();
                    QString backdrop = obj.value("backdrop_path").toString();
                    QString poster = obj.value("poster_path").toString();
                    QString overview = obj.value("overview").toString();
                    QString title = obj.value("title").toString();
                    QString thumbUrl = !backdrop.isEmpty() ? ("https://image.tmdb.org/t/p/w500" + backdrop)
                                                          : (!poster.isEmpty() ? ("https://image.tmdb.org/t/p/w500" + poster) : "");
                    
                    bool changed = false;
                    for (int i = 0; i < m_playlistMgr.getItems().size(); ++i) {
                        PlaylistItem *p = m_playlistMgr.getItem(i);
                        if (p) {
                            if (p->thumbnail.isEmpty() && !thumbUrl.isEmpty()) { p->thumbnail = thumbUrl; changed = true; }
                            if (p->overview.isEmpty() && !overview.isEmpty()) { p->overview = overview; changed = true; }
                            if (!title.isEmpty() && (p->title.isEmpty() || p->title.contains(".mkv") || p->title.contains(".mp4"))) {
                                p->title = title;
                                changed = true;
                            }
                            p->tmdbId = m_tmdbId;
                            p->mediaType = "movie";
                        }
                    }
                    if (changed) {
                        m_playlistMgr.notifyUpdated();
                        PlaylistItem *curr = m_playlistMgr.getCurrentItem();
                        if (curr) m_topBar->setMediaTitle(curr->title, m_overrideSubtitle);
                    }
                }
            }
            reply->deleteLater();
        });
        return;
    }

    // Step 3: TV Show - Fetch TMDB Season(s) for 16:9 Episode Stills and Metadata
    QSet<int> seasonsToFetch;
    if (m_season > 0) seasonsToFetch.insert(m_season);
    for (const auto &it : m_playlistMgr.getItems()) {
        if (it.season > 0) seasonsToFetch.insert(it.season);
    }
    if (seasonsToFetch.isEmpty()) seasonsToFetch.insert(1);

    for (int sNum : seasonsToFetch) {
        QUrl sUrl(QString("https://api.themoviedb.org/3/tv/%1/season/%2?api_key=%3").arg(m_tmdbId).arg(sNum).arg(m_tmdbApiKey));
        QNetworkRequest req(sUrl);
        QNetworkReply *reply = m_netMgr->get(req);
        connect(reply, &QNetworkReply::finished, this, [this, reply, sNum]() {
            if (reply->error() == QNetworkReply::NoError) {
                QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
                if (doc.isObject()) {
                    QJsonArray episodes = doc.object().value("episodes").toArray();
                    bool changed = false;

                    for (const QJsonValue &epVal : episodes) {
                        QJsonObject ep = epVal.toObject();
                        int epNum = ep.value("episode_number").toInt();
                        QString epName = ep.value("name").toString();
                        QString stillPath = ep.value("still_path").toString();
                        QString overview = ep.value("overview").toString();
                        QString fullStill = stillPath.isEmpty() ? "" : ("https://image.tmdb.org/t/p/w500" + stillPath);

                        // Find matching playlist items:
                        // Method 1: Match by exact season & episode number
                        bool found = false;
                        for (int i = 0; i < m_playlistMgr.getItems().size(); ++i) {
                            PlaylistItem *p = m_playlistMgr.getItem(i);
                            if (p && ((p->season == sNum && p->episode == epNum) ||
                                      (p->season <= 0 && p->episode == epNum && sNum == 1))) {
                                if (!epName.isEmpty()) p->title = epName;
                                if (!fullStill.isEmpty()) p->thumbnail = fullStill;
                                p->overview = overview;
                                p->tmdbId = m_tmdbId;
                                p->season = sNum;
                                p->episode = epNum;
                                p->mediaType = "tv";
                                changed = true;
                                found = true;
                            }
                        }

                        // Method 2: If season 1 and items have no season/episode, match by 0-based index
                        if (!found && sNum == 1 && (epNum - 1) >= 0 && (epNum - 1) < m_playlistMgr.getItems().size()) {
                            PlaylistItem *p = m_playlistMgr.getItem(epNum - 1);
                            if (p && p->season <= 0 && p->episode <= 0) {
                                if (!epName.isEmpty()) p->title = epName;
                                if (!fullStill.isEmpty()) p->thumbnail = fullStill;
                                p->overview = overview;
                                p->tmdbId = m_tmdbId;
                                p->season = 1;
                                p->episode = epNum;
                                p->mediaType = "tv";
                                changed = true;
                            }
                        }
                    }

                    if (changed) {
                        m_playlistMgr.notifyUpdated();
                        PlaylistItem *curr = m_playlistMgr.getCurrentItem();
                        if (curr && curr->season == sNum) {
                            QString sub = curr->showTitle.isEmpty() ? m_overrideTitle : curr->showTitle;
                            m_topBar->setMediaTitle(curr->title, sub);
                            if (m_settingsDrawer) {
                                m_settingsDrawer->setMediaContext(m_imdbId, m_tmdbId, sub, curr->season, curr->episode, m_subdlApiKey, m_syncPort);
                            }
                        }
                    }
                }
            }
            reply->deleteLater();
        });
    }
}

