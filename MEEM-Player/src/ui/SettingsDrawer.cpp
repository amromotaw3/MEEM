#include "SettingsDrawer.h"
#include "styles.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QDir>
#include <QDirIterator>
#include <QFileInfo>
#include <QStandardPaths>
#include <QSet>
#include <QFileDialog>
#include <QPainter>
#include <QMouseEvent>
#include <QScrollArea>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QUrlQuery>
#include <QProcess>
#include <QDateTime>
#ifdef _WIN32
#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#endif

SettingsDrawer::SettingsDrawer(PlayerEngine *engine, QWidget *parent)
    : QFrame(parent), m_engine(engine)
{
    setObjectName("DrawerPanel");
    setWindowFlags(Qt::WindowType::Dialog | Qt::WindowType::FramelessWindowHint);
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet("QFrame#DrawerPanel { background-color: #0A0A0C; border: 1px solid #33333E; border-radius: 14px; color: #FFFFFF; } " + BLACK_WHITE_STYLESHEET);
    resize(580, 600);
    setMinimumSize(380, 340);
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);

    initUi();
}

void SettingsDrawer::showEvent(QShowEvent *event) {
    QFrame::showEvent(event);
#ifdef _WIN32
    HWND hwnd = (HWND)winId();
    BOOL darkMode = TRUE;
    DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &darkMode, sizeof(darkMode));
    DWORD preference = 2; // DWMWCP_ROUND
    DwmSetWindowAttribute(hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &preference, sizeof(preference));
    LONG_PTR style = GetWindowLongPtr(hwnd, GWL_STYLE);
    SetWindowLongPtr(hwnd, GWL_STYLE, style | WS_THICKFRAME);
#endif
}

bool SettingsDrawer::nativeEvent(const QByteArray &eventType, void *message, qintptr *result) {
#ifdef _WIN32
    MSG *msg = static_cast<MSG *>(message);
    if (!msg) return false;

    if (msg->message == WM_NCHITTEST) {
        POINT pt = { GET_X_LPARAM(msg->lParam), GET_Y_LPARAM(msg->lParam) };
        RECT r;
        GetWindowRect((HWND)winId(), &r);

        const int BORDER = 10;
        bool left   = (pt.x >= r.left && pt.x < r.left + BORDER);
        bool right  = (pt.x >= r.right - BORDER && pt.x < r.right);
        bool top    = (pt.y >= r.top && pt.y < r.top + BORDER);
        bool bottom = (pt.y >= r.bottom - BORDER && pt.y < r.bottom);

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
#endif
    return QFrame::nativeEvent(eventType, message, result);
}

void SettingsDrawer::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        if (event->pos().y() <= 55) {
            setProperty("userMoved", true);
            m_dragPos = event->globalPosition().toPoint() - frameGeometry().topLeft();
            event->accept();
            return;
        }
    }
    QFrame::mousePressEvent(event);
}

void SettingsDrawer::mouseMoveEvent(QMouseEvent *event) {
    if (event->buttons() & Qt::LeftButton && !m_dragPos.isNull()) {
        move(event->globalPosition().toPoint() - m_dragPos);
        event->accept();
        return;
    }
    QFrame::mouseMoveEvent(event);
}

void SettingsDrawer::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.fillRect(rect(), QColor(10, 10, 12)); // Solid dark background
    painter.setPen(QPen(QColor(50, 50, 60), 1));
    painter.drawRect(rect().adjusted(0, 0, -1, -1));
}

void SettingsDrawer::setIconsBasePath(const QString &basePath) {
    m_iconsPath = basePath;
    applyIcons();
}

void SettingsDrawer::applyIcons() {
    if (m_iconsPath.isEmpty()) return;
    auto loadIcon = [&](const QString &name) -> QIcon {
        QString path = m_iconsPath + "/" + name;
        if (QFileInfo::exists(path)) return QIcon(path);
        return QIcon();
    };

    QIcon icSettings = loadIcon("settings.svg");
    if (!icSettings.isNull() && m_titleIconLabel) {
        m_titleIconLabel->setPixmap(icSettings.pixmap(20, 20));
        m_titleIconLabel->show();
    }

    QIcon icClose = loadIcon("close.svg");
    if (!icClose.isNull() && m_closeBtn) {
        m_closeBtn->setIcon(icClose);
        m_closeBtn->setIconSize(QSize(16, 16));
        m_closeBtn->setText("");
    }

    for (const auto &pair : m_sectionIconLabels) {
        if (!pair.first) continue;
        QIcon ic = loadIcon(pair.second);
        if (!ic.isNull()) {
            pair.first->setPixmap(ic.pixmap(16, 16));
            pair.first->show();
        }
    }
}

void SettingsDrawer::switchToTab(int index) {
    if (!m_tabStack) return;
    m_tabStack->setCurrentIndex(index);

    auto setTabStyle = [](QPushButton *btn, bool active) {
        if (!btn) return;
        if (active) {
            btn->setStyleSheet(
                "QPushButton {"
                "  background: #FFFFFF;"
                "  color: #000000;"
                "  border: 1px solid #FFFFFF;"
                "  border-radius: 8px;"
                "  font-weight: 700;"
                "  font-size: 11px;"
                "  padding: 7px 6px;"
                "}"
            );
        } else {
            btn->setStyleSheet(
                "QPushButton {"
                "  background: rgba(255, 255, 255, 0.05);"
                "  color: rgba(200, 200, 215, 0.7);"
                "  border: 1px solid rgba(255, 255, 255, 0.08);"
                "  border-radius: 8px;"
                "  font-weight: 600;"
                "  font-size: 11px;"
                "  padding: 7px 6px;"
                "}"
                "QPushButton:hover {"
                "  background: rgba(255, 255, 255, 0.1);"
                "  color: #FFFFFF;"
                "}"
            );
        }
    };

    setTabStyle(m_tabSubBtn, index == 0);
    setTabStyle(m_tabAudioBtn, index == 1);
    setTabStyle(m_tabVideoBtn, index == 2);
}

void SettingsDrawer::updateActiveSubtitleIndicator() {
    if (!m_activeSubCard || !m_activeSubBadge || !m_activeSubTitle) return;

    if (!m_currentActiveSubdlName.isEmpty()) {
        m_activeSubBadge->setText("🟢 SUBDL SUBTITLE ACTIVE");
        m_activeSubBadge->setStyleSheet("color: #34D399; font-size: 10px; font-weight: 800; letter-spacing: 1px; background: transparent;");
        m_activeSubTitle->setText(m_currentActiveSubdlName);
        m_activeSubTitle->setStyleSheet("color: #FFFFFF; font-size: 11px; font-weight: 600; background: transparent;");
        m_activeSubCard->setStyleSheet("QWidget#ActiveSubCard { background: rgba(16, 185, 129, 0.14); border: 1px solid #10B981; border-radius: 10px; }");
    } else {
        m_activeSubBadge->setText("ACTIVE SUBTITLE");
        m_activeSubBadge->setStyleSheet("color: rgba(200, 200, 215, 160); font-size: 10px; font-weight: 700; letter-spacing: 1px; background: transparent;");
        m_activeSubTitle->setText("Using default or built-in track");
        m_activeSubTitle->setStyleSheet("color: rgba(200, 200, 215, 200); font-size: 11px; font-weight: 500; background: transparent;");
        m_activeSubCard->setStyleSheet("QWidget#ActiveSubCard { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; }");
    }
}

void SettingsDrawer::initUi() {
    QVBoxLayout *rootLayout = new QVBoxLayout(this);
    rootLayout->setContentsMargins(16, 12, 16, 14);
    rootLayout->setSpacing(8);

    // Top Header
    QHBoxLayout *header = new QHBoxLayout();
    header->setSpacing(8);

    QHBoxLayout *titleBox = new QHBoxLayout();
    titleBox->setSpacing(8);

    m_titleIconLabel = new QLabel(this);
    m_titleIconLabel->setFixedSize(20, 20);
    m_titleIconLabel->setScaledContents(true);
    m_titleIconLabel->setStyleSheet("background: transparent;");

    QLabel *title = new QLabel("Settings & Controls", this);
    title->setStyleSheet("font-size: 15px; font-weight: 700; color: #FFFFFF; font-family: 'Segoe UI', sans-serif; background: transparent;");

    titleBox->addWidget(m_titleIconLabel);
    titleBox->addWidget(title);

    m_closeBtn = new QPushButton("✕", this);
    m_closeBtn->setFixedSize(30, 30);
    m_closeBtn->setCursor(Qt::PointingHandCursor);
    m_closeBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(255,255,255,18);"
        "  border: 1px solid rgba(255,255,255,30);"
        "  color: #FFFFFF;"
        "  font-size: 13px;"
        "  font-weight: 700;"
        "  border-radius: 8px;"
        "}"
        "QPushButton:hover {"
        "  background: #E53935;"
        "  border-color: #E53935;"
        "  color: #FFFFFF;"
        "}"
        "QPushButton:pressed { background: #B71C1C; }"
    );
    connect(m_closeBtn, &QPushButton::clicked, this, &QWidget::hide);

    header->addLayout(titleBox);
    header->addStretch();
    header->addWidget(m_closeBtn);
    rootLayout->addLayout(header);

    // Top Segmented Tab Navigation Bar
    QWidget *tabBar = new QWidget(this);
    QHBoxLayout *tabLayout = new QHBoxLayout(tabBar);
    tabLayout->setContentsMargins(0, 4, 0, 4);
    tabLayout->setSpacing(6);

    m_tabSubBtn = new QPushButton("Subtitles", tabBar);
    m_tabSubBtn->setCursor(Qt::PointingHandCursor);
    connect(m_tabSubBtn, &QPushButton::clicked, this, [this]() { switchToTab(0); });

    m_tabAudioBtn = new QPushButton("Audio", tabBar);
    m_tabAudioBtn->setCursor(Qt::PointingHandCursor);
    connect(m_tabAudioBtn, &QPushButton::clicked, this, [this]() { switchToTab(1); });

    m_tabVideoBtn = new QPushButton("Video Filters", tabBar);
    m_tabVideoBtn->setCursor(Qt::PointingHandCursor);
    connect(m_tabVideoBtn, &QPushButton::clicked, this, [this]() { switchToTab(2); });

    tabLayout->addWidget(m_tabSubBtn, 1);
    tabLayout->addWidget(m_tabAudioBtn, 1);
    tabLayout->addWidget(m_tabVideoBtn, 1);
    rootLayout->addWidget(tabBar);

    auto makeSectionRow = [this](const QString &iconName, const QString &text, QWidget *parentWidget) -> QWidget* {
        QWidget *w = new QWidget(parentWidget);
        QHBoxLayout *h = new QHBoxLayout(w);
        h->setContentsMargins(0, 4, 0, 2);
        h->setSpacing(8);

        QLabel *iconLbl = new QLabel(w);
        iconLbl->setFixedSize(16, 16);
        iconLbl->setScaledContents(true);
        iconLbl->setStyleSheet("background: transparent;");
        m_sectionIconLabels.append(qMakePair(iconLbl, iconName));

        QLabel *txtLbl = new QLabel(text, w);
        txtLbl->setStyleSheet("font-size: 12px; font-weight: 600; color: rgba(200,200,215,200); background: transparent;");

        h->addWidget(iconLbl);
        h->addWidget(txtLbl);
        h->addStretch();
        return w;
    };

    auto createScrollPage = [this](QWidget *content) -> QScrollArea* {
        QScrollArea *sa = new QScrollArea(this);
        sa->setWidgetResizable(true);
        sa->setFrameShape(QFrame::NoFrame);
        sa->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
        sa->setStyleSheet(
            "QScrollArea { background: transparent; border: none; }"
            "QScrollBar:vertical { width: 6px; background: transparent; margin: 0; }"
            "QScrollBar::handle:vertical { background: rgba(255,255,255,40); border-radius: 3px; min-height: 20px; }"
            "QScrollBar::handle:vertical:hover { background: rgba(255,255,255,70); }"
            "QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; background: none; }"
        );
        sa->setWidget(content);
        return sa;
    };

    // ==========================================
    // TAB 0: Subtitles Center (مركز الترجمة)
    // ==========================================
    QWidget *subPage = new QWidget();
    subPage->setObjectName("SubPage");
    subPage->setStyleSheet("QWidget#SubPage { background: transparent; }");
    QVBoxLayout *subLayout = new QVBoxLayout(subPage);
    subLayout->setContentsMargins(2, 4, 6, 4);
    subLayout->setSpacing(8);

    // Active Subtitle Card
    m_activeSubCard = new QWidget(subPage);
    m_activeSubCard->setObjectName("ActiveSubCard");
    m_activeSubCard->setStyleSheet("QWidget#ActiveSubCard { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; }");
    QVBoxLayout *actSubLayout = new QVBoxLayout(m_activeSubCard);
    actSubLayout->setContentsMargins(12, 10, 12, 10);
    actSubLayout->setSpacing(3);

    m_activeSubBadge = new QLabel("ACTIVE SUBTITLE", m_activeSubCard);
    m_activeSubBadge->setStyleSheet("color: rgba(200, 200, 215, 160); font-size: 10px; font-weight: 700; letter-spacing: 1px; background: transparent;");

    m_activeSubTitle = new QLabel("Using default or built-in track", m_activeSubCard);
    m_activeSubTitle->setStyleSheet("color: rgba(200, 200, 215, 200); font-size: 11px; font-weight: 500; background: transparent;");
    m_activeSubTitle->setWordWrap(true);

    actSubLayout->addWidget(m_activeSubBadge);
    actSubLayout->addWidget(m_activeSubTitle);
    subLayout->addWidget(m_activeSubCard);

    // Subtitle Tracks
    subLayout->addWidget(makeSectionRow("subtitles.svg", "Subtitle Track", subPage));
    m_subCombo = new QComboBox(subPage);
    connect(m_subCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        int trackId = m_subCombo->itemData(idx).toInt();
        m_engine->setSubtitleTrack(trackId);
    });
    subLayout->addWidget(m_subCombo);

    // Subtitle Sync / Delay
    subLayout->addWidget(makeSectionRow("subtitles.svg", "Subtitle Sync & Delay", subPage));
    m_subDelayCombo = new QComboBox(subPage);
    m_subDelayCombo->addItem("0.0s (Normal Sync)", 0);
    m_subDelayCombo->addItem("-3.0s (Earlier)", -3000);
    m_subDelayCombo->addItem("-2.0s (Earlier)", -2000);
    m_subDelayCombo->addItem("-1.0s (Earlier)", -1000);
    m_subDelayCombo->addItem("-0.5s (Earlier)", -500);
    m_subDelayCombo->addItem("-0.2s (Earlier)", -200);
    m_subDelayCombo->addItem("-0.1s (Earlier)", -100);
    m_subDelayCombo->addItem("+0.1s (Later)", 100);
    m_subDelayCombo->addItem("+0.2s (Later)", 200);
    m_subDelayCombo->addItem("+0.5s (Later)", 500);
    m_subDelayCombo->addItem("+1.0s (Later)", 1000);
    m_subDelayCombo->addItem("+2.0s (Later)", 2000);
    m_subDelayCombo->addItem("+3.0s (Later)", 3000);
    connect(m_subDelayCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        qint64 ms = m_subDelayCombo->itemData(idx).toLongLong();
        m_engine->setSubtitleDelay(ms);
    });
    subLayout->addWidget(m_subDelayCombo);

    // SubDL Online Search Section
    subLayout->addWidget(makeSectionRow("subtitles.svg", "SubDL Online Subtitles", subPage));
    QHBoxLayout *subdlSearchRow = new QHBoxLayout();
    subdlSearchRow->setSpacing(6);

    m_subdlSearchEdit = new QLineEdit(subPage);
    m_subdlSearchEdit->setPlaceholderText("Search SubDL (IMDb, title, S01E01)...");
    m_subdlSearchEdit->setStyleSheet(
        "QLineEdit { background: rgba(255,255,255,10); color: #FFFFFF; border: 1px solid rgba(255,255,255,25); border-radius: 8px; padding: 6px 10px; font-size: 11px; }"
        "QLineEdit:focus { border-color: #818CF8; background: rgba(255,255,255,16); }"
    );
    connect(m_subdlSearchEdit, &QLineEdit::returnPressed, this, [this]() {
        searchSubdlSubtitles(m_subdlSearchEdit->text().trimmed());
    });

    m_subdlSearchBtn = new QPushButton("Search", subPage);
    m_subdlSearchBtn->setCursor(Qt::PointingHandCursor);
    m_subdlSearchBtn->setStyleSheet(
        "QPushButton { background: rgba(99,102,241,35); color: #818CF8; border: 1px solid rgba(99,102,241,60); border-radius: 8px; padding: 6px 14px; font-size: 11px; font-weight: 700; }"
        "QPushButton:hover { background: rgba(99,102,241,55); color: #FFFFFF; }"
    );
    connect(m_subdlSearchBtn, &QPushButton::clicked, this, [this]() {
        searchSubdlSubtitles(m_subdlSearchEdit->text().trimmed());
    });

    subdlSearchRow->addWidget(m_subdlSearchEdit, 1);
    subdlSearchRow->addWidget(m_subdlSearchBtn);
    subLayout->addLayout(subdlSearchRow);

    m_subdlResultsCombo = new QComboBox(subPage);
    m_subdlResultsCombo->addItem("-- No Subtitles Searched Yet --", "");
    connect(m_subdlResultsCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        QString url = m_subdlResultsCombo->itemData(idx).toString();
        m_subdlDownloadBtn->setEnabled(!url.isEmpty());
    });
    subLayout->addWidget(m_subdlResultsCombo);

    m_subdlDownloadBtn = new QPushButton("⬇ Download & Apply Subtitle", subPage);
    m_subdlDownloadBtn->setCursor(Qt::PointingHandCursor);
    m_subdlDownloadBtn->setStyleSheet(
        "QPushButton { background: rgba(16,185,129,35); color: #34D399; border: 1px solid rgba(16,185,129,60); border-radius: 8px; padding: 7px 14px; font-size: 11px; font-weight: 700; }"
        "QPushButton:hover { background: rgba(16,185,129,55); color: #FFFFFF; }"
        "QPushButton:disabled { background: rgba(255,255,255,5); color: rgba(255,255,255,50); border-color: rgba(255,255,255,10); }"
    );
    m_subdlDownloadBtn->setEnabled(false);
    connect(m_subdlDownloadBtn, &QPushButton::clicked, this, [this]() {
        QString url = m_subdlResultsCombo->currentData().toString();
        QString label = m_subdlResultsCombo->currentText();
        if (!url.isEmpty()) {
            downloadSubdlSubtitle(url, label);
        }
    });
    subLayout->addWidget(m_subdlDownloadBtn);

    m_subdlStatusLabel = new QLabel("", subPage);
    m_subdlStatusLabel->setStyleSheet("font-size: 10px; color: rgba(200,200,215,160); margin-left: 2px;");
    m_subdlStatusLabel->setWordWrap(true);
    subLayout->addWidget(m_subdlStatusLabel);

    // Profile Subtitles Center
    subLayout->addWidget(makeSectionRow("subtitles.svg", "Local & Profile Subtitles", subPage));
    m_profileCombo = new QComboBox(subPage);
    connect(m_profileCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        QString dirPath = m_profileCombo->itemData(idx).toString();
        populateShowFolders(dirPath);
    });
    subLayout->addWidget(m_profileCombo);

    m_showCombo = new QComboBox(subPage);
    connect(m_showCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        QString folderPath = m_showCombo->itemData(idx).toString();
        scanProfileSubtitles(folderPath.isEmpty() ? m_profileCombo->currentData().toString() : folderPath);
    });
    subLayout->addWidget(m_showCombo);

    m_profileSubCombo = new QComboBox(subPage);
    connect(m_profileSubCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        QString subPath = m_profileSubCombo->itemData(idx).toString();
        if (!subPath.isEmpty() && QFile::exists(subPath)) {
            bool ok = m_engine->loadExternalSubtitle(subPath);
            if (ok) {
                m_currentActiveSubdlName = QFileInfo(subPath).fileName();
                updateActiveSubtitleIndicator();
                refreshTracks();
            }
        }
    });
    subLayout->addWidget(m_profileSubCombo);

    QHBoxLayout *subBtnsLayout = new QHBoxLayout();
    m_refreshProfileSubsBtn = new QPushButton("Refresh", subPage);
    m_refreshProfileSubsBtn->setCursor(Qt::PointingHandCursor);
    m_refreshProfileSubsBtn->setStyleSheet(
        "QPushButton { background: rgba(255,255,255,10); color: rgba(255,255,255,220); border: 1px solid rgba(255,255,255,25); border-radius: 8px; padding: 6px; font-size: 11px; font-weight: 600; }"
        "QPushButton:hover { background: rgba(255,255,255,22); border-color: rgba(255,255,255,50); color: #FFFFFF; }"
    );
    connect(m_refreshProfileSubsBtn, &QPushButton::clicked, this, &SettingsDrawer::refreshProfileSubtitles);

    m_loadSubBtn = new QPushButton("Browse File...", subPage);
    m_loadSubBtn->setCursor(Qt::PointingHandCursor);
    m_loadSubBtn->setStyleSheet(
        "QPushButton { background: rgba(255,255,255,10); color: rgba(255,255,255,220); border: 1px dashed rgba(255,255,255,30); border-radius: 8px; padding: 6px; font-size: 11px; }"
        "QPushButton:hover { background: rgba(255,255,255,22); border-color: rgba(255,255,255,50); color: #FFFFFF; }"
    );
    connect(m_loadSubBtn, &QPushButton::clicked, this, &SettingsDrawer::loadSubtitleRequested);

    m_addFolderSubBtn = new QPushButton("Add Folder...", subPage);
    m_addFolderSubBtn->setCursor(Qt::PointingHandCursor);
    m_addFolderSubBtn->setStyleSheet(
        "QPushButton { background: rgba(255,255,255,10); color: rgba(255,255,255,220); border: 1px solid rgba(255,255,255,25); border-radius: 8px; padding: 6px; font-size: 11px; font-weight: 600; }"
        "QPushButton:hover { background: rgba(255,255,255,22); border-color: rgba(255,255,255,50); color: #FFFFFF; }"
    );
    connect(m_addFolderSubBtn, &QPushButton::clicked, this, [this]() {
        QString dir = QFileDialog::getExistingDirectory(this, "Select Custom Subtitles Folder");
        if (!dir.isEmpty()) {
            populateShowFolders(dir);
        }
    });

    subBtnsLayout->addWidget(m_refreshProfileSubsBtn);
    subBtnsLayout->addWidget(m_loadSubBtn);
    subBtnsLayout->addWidget(m_addFolderSubBtn);
    subLayout->addLayout(subBtnsLayout);
    subLayout->addStretch();

    populateProfileFolders();

    // ==========================================
    // TAB 1: Audio & Controls (الصوت والتشغيل)
    // ==========================================
    QWidget *audioPage = new QWidget();
    audioPage->setObjectName("AudioPage");
    audioPage->setStyleSheet("QWidget#AudioPage { background: transparent; }");
    QVBoxLayout *audioLayout = new QVBoxLayout(audioPage);
    audioLayout->setContentsMargins(2, 4, 6, 4);
    audioLayout->setSpacing(8);

    // Audio tracks
    audioLayout->addWidget(makeSectionRow("audio.svg", "Audio Track", audioPage));
    m_audioCombo = new QComboBox(audioPage);
    connect(m_audioCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        int trackId = m_audioCombo->itemData(idx).toInt();
        m_engine->setAudioTrack(trackId);
    });
    audioLayout->addWidget(m_audioCombo);

    // Audio Sync / Delay
    audioLayout->addWidget(makeSectionRow("audio.svg", "Audio Sync & Delay", audioPage));
    m_audioDelayCombo = new QComboBox(audioPage);
    m_audioDelayCombo->addItem("0.0s (Normal Sync)", 0);
    m_audioDelayCombo->addItem("-2.0s (Earlier)", -2000);
    m_audioDelayCombo->addItem("-1.0s (Earlier)", -1000);
    m_audioDelayCombo->addItem("-0.5s (Earlier)", -500);
    m_audioDelayCombo->addItem("-0.2s (Earlier)", -200);
    m_audioDelayCombo->addItem("-0.1s (Earlier)", -100);
    m_audioDelayCombo->addItem("+0.1s (Later)", 100);
    m_audioDelayCombo->addItem("+0.2s (Later)", 200);
    m_audioDelayCombo->addItem("+0.5s (Later)", 500);
    m_audioDelayCombo->addItem("+1.0s (Later)", 1000);
    m_audioDelayCombo->addItem("+2.0s (Later)", 2000);
    connect(m_audioDelayCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        qint64 ms = m_audioDelayCombo->itemData(idx).toLongLong();
        m_engine->setAudioDelay(ms);
    });
    audioLayout->addWidget(m_audioDelayCombo);

    // Speed selector
    audioLayout->addWidget(makeSectionRow("forward.svg", "Playback Speed", audioPage));
    m_speedCombo = new QComboBox(audioPage);
    m_speedCombo->addItem("0.25x (Very Slow)", 0.25f);
    m_speedCombo->addItem("0.5x (Slow)", 0.5f);
    m_speedCombo->addItem("0.75x", 0.75f);
    m_speedCombo->addItem("1.0x (Normal)", 1.0f);
    m_speedCombo->addItem("1.25x", 1.25f);
    m_speedCombo->addItem("1.5x", 1.5f);
    m_speedCombo->addItem("1.75x", 1.75f);
    m_speedCombo->addItem("2.0x (Fast)", 2.0f);
    m_speedCombo->addItem("2.5x", 2.5f);
    m_speedCombo->addItem("3.0x (Maximum)", 3.0f);
    m_speedCombo->setCurrentIndex(3);
    connect(m_speedCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        float speed = m_speedCombo->itemData(idx).toFloat();
        m_engine->setSpeed(speed);
    });
    audioLayout->addWidget(m_speedCombo);

    // Aspect ratio selector
    audioLayout->addWidget(makeSectionRow("fullscreen.svg", "Aspect Ratio", audioPage));
    m_aspectCombo = new QComboBox(audioPage);
    m_aspectCombo->addItem("Auto (Original Ratio)", "");
    m_aspectCombo->addItem("16:9 (Widescreen)", "16:9");
    m_aspectCombo->addItem("4:3 (Standard)", "4:3");
    m_aspectCombo->addItem("21:9 (Ultrawide)", "21:9");
    m_aspectCombo->addItem("1:1 (Square)", "1:1");
    connect(m_aspectCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
        QString ratio = m_aspectCombo->itemData(idx).toString();
        m_engine->setAspectRatio(ratio);
    });
    audioLayout->addWidget(m_aspectCombo);
    audioLayout->addStretch();

    // ==========================================
    // TAB 2: Video & Filters (الفيديو والفلاتر)
    // ==========================================
    QWidget *videoPage = new QWidget();
    videoPage->setObjectName("VideoPage");
    videoPage->setStyleSheet("QWidget#VideoPage { background: transparent; }");
    QVBoxLayout *videoLayout = new QVBoxLayout(videoPage);
    videoLayout->setContentsMargins(2, 4, 6, 4);
    videoLayout->setSpacing(8);

    // Video Quality
    m_qualityRowWidget = new QWidget(videoPage);
    QVBoxLayout *qLayout = new QVBoxLayout(m_qualityRowWidget);
    qLayout->setContentsMargins(0, 0, 0, 0);
    qLayout->setSpacing(4);
    qLayout->addWidget(makeSectionRow("fullscreen.svg", "Video / Stream Quality", m_qualityRowWidget));
    m_qualityCombo = new QComboBox(m_qualityRowWidget);
    m_qualityCombo->addItem("1080p (Full HD)", "1080");
    m_qualityCombo->addItem("720p (HD)", "720");
    m_qualityCombo->addItem("480p (SD)", "480");
    m_qualityCombo->addItem("360p (Low)", "360");
    m_qualityCombo->addItem("Auto (Best Available)", "best");
    connect(m_qualityCombo, QOverload<int>::of(&QComboBox::activated), this, [this](int idx) {
        QString qVal = m_qualityCombo->itemData(idx).toString();
        emit qualitySelected(qVal);
    });
    qLayout->addWidget(m_qualityCombo);
    m_qualityRowWidget->hide();
    videoLayout->addWidget(m_qualityRowWidget);

    // Video Adjustments & Filters Section
    videoLayout->addWidget(makeSectionRow("settings.svg", "Video Adjustments & Filters", videoPage));

    auto makeFilterSlider = [this, videoPage, videoLayout](const QString &label, int defaultVal, QLabel **valLabelOut) -> QSlider* {
        QWidget *w = new QWidget(videoPage);
        QHBoxLayout *h = new QHBoxLayout(w);
        h->setContentsMargins(0, 2, 0, 2);
        QLabel *title = new QLabel(label, w);
        title->setStyleSheet("font-size: 11px; color: rgba(255,255,255,180);");
        title->setFixedWidth(75);

        QSlider *slider = new QSlider(Qt::Horizontal, w);
        slider->setRange(0, 200);
        slider->setValue(defaultVal);

        QLabel *val = new QLabel(QString("%1%").arg(defaultVal), w);
        val->setStyleSheet("font-size: 11px; color: #818CF8; font-family: monospace; font-weight: 600;");
        val->setFixedWidth(40);
        val->setAlignment(Qt::AlignRight | Qt::AlignVCenter);

        if (valLabelOut) *valLabelOut = val;

        h->addWidget(title);
        h->addWidget(slider, 1);
        h->addWidget(val);
        videoLayout->addWidget(w);
        return slider;
    };

    m_brightnessSlider = makeFilterSlider("Brightness", 100, &m_brightnessValLabel);
    connect(m_brightnessSlider, &QSlider::valueChanged, this, [this](int v) {
        m_brightnessValLabel->setText(QString("%1%").arg(v));
        m_engine->setBrightness(v / 100.0f);
    });

    m_contrastSlider = makeFilterSlider("Contrast", 100, &m_contrastValLabel);
    connect(m_contrastSlider, &QSlider::valueChanged, this, [this](int v) {
        m_contrastValLabel->setText(QString("%1%").arg(v));
        m_engine->setContrast(v / 100.0f);
    });

    m_saturationSlider = makeFilterSlider("Saturation", 100, &m_saturationValLabel);
    connect(m_saturationSlider, &QSlider::valueChanged, this, [this](int v) {
        m_saturationValLabel->setText(QString("%1%").arg(v));
        m_engine->setSaturation(v / 100.0f);
    });

    m_resetFiltersBtn = new QPushButton("Reset Video Filters", videoPage);
    m_resetFiltersBtn->setCursor(Qt::PointingHandCursor);
    m_resetFiltersBtn->setStyleSheet(
        "QPushButton { background: rgba(255,255,255,10); color: rgba(255,255,255,200); border: 1px solid rgba(255,255,255,25); border-radius: 8px; padding: 6px 12px; font-size: 11px; font-weight: 600; }"
        "QPushButton:hover { background: rgba(255,255,255,20); color: #FFFFFF; }"
    );
    connect(m_resetFiltersBtn, &QPushButton::clicked, this, [this]() {
        m_brightnessSlider->setValue(100);
        m_contrastSlider->setValue(100);
        m_saturationSlider->setValue(100);
        m_engine->resetVideoAdjust();
    });
    videoLayout->addWidget(m_resetFiltersBtn);

    // Nerd Stats Button
    videoLayout->addWidget(makeSectionRow("settings.svg", "Diagnostics", videoPage));
    m_toggleStatsBtn = new QPushButton("Toggle Nerd Stats (HUD)", videoPage);
    m_toggleStatsBtn->setCursor(Qt::PointingHandCursor);
    m_toggleStatsBtn->setStyleSheet(
        "QPushButton { background: rgba(99,102,241,25); color: #818CF8; border: 1px solid rgba(99,102,241,50); border-radius: 8px; padding: 8px 14px; font-size: 11px; font-weight: 700; }"
        "QPushButton:hover { background: rgba(99,102,241,45); color: #FFFFFF; }"
    );
    connect(m_toggleStatsBtn, &QPushButton::clicked, this, [this]() {
        emit toggleNerdStatsRequested();
    });
    videoLayout->addWidget(m_toggleStatsBtn);
    videoLayout->addStretch();

    // Stack Widget
    m_tabStack = new QStackedWidget(this);
    m_tabStack->addWidget(createScrollPage(subPage));
    m_tabStack->addWidget(createScrollPage(audioPage));
    m_tabStack->addWidget(createScrollPage(videoPage));
    rootLayout->addWidget(m_tabStack, 1);

    switchToTab(0);
}

void SettingsDrawer::refreshTracks() {
    m_audioCombo->blockSignals(true);
    m_audioCombo->clear();
    const auto audioTracks = m_engine->getAudioTracks();
    int currAudio = m_engine->getAudioTrack();
    for (const auto &t : audioTracks) {
        m_audioCombo->addItem(t.second.isEmpty() ? QString("Track %1").arg(t.first) : t.second, t.first);
        if (t.first == currAudio) {
            m_audioCombo->setCurrentIndex(m_audioCombo->count() - 1);
        }
    }
    m_audioCombo->blockSignals(false);

    m_subCombo->blockSignals(true);
    m_subCombo->clear();
    const auto subTracks = m_engine->getSubtitleTracks();
    int currSub = m_engine->getSubtitleTrack();
    for (int i = 0; i < subTracks.size(); ++i) {
        const auto &t = subTracks[i];
        QString name = t.second.isEmpty() ? QString("Subtitle %1").arg(t.first) : t.second;
        if (!m_currentActiveSubdlName.isEmpty() && (t.first == currSub || i == subTracks.size() - 1)) {
            name = QString("✓ [SubDL] %1").arg(m_currentActiveSubdlName);
        }
        m_subCombo->addItem(name, t.first);
        if (t.first == currSub) {
            m_subCombo->setCurrentIndex(m_subCombo->count() - 1);
        }
    }
    m_subCombo->blockSignals(false);
    updateActiveSubtitleIndicator();
}

void SettingsDrawer::populateProfileFolders() {
    if (!m_profileCombo) return;
    m_profileCombo->blockSignals(true);
    m_profileCombo->clear();

    QStringList roots;
    QString movies = QStandardPaths::writableLocation(QStandardPaths::MoviesLocation);
    QString docs = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation);
    QString home = QDir::homePath();

    roots.append(movies + "/MEEM");
    roots.append(home + "/Videos/MEEM");
    roots.append(docs + "/MEEM");
    roots.append(home + "/Documents/MEEM");

    QSet<QString> addedProfilePaths;

    for (const QString &rootPath : roots) {
        QDir rootDir(rootPath);
        if (!rootDir.exists()) continue;

        QFileInfoList profileDirs = rootDir.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot);
        for (const QFileInfo &pInfo : profileDirs) {
            QString profileName = pInfo.fileName();
            QString subDirPath = pInfo.filePath() + "/Subtitles";
            
            if (QDir(subDirPath).exists() || QDir(pInfo.filePath()).exists()) {
                if (!addedProfilePaths.contains(subDirPath)) {
                    addedProfilePaths.insert(subDirPath);
                    m_profileCombo->addItem(QString("📁 %1 (Subtitles)").arg(profileName), subDirPath);
                }
            }
        }
    }

    if (m_profileCombo->count() == 0) {
        QString defaultSubPath = movies + "/MEEM/Default/Subtitles";
        m_profileCombo->addItem("📁 Default (Subtitles)", defaultSubPath);
    }

    m_profileCombo->blockSignals(false);

    if (m_profileCombo->count() > 0) {
        populateShowFolders(m_profileCombo->currentData().toString());
    }
}

void SettingsDrawer::populateShowFolders(const QString &profileSubDirPath) {
    if (!m_showCombo) return;
    m_showCombo->blockSignals(true);
    m_showCombo->clear();

    m_showCombo->addItem("🎬 All Shows / Root Folder", profileSubDirPath);

    QDir dir(profileSubDirPath);
    if (dir.exists()) {
        QFileInfoList showDirs = dir.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot);
        for (const QFileInfo &sInfo : showDirs) {
            m_showCombo->addItem(QString("📁 %1").arg(sInfo.fileName()), sInfo.filePath());
        }
    }

    m_showCombo->blockSignals(false);

    if (m_showCombo->count() > 0) {
        scanProfileSubtitles(m_showCombo->currentData().toString());
    }
}

void SettingsDrawer::scanProfileSubtitles(const QString &subtitlesDirPath) {
    if (!m_profileSubCombo) return;
    m_profileSubCombo->blockSignals(true);
    m_profileSubCombo->clear();

    QDir subDir(subtitlesDirPath);
    if (!subDir.exists()) {
        m_profileSubCombo->addItem("-- No Subtitles in Folder --", "");
        m_profileSubCombo->blockSignals(false);
        return;
    }

    QDirIterator it(subtitlesDirPath, QStringList() << "*.srt" << "*.vtt" << "*.ass" << "*.sub",
                    QDir::Files, QDirIterator::Subdirectories);

    int count = 0;
    m_profileSubCombo->addItem("-- Select Subtitle to Load --", "");

    while (it.hasNext()) {
        QString fullPath = it.next();
        QString relPath = subDir.relativeFilePath(fullPath);
        m_profileSubCombo->addItem(QString("📝 %1").arg(relPath), fullPath);
        count++;
    }

    if (count == 0) {
        m_profileSubCombo->clear();
        m_profileSubCombo->addItem("-- Subtitles Folder Empty --", "");
    }

    m_profileSubCombo->blockSignals(false);
}

void SettingsDrawer::refreshProfileSubtitles() {
    populateProfileFolders();
}

void SettingsDrawer::setAvailableQualities(const QStringList &qualities, const QString &currentQuality) {
    if (!m_qualityCombo) return;
    m_qualityCombo->blockSignals(true);
    m_qualityCombo->clear();
    for (const QString &q : qualities) {
        QString label = q;
        QString val = q.toLower().remove("p");
        if (q.contains("1080")) label = "1080p (Full HD)";
        else if (q.contains("720")) label = "720p (HD)";
        else if (q.contains("480")) label = "480p (SD)";
        else if (q.contains("360")) label = "360p (Low)";
        else if (q.toLower() == "auto" || q.toLower() == "best") { label = "Auto (Best Available)"; val = "best"; }
        m_qualityCombo->addItem(label, val);
    }
    setCurrentQuality(currentQuality);
    m_qualityCombo->blockSignals(false);
}

void SettingsDrawer::setCurrentQuality(const QString &quality) {
    if (!m_qualityCombo) return;
    QString clean = quality.toLower().remove("p");
    for (int i = 0; i < m_qualityCombo->count(); ++i) {
        if (m_qualityCombo->itemData(i).toString().toLower() == clean ||
            m_qualityCombo->itemText(i).toLower().contains(clean)) {
            m_qualityCombo->setCurrentIndex(i);
            break;
        }
    }
}

void SettingsDrawer::setQualityVisible(bool visible) {
    if (m_qualityRowWidget) {
        m_qualityRowWidget->setVisible(visible);
    }
}

void SettingsDrawer::setMediaContext(const QString &imdbId, const QString &tmdbId, const QString &showTitle, int season, int episode, const QString &subdlApiKey, int syncPort) {
    if (m_currentEpisode != episode || m_currentShowTitle != showTitle) {
        m_currentActiveSubdlName.clear();
        updateActiveSubtitleIndicator();
    }

    m_currentImdbId = imdbId;
    m_currentTmdbId = tmdbId;
    m_currentShowTitle = showTitle;
    m_currentSeason = season;
    m_currentEpisode = episode;
    if (!subdlApiKey.isEmpty()) m_subdlApiKey = subdlApiKey;
    if (syncPort > 0) m_syncPort = syncPort;

    if (m_subdlSearchEdit) {
        if (season > 0 && episode > 0 && !showTitle.isEmpty()) {
            m_subdlSearchEdit->setText(QString("%1 S%2E%3").arg(showTitle).arg(season, 2, 10, QChar('0')).arg(episode, 2, 10, QChar('0')));
        } else if (!showTitle.isEmpty()) {
            m_subdlSearchEdit->setText(showTitle);
        }
    }

    if (!m_currentImdbId.isEmpty() || !m_currentTmdbId.isEmpty() || !m_currentShowTitle.isEmpty()) {
        searchSubdlSubtitles();
    }
}

void SettingsDrawer::searchSubdlSubtitles(const QString &queryOverride) {
    if (!m_netMgr) m_netMgr = new QNetworkAccessManager(this);

    QString query = queryOverride.trimmed();
    if (query.isEmpty()) {
        if (m_subdlSearchEdit && !m_subdlSearchEdit->text().trimmed().isEmpty()) {
            query = m_subdlSearchEdit->text().trimmed();
        } else {
            query = m_currentShowTitle;
        }
    }

    if (m_subdlStatusLabel) m_subdlStatusLabel->setText("Searching SubDL subtitles...");
    if (m_subdlResultsCombo) {
        m_subdlResultsCombo->blockSignals(true);
        m_subdlResultsCombo->clear();
        m_subdlResultsCombo->addItem("Searching...", "");
        m_subdlResultsCombo->blockSignals(false);
    }
    if (m_subdlDownloadBtn) m_subdlDownloadBtn->setEnabled(false);

    QString requestUrl;
    if (m_syncPort > 0) {
        QUrl u(QString("http://127.0.0.1:%1/api/subtitles/subdl/search").arg(m_syncPort));
        QUrlQuery q;
        if (!m_currentImdbId.isEmpty()) q.addQueryItem("imdb_id", m_currentImdbId);
        if (!m_currentTmdbId.isEmpty()) q.addQueryItem("tmdb_id", m_currentTmdbId);
        if (m_currentSeason > 0) q.addQueryItem("season", QString::number(m_currentSeason));
        if (m_currentEpisode > 0) q.addQueryItem("episode", QString::number(m_currentEpisode));
        if (!query.isEmpty()) q.addQueryItem("film_name", query);
        if (!m_subdlApiKey.isEmpty()) q.addQueryItem("api_key", m_subdlApiKey);
        q.addQueryItem("type", m_currentSeason > 0 ? "tv" : "movie");
        q.addQueryItem("languages", "AR,EN");
        u.setQuery(q);
        requestUrl = u.toString();
    } else {
        QUrl u("https://api.subdl.com/api/v1/subtitles");
        QUrlQuery q;
        if (!m_subdlApiKey.isEmpty()) q.addQueryItem("api_key", m_subdlApiKey);
        if (!m_currentImdbId.isEmpty()) q.addQueryItem("imdb_id", m_currentImdbId);
        if (!m_currentTmdbId.isEmpty()) q.addQueryItem("tmdb_id", m_currentTmdbId);
        if (m_currentSeason > 0) q.addQueryItem("season_number", QString::number(m_currentSeason));
        if (m_currentEpisode > 0) q.addQueryItem("episode_number", QString::number(m_currentEpisode));
        if (!query.isEmpty() && m_currentImdbId.isEmpty() && m_currentTmdbId.isEmpty()) q.addQueryItem("film_name", query);
        q.addQueryItem("type", m_currentSeason > 0 ? "tv" : "movie");
        q.addQueryItem("languages", "AR,EN");
        u.setQuery(q);
        requestUrl = u.toString();
    }

    QNetworkRequest req((QUrl(requestUrl)));
    req.setHeader(QNetworkRequest::UserAgentHeader, "MEEM-Player/1.0");

    QNetworkReply *reply = m_netMgr->get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        if (reply->error() == QNetworkReply::NoError) {
            QByteArray data = reply->readAll();
            QJsonDocument doc = QJsonDocument::fromJson(data);
            if (doc.isObject()) {
                QJsonObject root = doc.object();
                QJsonArray subsArray;
                if (root.contains("subtitles") && root["subtitles"].isArray()) {
                    subsArray = root["subtitles"].toArray();
                }

                m_subdlResultsCombo->blockSignals(true);
                m_subdlResultsCombo->clear();

                int count = 0;
                for (const QJsonValue &val : subsArray) {
                    QJsonObject s = val.toObject();
                    QString dlUrl = s.contains("url") ? s["url"].toString() : "";
                    if (!dlUrl.isEmpty() && !dlUrl.startsWith("http")) {
                        dlUrl = "https://dl.subdl.com" + dlUrl;
                    }

                    QString label = s.contains("label") ? s["label"].toString() : "";
                    if (label.isEmpty()) {
                        QString lang = s.contains("lang") ? s["lang"].toString().toUpper() : (s.contains("language") ? s["language"].toString().toUpper() : "UNKNOWN");
                        QString rel = s.contains("releaseName") ? s["releaseName"].toString() : (s.contains("release_name") ? s["release_name"].toString() : (s.contains("name") ? s["name"].toString() : ""));
                        QString author = s.contains("author") ? QString(" (by %1)").arg(s["author"].toString()) : "";
                        label = QString("[%1] %2%3").arg(lang).arg(rel.isEmpty() ? "Subtitle" : rel).arg(author);
                    }

                    if (!dlUrl.isEmpty()) {
                        m_subdlResultsCombo->addItem(label, dlUrl);
                        count++;
                    }
                }

                m_subdlResultsCombo->blockSignals(false);

                if (count > 0) {
                    m_subdlStatusLabel->setText(QString("✓ Found %1 subtitles on SubDL").arg(count));
                    m_subdlDownloadBtn->setEnabled(true);
                } else {
                    m_subdlResultsCombo->addItem("-- No Subtitles Found --", "");
                    m_subdlStatusLabel->setText("No subtitles found for this title/episode.");
                    m_subdlDownloadBtn->setEnabled(false);
                }
            } else {
                m_subdlStatusLabel->setText("Invalid response from SubDL API.");
            }
        } else {
            m_subdlStatusLabel->setText(QString("SubDL search failed: %1").arg(reply->errorString()));
            m_subdlResultsCombo->clear();
            m_subdlResultsCombo->addItem("-- Search Failed --", "");
        }
        reply->deleteLater();
    });
}

void SettingsDrawer::downloadSubdlSubtitle(const QString &url, const QString &label) {
    if (url.isEmpty()) return;
    if (!m_netMgr) m_netMgr = new QNetworkAccessManager(this);

    m_subdlStatusLabel->setText(QString("Downloading: %1...").arg(label));
    m_subdlDownloadBtn->setEnabled(false);

    if (m_syncPort > 0) {
        QUrl u(QString("http://127.0.0.1:%1/api/subtitles/subdl/download").arg(m_syncPort));
        QUrlQuery q;
        q.addQueryItem("url", url);
        if (m_currentEpisode > 0) {
            q.addQueryItem("episode", QString::number(m_currentEpisode));
        }
        if (m_currentSeason > 0) {
            q.addQueryItem("season", QString::number(m_currentSeason));
        }
        u.setQuery(q);

        QNetworkRequest req(u);
        req.setHeader(QNetworkRequest::UserAgentHeader, "MEEM-Player/1.0");

        QNetworkReply *reply = m_netMgr->get(req);
        connect(reply, &QNetworkReply::finished, this, [this, reply, label]() {
            if (reply->error() == QNetworkReply::NoError) {
                QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
                if (doc.isObject() && doc.object().value("success").toBool()) {
                    QString srtPath = doc.object().value("path").toString();
                    if (!srtPath.isEmpty() && QFile::exists(srtPath)) {
                        bool ok = m_engine->loadExternalSubtitle(srtPath);
                        if (ok) {
                            m_currentActiveSubdlName = label;
                            updateActiveSubtitleIndicator();
                            refreshTracks();
                            m_subdlStatusLabel->setText(QString("✓ Successfully loaded subtitle: %1").arg(label));
                        } else {
                            m_subdlStatusLabel->setText("Failed to apply subtitle in player engine.");
                        }
                    } else {
                        m_subdlStatusLabel->setText("Subtitle file not found after extraction.");
                    }
                } else {
                    QString err = doc.object().value("error").toString();
                    m_subdlStatusLabel->setText(QString("Download error: %1").arg(err.isEmpty() ? "Unknown error" : err));
                }
            } else {
                m_subdlStatusLabel->setText(QString("Download request failed: %1").arg(reply->errorString()));
            }
            m_subdlDownloadBtn->setEnabled(true);
            reply->deleteLater();
        });
    } else {
        QNetworkRequest req((QUrl(url)));
        req.setHeader(QNetworkRequest::UserAgentHeader, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
        req.setRawHeader("Referer", "https://subdl.com/");

        QNetworkReply *reply = m_netMgr->get(req);
        connect(reply, &QNetworkReply::finished, this, [this, reply, label, url]() {
            if (reply->error() == QNetworkReply::NoError) {
                QByteArray data = reply->readAll();
                QString tempDir = QStandardPaths::writableLocation(QStandardPaths::TempLocation) + "/meem_player_subs";
                QDir().mkpath(tempDir);

                QString targetSrt;
                if (data.startsWith("PK")) {
                    QString zipPath = tempDir + QString("/sub_%1.zip").arg(QDateTime::currentMSecsSinceEpoch());
                    QFile f(zipPath);
                    if (f.open(QIODevice::WriteOnly)) {
                        f.write(data);
                        f.close();
                    }

                    QString extractSubDir = tempDir + QString("/sub_%1").arg(QDateTime::currentMSecsSinceEpoch());
                    QDir().mkpath(extractSubDir);

                    QProcess proc;
                    proc.start("tar.exe", QStringList() << "-xf" << zipPath << "-C" << extractSubDir);
                    proc.waitForFinished(5000);

                    QDirIterator it(extractSubDir, QStringList() << "*.srt" << "*.ass" << "*.vtt", QDir::Files, QDirIterator::Subdirectories);
                    QStringList candidates;
                    while (it.hasNext()) {
                        candidates.append(it.next());
                    }

                    if (!candidates.isEmpty()) {
                        if (m_currentEpisode > 0 && candidates.size() > 1) {
                            int bestScore = -1;
                            QString bestFile = candidates[0];

                            for (const QString &cPath : candidates) {
                                QString fName = QFileInfo(cPath).fileName().toLower();
                                int score = 0;

                                if (m_currentSeason > 0) {
                                    QRegularExpression sRegex(QString("s0*%1e0*%2([^0-9]|$)").arg(m_currentSeason).arg(m_currentEpisode), QRegularExpression::CaseInsensitiveOption);
                                    if (sRegex.match(fName).hasMatch()) score += 100;
                                }

                                QRegularExpression epRegex(QString("(?:e|ep|episode)[._ -]?0*%1([^0-9]|$)").arg(m_currentEpisode), QRegularExpression::CaseInsensitiveOption);
                                if (epRegex.match(fName).hasMatch()) score += 80;

                                QRegularExpression delimRegex(QString("[\\[\\(_ .-]0*%1[\\]\\)_ .-]").arg(m_currentEpisode), QRegularExpression::CaseInsensitiveOption);
                                if (delimRegex.match(fName).hasMatch()) score += 60;

                                QRegularExpression isoRegex(QString("(^|[^0-9])0*%1([^0-9]|$)").arg(m_currentEpisode), QRegularExpression::CaseInsensitiveOption);
                                if (isoRegex.match(fName).hasMatch()) score += 40;

                                if (score > bestScore) {
                                    bestScore = score;
                                    bestFile = cPath;
                                }
                            }
                            targetSrt = bestFile;
                        } else {
                            targetSrt = candidates[0];
                        }
                    }
                } else {
                    targetSrt = tempDir + QString("/sub_%1.srt").arg(QDateTime::currentMSecsSinceEpoch());
                    QFile f(targetSrt);
                    if (f.open(QIODevice::WriteOnly)) {
                        f.write(data);
                        f.close();
                    }
                }

                if (!targetSrt.isEmpty() && QFile::exists(targetSrt)) {
                    bool ok = m_engine->loadExternalSubtitle(targetSrt);
                    if (ok) {
                        m_currentActiveSubdlName = label;
                        updateActiveSubtitleIndicator();
                        refreshTracks();
                        m_subdlStatusLabel->setText(QString("✓ Successfully loaded subtitle: %1").arg(label));
                    } else {
                        m_subdlStatusLabel->setText("Failed to apply subtitle in player engine.");
                    }
                } else {
                    m_subdlStatusLabel->setText("Failed to extract subtitle from downloaded archive.");
                }
            } else {
                m_subdlStatusLabel->setText(QString("Download failed: %1").arg(reply->errorString()));
            }
            m_subdlDownloadBtn->setEnabled(true);
            reply->deleteLater();
        });
    }
}


