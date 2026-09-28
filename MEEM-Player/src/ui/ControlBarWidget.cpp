#include "ControlBarWidget.h"
#include "MainWindow.h"
#include <QMouseEvent>
#include <QFileInfo>
#include <QIcon>
#include <QPixmap>
#include <QPainter>
#include <QLinearGradient>
#include <QTime>
#include <QApplication>
#include <windows.h>
#include <windowsx.h>

static QPushButton* makeIconBtn(QWidget *parent, const QString &fallbackText,
                                 int w = 38, int h = 38) {
    QPushButton *btn = new QPushButton(fallbackText, parent);
    btn->setObjectName("IconButton");
    btn->setFixedSize(w, h);
    btn->setCursor(Qt::PointingHandCursor);
    btn->setIconSize(QSize(20, 20));
    btn->setStyleSheet(
        "QPushButton#IconButton {"
        "  background: transparent;"
        "  border: none;"
        "  border-radius: 8px;"
        "  color: rgba(255,255,255,220);"
        "  font-size: 11px;"
        "}"
        "QPushButton#IconButton:hover {"
        "  background: rgba(255,255,255,28);"
        "  color: #FFFFFF;"
        "}"
        "QPushButton#IconButton:pressed { background: rgba(255,255,255,45); }"
    );
    return btn;
}

// =========================================================================
// TopBarWidget Implementation
// =========================================================================
TopBarWidget::TopBarWidget(MainWindow *mainWin)
    : QWidget(mainWin), m_mainWin(mainWin)
{
    setObjectName("TopBarOverlay");
    setFixedHeight(60);
    setAttribute(Qt::WA_TranslucentBackground, true);
    initUi();
}

void TopBarWidget::initUi() {
    QHBoxLayout *layout = new QHBoxLayout(this);
    layout->setContentsMargins(18, 8, 18, 8);
    layout->setSpacing(10);

    QVBoxLayout *titleBox = new QVBoxLayout();
    titleBox->setSpacing(0);
    m_titleLabel = new QLabel("MEEM Player", this);
    m_titleLabel->setStyleSheet("font-size: 13px; font-weight: 700; color: #FFFFFF; background: transparent;");
    m_subtitleLabel = new QLabel("", this);
    m_subtitleLabel->setStyleSheet("font-size: 10px; color: rgba(200,200,210,170); background: transparent;");
    m_subtitleLabel->hide();
    titleBox->addWidget(m_titleLabel);
    titleBox->addWidget(m_subtitleLabel);

    layout->addLayout(titleBox);
    layout->addStretch();

    // Open File button (visible when IDLE)
    m_openFileBtn = new QPushButton(" Open File", this);
    m_openFileBtn->setCursor(Qt::PointingHandCursor);
    m_openFileBtn->setIconSize(QSize(16, 16));
    m_openFileBtn->setFixedHeight(32);
    m_openFileBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(255,255,255,18);"
        "  color: #FFFFFF;"
        "  font-weight: 600;"
        "  font-size: 12px;"
        "  padding: 0 14px;"
        "  border-radius: 8px;"
        "  border: 1px solid rgba(255,255,255,30);"
        "}"
        "QPushButton:hover { background: rgba(255,255,255,35); }"
        "QPushButton:pressed { background: rgba(255,255,255,50); }"
    );
    connect(m_openFileBtn, &QPushButton::clicked, this, &TopBarWidget::openFileClicked);

    // Home button (visible when PLAYING)
    m_homeBtn = makeIconBtn(this, "", 36, 32);
    m_homeBtn->hide();
    connect(m_homeBtn, &QPushButton::clicked, this, &TopBarWidget::homeClicked);

    m_minimizeBtn = makeIconBtn(this, "—", 34, 32);
    connect(m_minimizeBtn, &QPushButton::clicked, m_mainWin, &QWidget::showMinimized);

    m_maximizeBtn = makeIconBtn(this, "□", 34, 32);
    connect(m_maximizeBtn, &QPushButton::clicked, this, [this]() {
        m_mainWin->toggleMaximize();
    });

    m_closeBtn = makeIconBtn(this, "✕", 34, 32);
    m_closeBtn->setStyleSheet(
        m_closeBtn->styleSheet() +
        "QPushButton#IconButton:hover { background: #E53935; color: #FFFFFF; }"
    );
    connect(m_closeBtn, &QPushButton::clicked, m_mainWin, &QWidget::close);

    layout->addWidget(m_openFileBtn);
    layout->addWidget(m_homeBtn);
    layout->addSpacing(6);
    layout->addWidget(m_minimizeBtn);
    layout->addWidget(m_maximizeBtn);
    layout->addWidget(m_closeBtn);
}

void TopBarWidget::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QPainter painter(this);
    QLinearGradient grad(0, 0, 0, height());
    grad.setColorAt(0.0, QColor(10, 10, 14, 235));
    grad.setColorAt(0.6, QColor(10, 10, 14, 150));
    grad.setColorAt(1.0, QColor(10, 10, 14, 0));
    painter.fillRect(rect(), grad);
}

void TopBarWidget::setIconsBasePath(const QString &basePath) {
    m_iconsPath = basePath;
    applyIcons();
}

void TopBarWidget::applyIcons() {
    if (m_iconsPath.isEmpty()) return;

    auto loadIcon = [&](const QString &name) -> QIcon {
        QString path = m_iconsPath + "/" + name;
        if (QFileInfo::exists(path)) return QIcon(path);
        return QIcon();
    };

    auto icOpenFile = loadIcon("open_file.svg");
    if (!icOpenFile.isNull()) {
        m_openFileBtn->setIcon(icOpenFile);
        m_openFileBtn->setIconSize(QSize(16, 16));
    }

    auto icHome = loadIcon("home.svg");
    if (!icHome.isNull()) { m_homeBtn->setIcon(icHome); m_homeBtn->setText(""); }

    auto icMin = loadIcon("min.svg");
    auto icClose = loadIcon("close.svg");
    if (!icMin.isNull()) { m_minimizeBtn->setIcon(icMin); m_minimizeBtn->setText(""); }
    if (!icClose.isNull()) { m_closeBtn->setIcon(icClose); m_closeBtn->setText(""); }

    m_iconMax     = loadIcon("max.svg");
    m_iconRestore = loadIcon("restore.svg");
    if (!m_iconMax.isNull()) { m_maximizeBtn->setIcon(m_iconMax); m_maximizeBtn->setText(""); }
}

void TopBarWidget::updateMaximizeButton(bool maximized) {
    if (maximized) {
        if (!m_iconRestore.isNull()) { m_maximizeBtn->setIcon(m_iconRestore); m_maximizeBtn->setText(""); }
        else m_maximizeBtn->setText("❐");
    } else {
        if (!m_iconMax.isNull()) { m_maximizeBtn->setIcon(m_iconMax); m_maximizeBtn->setText(""); }
        else m_maximizeBtn->setText("□");
    }
}

void TopBarWidget::setMediaTitle(const QString &title, const QString &subtitle) {
    m_titleLabel->setText(title.isEmpty() ? "MEEM Player" : title);
    m_subtitleLabel->setText(subtitle);
    m_subtitleLabel->setVisible(!subtitle.isEmpty());
}

void TopBarWidget::setMediaActive(bool active) {
    if (active) {
        m_openFileBtn->hide();
        m_homeBtn->show();
    } else {
        m_openFileBtn->show();
        m_homeBtn->hide();
        m_titleLabel->setText("MEEM Player");
        m_subtitleLabel->hide();
    }
}

void TopBarWidget::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        if (!m_mainWin->isMaximized() && !m_mainWin->isFullScreen()) {
            ReleaseCapture();
            SendMessage((HWND)m_mainWin->winId(), WM_NCLBUTTONDOWN, HTCAPTION, 0);
            event->accept();
            return;
        }
    }
    QWidget::mousePressEvent(event);
}

bool TopBarWidget::nativeEvent(const QByteArray &eventType, void *message, qintptr *result) {
#ifdef _WIN32
    MSG *msg = reinterpret_cast<MSG *>(message);
    if (msg && msg->message == WM_NCHITTEST) {
        if (m_mainWin && !m_mainWin->isFullScreen() && !m_mainWin->isMaximized()) {
            POINT pt = { GET_X_LPARAM(msg->lParam), GET_Y_LPARAM(msg->lParam) };
            RECT r;
            GetWindowRect((HWND)winId(), &r);
            int x = pt.x - r.left;
            int y = pt.y - r.top;
            int w = r.right - r.left;

            // Outer 14px perimeter belongs to MainWindow for resizing (top, left, right edges and corners)
            const int B = 14;
            if (y < B || x < B || x >= w - B) {
                *result = HTTRANSPARENT;
                return true;
            }
        }
    }
#endif
    return QWidget::nativeEvent(eventType, message, result);
}

void TopBarWidget::mouseMoveEvent(QMouseEvent *event) {
    QWidget::mouseMoveEvent(event);
}

void TopBarWidget::mouseDoubleClickEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_mainWin->toggleMaximize();
        event->accept();
    }
}


// =========================================================================
// BottomBarWidget Implementation
// =========================================================================
BottomBarWidget::BottomBarWidget(MainWindow *mainWin)
    : QWidget(mainWin), m_mainWin(mainWin)
{
    setObjectName("BottomBarOverlay");
    setFixedHeight(80);
    setAttribute(Qt::WA_TranslucentBackground, true);
    initUi();
}

void BottomBarWidget::initUi() {
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(18, 6, 18, 10);
    mainLayout->setSpacing(6);

    // Seek row
    QHBoxLayout *seekRow = new QHBoxLayout();
    seekRow->setSpacing(12);

    m_seekBar = new SeekBar(this);
    connect(m_seekBar, &SeekBar::seekRequested, this, &BottomBarWidget::seekRequested);
    connect(m_seekBar, &SeekBar::seekOffsetRequested, this, &BottomBarWidget::seekOffsetRequested);

    m_timeLabel = new QLabel("00:00 / 00:00", this);
    m_timeLabel->setStyleSheet(
        "background: transparent;"
        "font-size: 12px; color: rgba(230,230,240,220);"
        "font-family: 'Consolas', 'Courier New', monospace;"
        "font-weight: 600;"
    );
    m_timeLabel->setMinimumWidth(110);
    m_timeLabel->setAlignment(Qt::AlignRight | Qt::AlignVCenter);

    seekRow->addWidget(m_seekBar, 1);
    seekRow->addWidget(m_timeLabel);
    mainLayout->addLayout(seekRow);

    // Buttons row — pure icons only!
    QHBoxLayout *btnRow = new QHBoxLayout();
    btnRow->setSpacing(4);

    m_prevBtn = makeIconBtn(this, "", 38, 38);
    connect(m_prevBtn, &QPushButton::clicked, this, &BottomBarWidget::prevClicked);

    // Play/Pause button — pure icon button
    m_playBtn = makeIconBtn(this, "", 42, 38);
    m_playBtn->setIconSize(QSize(24, 24));
    connect(m_playBtn, &QPushButton::clicked, this, &BottomBarWidget::playPauseToggled);

    m_nextBtn = makeIconBtn(this, "", 38, 38);
    connect(m_nextBtn, &QPushButton::clicked, this, &BottomBarWidget::nextClicked);

    m_muteBtn = makeIconBtn(this, "", 36, 38);
    connect(m_muteBtn, &QPushButton::clicked, this, &BottomBarWidget::muteToggled);

    m_volSlider = new VolumeSlider(this);
    connect(m_volSlider, &QSlider::valueChanged, this, &BottomBarWidget::volumeChanged);

    btnRow->addWidget(m_prevBtn);
    btnRow->addWidget(m_playBtn);
    btnRow->addWidget(m_nextBtn);
    btnRow->addSpacing(10);
    btnRow->addWidget(m_muteBtn);
    btnRow->addWidget(m_volSlider);
    btnRow->addStretch();

    m_playlistBtn = makeIconBtn(this, "", 38, 38);
    connect(m_playlistBtn, &QPushButton::clicked, this, &BottomBarWidget::playlistToggled);

    m_settingsBtn = makeIconBtn(this, "", 38, 38);
    connect(m_settingsBtn, &QPushButton::clicked, this, &BottomBarWidget::settingsToggled);

    m_fullscreenBtn = makeIconBtn(this, "", 38, 38);
    connect(m_fullscreenBtn, &QPushButton::clicked, this, &BottomBarWidget::fullscreenToggled);

    btnRow->addWidget(m_playlistBtn);
    btnRow->addWidget(m_settingsBtn);
    btnRow->addWidget(m_fullscreenBtn);

    mainLayout->addLayout(btnRow);
}

void BottomBarWidget::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QPainter painter(this);
    QLinearGradient grad(0, 0, 0, height());
    grad.setColorAt(0.0, QColor(10, 10, 14, 0));
    grad.setColorAt(0.4, QColor(10, 10, 14, 170));
    grad.setColorAt(1.0, QColor(10, 10, 14, 240));
    painter.fillRect(rect(), grad);
}

void BottomBarWidget::setIconsBasePath(const QString &basePath) {
    m_iconsPath = basePath;
    applyIcons();
}

void BottomBarWidget::applyIcons() {
    if (m_iconsPath.isEmpty()) return;

    auto loadIcon = [&](const QString &name) -> QIcon {
        QString path = m_iconsPath + "/" + name;
        if (QFileInfo::exists(path)) return QIcon(path);
        return QIcon();
    };

    auto icPrev = loadIcon("prev.svg");
    auto icPlay = loadIcon("play.svg");
    auto icPause= loadIcon("pause.svg");
    auto icNext = loadIcon("next.svg");
    auto icVol  = loadIcon("volume.svg");
    auto icVolMute = loadIcon("volume_mute.svg");
    auto icList = loadIcon("playlist.svg");
    auto icCfg  = loadIcon("settings.svg");
    auto icFS   = loadIcon("fullscreen.svg");

    if (!icPrev.isNull())  { m_prevBtn->setIcon(icPrev);  m_prevBtn->setText(""); }
    if (!icPlay.isNull())  { m_playBtn->setIcon(icPlay);  m_playBtn->setText(""); m_playBtn->setIconSize(QSize(24,24)); }
    if (!icNext.isNull())  { m_nextBtn->setIcon(icNext);  m_nextBtn->setText(""); }
    if (!icVol.isNull())   { 
        m_muteBtn->setIcon(icVol);   
        m_muteBtn->setText(""); 
        m_muteBtn->setProperty("icon_vol", QVariant::fromValue(icVol));
        if (!icVolMute.isNull()) m_muteBtn->setProperty("icon_mute", QVariant::fromValue(icVolMute));
    }
    if (!icList.isNull())  { m_playlistBtn->setIcon(icList); m_playlistBtn->setText(""); }
    if (!icCfg.isNull())   { m_settingsBtn->setIcon(icCfg);  m_settingsBtn->setText(""); }
    if (!icFS.isNull())    { m_fullscreenBtn->setIcon(icFS);  m_fullscreenBtn->setText(""); }

    m_playBtn->setProperty("icon_play",  QVariant::fromValue(icPlay));
    m_playBtn->setProperty("icon_pause", QVariant::fromValue(icPause));
}

void BottomBarWidget::setPlaybackState(bool isPlaying) {
    QIcon iconPlay  = m_playBtn->property("icon_play").value<QIcon>();
    QIcon iconPause = m_playBtn->property("icon_pause").value<QIcon>();

    if (isPlaying) {
        if (!iconPause.isNull()) { m_playBtn->setIcon(iconPause); m_playBtn->setText(""); }
        else m_playBtn->setText("❚❚");
    } else {
        if (!iconPlay.isNull()) { m_playBtn->setIcon(iconPlay); m_playBtn->setText(""); }
        else m_playBtn->setText("▶");
    }
}

void BottomBarWidget::setTime(qint64 currentMs, qint64 totalMs) {
    m_seekBar->setDuration(totalMs);
    m_timeLabel->setText(formatTime(currentMs) + " / " + formatTime(totalMs));
    m_timeLabel->update();
}

void BottomBarWidget::setPositionRatio(float ratio) {
    m_seekBar->setPositionRatio(ratio);
}

void BottomBarWidget::setVolume(int volume) {
    m_volSlider->blockSignals(true);
    m_volSlider->setValue(volume);
    m_volSlider->blockSignals(false);

    QIcon icVol = m_muteBtn->property("icon_vol").value<QIcon>();
    QIcon icMute = m_muteBtn->property("icon_mute").value<QIcon>();
    if (volume == 0 && !icMute.isNull()) {
        m_muteBtn->setIcon(icMute);
    } else if (volume > 0 && !icVol.isNull()) {
        m_muteBtn->setIcon(icVol);
    }
}

QString BottomBarWidget::formatTime(qint64 ms) {
    if (ms < 0) ms = 0;
    qint64 seconds = ms / 1000;
    qint64 hours = seconds / 3600;
    qint64 minutes = (seconds % 3600) / 60;
    qint64 secs = seconds % 60;

    if (hours > 0) {
        return QString("%1:%2:%3")
            .arg(hours, 2, 10, QChar('0'))
            .arg(minutes, 2, 10, QChar('0'))
            .arg(secs, 2, 10, QChar('0'));
    } else {
        return QString("%1:%2")
            .arg(minutes, 2, 10, QChar('0'))
            .arg(secs, 2, 10, QChar('0'));
    }
}

void BottomBarWidget::mousePressEvent(QMouseEvent *event) {
    QWidget::mousePressEvent(event);
}

bool BottomBarWidget::nativeEvent(const QByteArray &eventType, void *message, qintptr *result) {
#ifdef _WIN32
    MSG *msg = reinterpret_cast<MSG *>(message);
    if (msg && msg->message == WM_NCHITTEST) {
        if (m_mainWin && !m_mainWin->isFullScreen() && !m_mainWin->isMaximized()) {
            POINT pt = { GET_X_LPARAM(msg->lParam), GET_Y_LPARAM(msg->lParam) };
            RECT r;
            GetWindowRect((HWND)winId(), &r);
            int x = pt.x - r.left;
            int y = pt.y - r.top;
            int w = r.right - r.left;
            int h = r.bottom - r.top;

            // Outer 14px perimeter belongs to MainWindow for resizing (bottom, left, right edges and corners)
            const int B = 14;
            if (y >= h - B || x < B || x >= w - B) {
                *result = HTTRANSPARENT;
                return true;
            }
        }
    }
#endif
    return QWidget::nativeEvent(eventType, message, result);
}

