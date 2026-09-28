#include "VideoCanvasWidget.h"
#include <QMimeData>
#include <QUrl>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFileInfo>
#include <QIcon>
#include <QPixmap>
#include <QApplication>
#include <QProgressBar>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QPointer>
#include <windows.h>

VideoCanvasWidget::VideoCanvasWidget(QWidget *parent) : QWidget(parent) {
    setAttribute(Qt::WA_NativeWindow, true);
    setAttribute(Qt::WA_PaintOnScreen, true);
    setAttribute(Qt::WA_OpaquePaintEvent, true);
    setAttribute(Qt::WA_NoSystemBackground, true);
    setAttribute(Qt::WA_DontCreateNativeAncestors, true);
    setAcceptDrops(true);
    setMouseTracking(true);
    setStyleSheet("background-color: #0A0A0C;");

    initIdleUi();
    initLoadingUi();
    initOsdUi();
}

void VideoCanvasWidget::initOsdUi() {
    m_osdWidget = new QWidget(this);
    m_osdWidget->setObjectName("OsdBadge");
    m_osdWidget->setFixedSize(220, 52);
    m_osdWidget->setStyleSheet(
        "QWidget#OsdBadge {"
        "  background: rgba(14, 14, 18, 220);"
        "  border: 1px solid rgba(255, 255, 255, 45);"
        "  border-radius: 12px;"
        "}"
    );

    QVBoxLayout *layout = new QVBoxLayout(m_osdWidget);
    layout->setContentsMargins(16, 8, 16, 8);
    layout->setSpacing(2);

    m_osdLabel = new QLabel("Volume: 100%", m_osdWidget);
    m_osdLabel->setAlignment(Qt::AlignCenter);
    m_osdLabel->setStyleSheet(
        "font-size: 14px; font-weight: 700; color: #FFFFFF;"
        "font-family: 'Segoe UI', sans-serif; background: transparent;"
    );

    layout->addWidget(m_osdLabel);
    m_osdWidget->hide();

    m_osdTimer.setSingleShot(true);
    m_osdTimer.setInterval(1400);
    connect(&m_osdTimer, &QTimer::timeout, this, [this]() {
        if (m_osdWidget) m_osdWidget->hide();
    });
}

void VideoCanvasWidget::showOsdToast(const QString &title, int percentage, const QString &iconPath) {
    Q_UNUSED(iconPath);
    if (!m_osdWidget || !m_osdLabel) return;

    QString text = QString("%1: %2%").arg(title).arg(percentage);
    m_osdLabel->setText(text);

    int posX = (width() - m_osdWidget->width()) / 2;
    int posY = 65; // Positioned near top
    m_osdWidget->move(posX, posY);
    m_osdWidget->show();
    m_osdWidget->raise();

    m_osdTimer.start();
}

void VideoCanvasWidget::initIdleUi() {
    m_idleWidget = new QWidget(this);
    m_idleWidget->setObjectName("IdleWidget");
    m_idleWidget->setStyleSheet("QWidget#IdleWidget { background-color: #0A0A0C; }");

    QVBoxLayout *layout = new QVBoxLayout(m_idleWidget);
    layout->setAlignment(Qt::AlignCenter);
    layout->setSpacing(10);

    m_idleLogo = new QLabel(m_idleWidget);
    m_idleLogo->setAlignment(Qt::AlignCenter);

    QString icoPath = QApplication::applicationDirPath() + "/assets/ico.png";
    if (!QFileInfo::exists(icoPath)) {
        icoPath = "assets/ico.png";
    }
    if (QFileInfo::exists(icoPath)) {
        QPixmap pix(icoPath);
        m_idleLogo->setPixmap(pix.scaled(72, 72, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    }

    m_idleTitle = new QLabel("MEEM PLAYER", m_idleWidget);
    m_idleTitle->setAlignment(Qt::AlignCenter);
    m_idleTitle->setStyleSheet(
        "font-size: 30px; font-weight: 800; color: #FFFFFF;"
        "letter-spacing: 5px; font-family: 'Segoe UI', 'Comfortaa', sans-serif;"
    );

    m_idleSubtitle = new QLabel("No file playing — Drop video files here or click Open File to start", m_idleWidget);
    m_idleSubtitle->setAlignment(Qt::AlignCenter);
    m_idleSubtitle->setStyleSheet(
        "font-size: 13px; color: rgba(200,200,215,160);"
        "font-family: 'Segoe UI', sans-serif;"
    );

    m_idleOpenBtn = new QPushButton(" Open File", m_idleWidget);
    m_idleOpenBtn->setCursor(Qt::PointingHandCursor);
    m_idleOpenBtn->setIconSize(QSize(18, 18));
    m_idleOpenBtn->setFixedHeight(40);
    m_idleOpenBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(255,255,255,16);"
        "  color: #FFFFFF;"
        "  font-weight: 700;"
        "  font-size: 13px;"
        "  padding: 0 24px;"
        "  border-radius: 10px;"
        "  border: 1px solid rgba(255,255,255,30);"
        "}"
        "QPushButton:hover { background: rgba(255,255,255,32); border-color: rgba(255,255,255,55); }"
        "QPushButton:pressed { background: rgba(255,255,255,48); }"
    );
    connect(m_idleOpenBtn, &QPushButton::clicked, this, &VideoCanvasWidget::openFileRequested);

    layout->addWidget(m_idleLogo);
    layout->addWidget(m_idleTitle);
    layout->addWidget(m_idleSubtitle);
    layout->addSpacing(8);
    layout->addWidget(m_idleOpenBtn, 0, Qt::AlignCenter);

    m_idleWidget->show();
}

void VideoCanvasWidget::initLoadingUi() {
    m_loadingWidget = new QWidget(this);
    m_loadingWidget->setObjectName("LoadingOverlay");
    m_loadingWidget->setStyleSheet("QWidget#LoadingOverlay { background-color: #0A0A0C; }");

    QVBoxLayout *rootLayout = new QVBoxLayout(m_loadingWidget);
    rootLayout->setAlignment(Qt::AlignCenter);

    QWidget *card = new QWidget(m_loadingWidget);
    card->setObjectName("LoadingCard");
    card->setFixedSize(380, 250);
    card->setStyleSheet(
        "QWidget#LoadingCard {"
        "  background: rgba(18, 18, 24, 230);"
        "  border: 1px solid rgba(255, 255, 255, 35);"
        "  border-radius: 16px;"
        "}"
    );

    QVBoxLayout *cardLayout = new QVBoxLayout(card);
    cardLayout->setContentsMargins(20, 18, 20, 18);
    cardLayout->setSpacing(10);
    cardLayout->setAlignment(Qt::AlignCenter);

    m_loadingThumb = new QLabel(card);
    m_loadingThumb->setFixedSize(140, 80);
    m_loadingThumb->setAlignment(Qt::AlignCenter);
    m_loadingThumb->setScaledContents(true);
    m_loadingThumb->setStyleSheet("background: #141419; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 20);");

    m_loadingTitle = new QLabel("Loading Media...", card);
    m_loadingTitle->setAlignment(Qt::AlignCenter);
    m_loadingTitle->setWordWrap(true);
    m_loadingTitle->setStyleSheet("font-size: 14px; font-weight: 700; color: #FFFFFF; font-family: 'Segoe UI', sans-serif; background: transparent;");

    m_loadingSubtitle = new QLabel("", card);
    m_loadingSubtitle->setAlignment(Qt::AlignCenter);
    m_loadingSubtitle->setStyleSheet("font-size: 11px; color: rgba(200, 200, 215, 180); font-family: 'Segoe UI', sans-serif; background: transparent;");

    m_loadingBar = new QProgressBar(card);
    m_loadingBar->setRange(0, 0); // Indeterminate smooth pulsing bar
    m_loadingBar->setFixedHeight(4);
    m_loadingBar->setTextVisible(false);
    m_loadingBar->setStyleSheet(
        "QProgressBar { background: rgba(255, 255, 255, 15); border: none; border-radius: 2px; }"
        "QProgressBar::chunk { background: #818CF8; border-radius: 2px; }"
    );

    m_loadingStatus = new QLabel("Loading & Buffering Media...", card);
    m_loadingStatus->setAlignment(Qt::AlignCenter);
    m_loadingStatus->setStyleSheet("font-size: 11px; color: #818CF8; font-weight: 600; font-family: 'Segoe UI', sans-serif; background: transparent;");

    cardLayout->addWidget(m_loadingThumb, 0, Qt::AlignCenter);
    cardLayout->addWidget(m_loadingTitle);
    cardLayout->addWidget(m_loadingSubtitle);
    cardLayout->addWidget(m_loadingBar);
    cardLayout->addWidget(m_loadingStatus);

    rootLayout->addWidget(card, 0, Qt::AlignCenter);
    m_loadingWidget->hide();
}

void VideoCanvasWidget::showLoading(const QString &title, const QString &subtitle, const QString &thumbnailOrPoster) {
    m_isLoading = true;
    if (m_idleWidget) m_idleWidget->hide();

    if (m_loadingTitle) {
        m_loadingTitle->setText(title.isEmpty() ? "Loading Media..." : title);
    }
    if (m_loadingSubtitle) {
        m_loadingSubtitle->setText(subtitle);
        m_loadingSubtitle->setVisible(!subtitle.isEmpty());
    }

    if (m_loadingThumb) {
        QString icoPath = QApplication::applicationDirPath() + "/assets/ico.png";
        if (!QFileInfo::exists(icoPath)) icoPath = "assets/ico.png";
        if (QFileInfo::exists(icoPath)) {
            m_loadingThumb->setPixmap(QPixmap(icoPath).scaled(72, 72, Qt::KeepAspectRatio, Qt::SmoothTransformation));
        }

        if (!thumbnailOrPoster.isEmpty()) {
            if (thumbnailOrPoster.startsWith("http://") || thumbnailOrPoster.startsWith("https://")) {
                if (!m_netMgr) m_netMgr = new QNetworkAccessManager(this);
                QNetworkRequest req((QUrl(thumbnailOrPoster)));
                req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
                req.setHeader(QNetworkRequest::UserAgentHeader, "MEEM-Player/1.0");
                req.setRawHeader("Accept", "image/jpeg,image/png,image/*;q=0.8");
                QPointer<QLabel> safeThumb(m_loadingThumb);
                QNetworkReply *reply = m_netMgr->get(req);
                connect(reply, &QNetworkReply::finished, this, [reply, safeThumb]() {
                    if (reply->error() == QNetworkReply::NoError) {
                        QPixmap pm;
                        if (pm.loadFromData(reply->readAll())) {
                            if (safeThumb) {
                                safeThumb->setPixmap(pm.scaled(140, 80, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
                            }
                        }
                    }
                    reply->deleteLater();
                });
            } else if (QFile::exists(thumbnailOrPoster)) {
                QPixmap pm(thumbnailOrPoster);
                if (!pm.isNull()) {
                    m_loadingThumb->setPixmap(pm.scaled(140, 80, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
                }
            }
        }
    }

    if (m_loadingWidget) {
        m_loadingWidget->setGeometry(rect());
        m_loadingWidget->show();
        m_loadingWidget->raise();
    }
}

void VideoCanvasWidget::hideLoading() {
    m_isLoading = false;
    if (m_loadingWidget) {
        m_loadingWidget->hide();
    }
}

void VideoCanvasWidget::setMediaActive(bool active) {
    m_mediaActive = active;
    if (active) {
        if (m_idleWidget) {
            m_idleWidget->hide();
        }
    } else {
        hideLoading();
        if (m_idleWidget) {
            m_idleWidget->show();
            m_idleWidget->raise();
        }
    }
    update();
}

void VideoCanvasWidget::paintEvent(QPaintEvent *event) {
    if (!m_mediaActive || m_isLoading) {
        QWidget::paintEvent(event);
    }
}

void VideoCanvasWidget::setIconsBasePath(const QString &basePath) {
    m_iconsBasePath = basePath;
    QString path = basePath + "/open_file.svg";
    if (QFileInfo::exists(path)) {
        m_idleOpenBtn->setIcon(QIcon(path));
    }
}

void *VideoCanvasWidget::getNativeWinId() const {
    return (void *)winId();
}

void VideoCanvasWidget::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);
    if (m_idleWidget) {
        m_idleWidget->setGeometry(rect());
    }
    if (m_loadingWidget) {
        m_loadingWidget->setGeometry(rect());
    }
    if (m_osdWidget && m_osdWidget->isVisible()) {
        m_osdWidget->move((width() - m_osdWidget->width()) / 2, 65);
    }
}

void VideoCanvasWidget::wheelEvent(QWheelEvent *event) {
    int delta = event->angleDelta().y();
    if (delta == 0) delta = event->angleDelta().x();
    if (delta != 0) {
        // Left half -> Brightness, Right half -> Volume
        if (event->position().x() < width() / 2) {
            float bDelta = (delta > 0) ? +0.05f : -0.05f;
            emit brightnessAdjustRequested(bDelta);
        } else {
            int vDelta = (delta > 0) ? +5 : -5;
            emit volumeAdjustRequested(vDelta);
        }
        event->accept();
        return;
    }
    QWidget::wheelEvent(event);
}

void VideoCanvasWidget::dragEnterEvent(QDragEnterEvent *event) {
    if (event->mimeData()->hasUrls()) {
        event->acceptProposedAction();
    }
}

void VideoCanvasWidget::dropEvent(QDropEvent *event) {
    QStringList paths;
    const QList<QUrl> urls = event->mimeData()->urls();
    for (const QUrl &url : urls) {
        if (url.isLocalFile()) {
            paths.append(url.toLocalFile());
        }
    }
    if (!paths.isEmpty()) {
        emit filesDropped(paths);
        event->acceptProposedAction();
    }
}

void VideoCanvasWidget::mouseMoveEvent(QMouseEvent *event) {
    Q_UNUSED(event);
    emit mouseMovedSignal();
}

void VideoCanvasWidget::mouseReleaseEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        emit clickedSignal();
    }
    QWidget::mouseReleaseEvent(event);
}

void VideoCanvasWidget::mouseDoubleClickEvent(QMouseEvent *event) {
    Q_UNUSED(event);
    emit doubleClickedSignal();
}

#ifdef _WIN32
#include <windowsx.h>

static LRESULT CALLBACK VlcDirect3DChildProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    if (uMsg == WM_NCHITTEST) {
        POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
        HWND root = GetAncestor(hwnd, GA_ROOT);
        if (root) {
            RECT r;
            GetWindowRect(root, &r);
            const int B = 10;
            if (pt.x < r.left + B || pt.x >= r.right - B || pt.y < r.top + B || pt.y >= r.bottom - B) {
                return HTTRANSPARENT;
            }
        }
    }
    if (uMsg == WM_LBUTTONUP) {
        HWND root = GetAncestor(hwnd, GA_ROOT);
        if (root) {
            PostMessage(root, WM_USER + 101, 0, 0);
        }
    }
    WNDPROC oldProc = (WNDPROC)GetPropW(hwnd, L"OldVlcProc");
    if (oldProc) {
        return CallWindowProcW(oldProc, hwnd, uMsg, wParam, lParam);
    }
    return DefWindowProcW(hwnd, uMsg, wParam, lParam);
}
#endif

void VideoCanvasWidget::hookChildWindows() {
#ifdef _WIN32
    HWND parent = (HWND)winId();
    if (!parent) return;
    EnumChildWindows(parent, [](HWND child, LPARAM) -> BOOL {
        if (!GetPropW(child, L"OldVlcProc")) {
            WNDPROC old = (WNDPROC)SetWindowLongPtrW(child, GWLP_WNDPROC, (LONG_PTR)VlcDirect3DChildProc);
            SetPropW(child, L"OldVlcProc", (HANDLE)old);
        }
        return TRUE;
    }, 0);
#endif
}

bool VideoCanvasWidget::nativeEvent(const QByteArray &eventType, void *message, qintptr *result) {
#ifdef _WIN32
    MSG *msg = reinterpret_cast<MSG *>(message);
    if (msg && msg->message == WM_NCHITTEST) {
        POINT pt = { GET_X_LPARAM(msg->lParam), GET_Y_LPARAM(msg->lParam) };
        HWND root = (HWND)window()->winId();
        if (root) {
            RECT r;
            GetWindowRect(root, &r);
            const int B = 10;
            if (pt.x < r.left + B || pt.x >= r.right - B || pt.y < r.top + B || pt.y >= r.bottom - B) {
                *result = HTTRANSPARENT;
                return true;
            }
        }
    }
#endif
    return QWidget::nativeEvent(eventType, message, result);
}

