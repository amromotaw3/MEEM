#include "PlaylistDrawer.h"
#include "styles.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QDir>
#include <QStandardPaths>
#include <QPixmap>
#include <QFile>
#include <QCryptographicHash>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QUrl>
#include <QPointer>
#include <QPainter>
#include <QMouseEvent>
#include <QRegularExpression>
#ifdef _WIN32
#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#endif

PlaylistDrawer::PlaylistDrawer(PlaylistManager *playlistMgr, QWidget *parent)
    : QFrame(parent), m_playlistMgr(playlistMgr)
{
    setObjectName("DrawerPanel");
    setWindowFlags(Qt::WindowType::Dialog | Qt::WindowType::FramelessWindowHint);
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet("QFrame#DrawerPanel { background-color: #0A0A0C; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; color: #FFFFFF; } " + BLACK_WHITE_STYLESHEET);
    resize(430, 580);
    setMinimumSize(320, 400);

    m_netMgr = new QNetworkAccessManager(this);
    initUi();
    connect(m_playlistMgr, &PlaylistManager::playlistUpdated, this, &PlaylistDrawer::refreshList);
    refreshList();
}

void PlaylistDrawer::showEvent(QShowEvent *event) {
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

bool PlaylistDrawer::nativeEvent(const QByteArray &eventType, void *message, qintptr *result) {
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

void PlaylistDrawer::mousePressEvent(QMouseEvent *event) {
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

void PlaylistDrawer::mouseMoveEvent(QMouseEvent *event) {
    if (event->buttons() & Qt::LeftButton && !m_dragPos.isNull()) {
        move(event->globalPosition().toPoint() - m_dragPos);
        event->accept();
        return;
    }
    QFrame::mouseMoveEvent(event);
}

void PlaylistDrawer::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.fillRect(rect(), QColor(10, 10, 12)); // Solid dark background
    painter.setPen(QPen(QColor(255, 255, 255, 20), 1));
    painter.drawRoundedRect(rect().adjusted(0, 0, -1, -1), 16, 16);
}

void PlaylistDrawer::setIconsBasePath(const QString &basePath) {
    m_iconsPath = basePath;
    applyIcons();
}

void PlaylistDrawer::applyIcons() {
    if (m_iconsPath.isEmpty()) return;
    auto loadIcon = [&](const QString &name) -> QIcon {
        QString path = m_iconsPath + "/" + name;
        if (QFileInfo::exists(path)) return QIcon(path);
        return QIcon();
    };

    QIcon icPlaylist = loadIcon("playlist.svg");
    if (!icPlaylist.isNull() && m_titleIconLabel) {
        m_titleIconLabel->setPixmap(icPlaylist.pixmap(20, 20));
        m_titleIconLabel->show();
    }

    QIcon icClose = loadIcon("close.svg");
    if (!icClose.isNull() && m_closeBtn) {
        m_closeBtn->setIcon(icClose);
        m_closeBtn->setIconSize(QSize(16, 16));
        m_closeBtn->setText("");
    }

    QIcon icOpenFile = loadIcon("open_file.svg");
    if (!icOpenFile.isNull() && m_addFilesBtn) {
        m_addFilesBtn->setIcon(icOpenFile);
        m_addFilesBtn->setIconSize(QSize(15, 15));
    }
}

void PlaylistDrawer::initUi() {
    QVBoxLayout *layout = new QVBoxLayout(this);
    layout->setContentsMargins(18, 14, 18, 16);
    layout->setSpacing(10);

    // Top Header with Title and Professional Top-Right Close Button
    QHBoxLayout *header = new QHBoxLayout();
    header->setSpacing(8);

    QHBoxLayout *titleBox = new QHBoxLayout();
    titleBox->setSpacing(8);

    m_titleIconLabel = new QLabel(this);
    m_titleIconLabel->setFixedSize(20, 20);
    m_titleIconLabel->setScaledContents(true);
    m_titleIconLabel->setStyleSheet("background: transparent;");

    QLabel *title = new QLabel("Playlist", this);
    title->setStyleSheet("font-size: 15px; font-weight: 700; color: #FFFFFF; font-family: 'Segoe UI', sans-serif; background: transparent;");

    titleBox->addWidget(m_titleIconLabel);
    titleBox->addWidget(title);

    m_countLabel = new QLabel("0 items", this);
    m_countLabel->setStyleSheet("font-size: 11px; color: rgba(200,200,215,160); background: transparent;");

    m_closeBtn = new QPushButton("✕", this);
    m_closeBtn->setFixedSize(28, 28);
    m_closeBtn->setCursor(Qt::PointingHandCursor);
    m_closeBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(255,255,255,0.06);"
        "  border: 1px solid rgba(255,255,255,0.08);"
        "  color: #FFFFFF;"
        "  font-size: 12px;"
        "  font-weight: 700;"
        "  border-radius: 14px;"
        "}"
        "QPushButton:hover {"
        "  background: rgba(239, 68, 68, 0.85);"
        "  border-color: rgba(239, 68, 68, 0.9);"
        "  color: #FFFFFF;"
        "}"
        "QPushButton:pressed { background: #B71C1C; }"
    );
    connect(m_closeBtn, &QPushButton::clicked, this, &QWidget::hide);

    header->addLayout(titleBox);
    header->addWidget(m_countLabel);
    header->addStretch();
    header->addWidget(m_closeBtn);
    layout->addLayout(header);

    m_searchEdit = new QLineEdit(this);
    m_searchEdit->setPlaceholderText("Search playlist...");
    m_searchEdit->setStyleSheet(
        "QLineEdit {"
        "  background: rgba(255, 255, 255, 0.04);"
        "  border: 1px solid rgba(255, 255, 255, 0.07);"
        "  border-radius: 10px;"
        "  color: #FFFFFF;"
        "  padding: 8px 12px;"
        "  font-size: 12px;"
        "}"
        "QLineEdit:focus {"
        "  border: 1px solid rgba(255, 255, 255, 0.16);"
        "  background: rgba(255, 255, 255, 0.07);"
        "}"
    );
    connect(m_searchEdit, &QLineEdit::textChanged, this, &PlaylistDrawer::filterList);
    layout->addWidget(m_searchEdit);

    m_listWidget = new QListWidget(this);
    m_listWidget->setSpacing(4);
    m_listWidget->setStyleSheet(
        "QListWidget { background: transparent; border: none; outline: none; padding: 2px 0; }"
        "QListWidget::item { background: transparent; border: none; outline: none; margin-bottom: 2px; }"
        "QListWidget::item:selected { background: transparent; border: none; outline: none; }"
    );
    connect(m_listWidget, &QListWidget::itemClicked, this, [this](QListWidgetItem *item) {
        int idx = item->data(Qt::UserRole).toInt();
        emit itemSelected(idx);
    });
    connect(m_listWidget, &QListWidget::itemDoubleClicked, this, [this](QListWidgetItem *item) {
        int idx = item->data(Qt::UserRole).toInt();
        emit itemSelected(idx);
    });
    layout->addWidget(m_listWidget, 1);

    QHBoxLayout *actionRow = new QHBoxLayout();
    actionRow->setSpacing(8);

    m_addFilesBtn = new QPushButton("Add Files", this);
    m_addFilesBtn->setCursor(Qt::PointingHandCursor);
    m_addFilesBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(255, 255, 255, 0.05);"
        "  border: 1px solid rgba(255, 255, 255, 0.08);"
        "  border-radius: 10px;"
        "  color: #FFFFFF;"
        "  padding: 7px 14px;"
        "  font-weight: 600;"
        "  font-size: 12px;"
        "}"
        "QPushButton:hover {"
        "  background: rgba(255, 255, 255, 0.10);"
        "  border-color: rgba(255, 255, 255, 0.16);"
        "}"
    );
    connect(m_addFilesBtn, &QPushButton::clicked, this, &PlaylistDrawer::addFilesRequested);

    m_addFolderBtn = new QPushButton("Add Folder", this);
    m_addFolderBtn->setCursor(Qt::PointingHandCursor);
    m_addFolderBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(255, 255, 255, 0.05);"
        "  border: 1px solid rgba(255, 255, 255, 0.08);"
        "  border-radius: 10px;"
        "  color: #FFFFFF;"
        "  padding: 7px 14px;"
        "  font-weight: 600;"
        "  font-size: 12px;"
        "}"
        "QPushButton:hover {"
        "  background: rgba(255, 255, 255, 0.10);"
        "  border-color: rgba(255, 255, 255, 0.16);"
        "}"
    );
    connect(m_addFolderBtn, &QPushButton::clicked, this, &PlaylistDrawer::addFolderRequested);

    m_clearBtn = new QPushButton("Clear", this);
    m_clearBtn->setCursor(Qt::PointingHandCursor);
    m_clearBtn->setStyleSheet(
        "QPushButton {"
        "  background: rgba(239, 68, 68, 0.06);"
        "  color: #f87171;"
        "  border: 1px solid rgba(239, 68, 68, 0.12);"
        "  border-radius: 10px;"
        "  font-weight: 600;"
        "  font-size: 12px;"
        "  padding: 7px 14px;"
        "}"
        "QPushButton:hover {"
        "  background: rgba(239, 68, 68, 0.15);"
        "  color: #FFFFFF;"
        "  border-color: rgba(239, 68, 68, 0.25);"
        "}"
    );
    connect(m_clearBtn, &QPushButton::clicked, this, &PlaylistDrawer::clearRequested);

    actionRow->addWidget(m_addFilesBtn);
    actionRow->addWidget(m_addFolderBtn);
    actionRow->addWidget(m_clearBtn);
    layout->addLayout(actionRow);
}

void PlaylistDrawer::loadRemoteThumbnail(const QString &url, QLabel *targetLabel) {
    if (url.isEmpty() || !targetLabel) return;

    QString cleanUrl = url.trimmed();
    if (cleanUrl.startsWith("local-file:///")) {
        cleanUrl = cleanUrl.mid(14);
    } else if (cleanUrl.startsWith("file:///")) {
        cleanUrl = cleanUrl.mid(8);
    } else if (cleanUrl.startsWith("local-file://")) {
        cleanUrl = cleanUrl.mid(13);
    }

    // Check if it's already a local file path
    if (QFile::exists(cleanUrl)) {
        QPixmap localPm(cleanUrl);
        if (!localPm.isNull()) {
            targetLabel->setText("");
            targetLabel->setPixmap(localPm.scaled(76, 44, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
            return;
        }
    }

    // Check in-memory cache
    if (s_thumbCache.contains(cleanUrl)) {
        targetLabel->setText("");
        targetLabel->setPixmap(s_thumbCache[cleanUrl].scaled(76, 44, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
        return;
    }

    // Check disk cache
    QString cacheDir = QStandardPaths::writableLocation(QStandardPaths::CacheLocation) + "/meem_thumbs";
    QString hashName = QString::fromUtf8(QCryptographicHash::hash(cleanUrl.toUtf8(), QCryptographicHash::Md5).toHex()) + ".jpg";
    QString diskPath = cacheDir + "/" + hashName;
    if (QFile::exists(diskPath)) {
        QPixmap diskPm(diskPath);
        if (!diskPm.isNull()) {
            s_thumbCache[cleanUrl] = diskPm;
            targetLabel->setText("");
            targetLabel->setPixmap(diskPm.scaled(76, 44, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
            return;
        }
    }

    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
        return;
    }

    QNetworkRequest req((QUrl(cleanUrl)));
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    req.setHeader(QNetworkRequest::UserAgentHeader, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    req.setRawHeader("Accept", "image/jpeg,image/png,image/webp,image/*;q=0.8");

    QPointer<QLabel> safeLabel(targetLabel);
    QNetworkReply *reply = m_netMgr->get(req);
    connect(reply, &QNetworkReply::finished, this, [reply, cleanUrl, safeLabel, cacheDir, diskPath]() {
        if (reply->error() == QNetworkReply::NoError) {
            QByteArray data = reply->readAll();
            QPixmap pm;
            if (pm.loadFromData(data)) {
                s_thumbCache[cleanUrl] = pm;

                QDir().mkpath(cacheDir);
                QFile f(diskPath);
                if (f.open(QIODevice::WriteOnly)) {
                    f.write(data);
                    f.close();
                }

                if (safeLabel) {
                    safeLabel->setText("");
                    safeLabel->setPixmap(pm.scaled(76, 44, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
                }
            }
        }
        reply->deleteLater();
    });
}

void PlaylistDrawer::refreshList() {
    m_listWidget->clear();
    const auto &items = m_playlistMgr->getItems();
    int currentIdx = m_playlistMgr->getCurrentIndex();
    QListWidgetItem *currentListItem = nullptr;

    for (int i = 0; i < items.size(); ++i) {
        const PlaylistItem &item = items[i];
        bool isCurrent = (i == currentIdx);

        QString epTitle = item.title;
        QString epNumBadge;
        if (item.season > 0 && item.episode > 0) {
            epNumBadge = QString("S%1:E%2").arg(item.season, 2, 10, QChar('0')).arg(item.episode, 2, 10, QChar('0'));
        } else if (item.episode > 0) {
            epNumBadge = QString("EP %1").arg(item.episode);
        } else {
            epNumBadge = QString::number(i + 1);
        }

        QWidget *widget = new QWidget(m_listWidget);
        if (isCurrent) {
            widget->setStyleSheet("QWidget { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 10px; }");
        } else {
            widget->setStyleSheet("QWidget { background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.04); border-radius: 10px; } QWidget:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.10); }");
        }

        QHBoxLayout *rowLayout = new QHBoxLayout(widget);
        rowLayout->setContentsMargins(8, 6, 8, 6);
        rowLayout->setSpacing(10);

        QLabel *indexLabel = new QLabel(widget);
        indexLabel->setFixedWidth(24);
        indexLabel->setAlignment(Qt::AlignCenter);
        if (isCurrent) {
            indexLabel->setText("▶");
            indexLabel->setStyleSheet("font-size: 11px; font-weight: 800; color: #FFFFFF; background: transparent;");
        } else {
            indexLabel->setText(item.episode > 0 ? QString::number(item.episode) : QString::number(i + 1));
            indexLabel->setStyleSheet("font-size: 11px; font-weight: 600; color: rgba(255,255,255,140); background: transparent;");
        }

        // 16:9 Thumbnail Image Card
        QLabel *thumbLabel = new QLabel(widget);
        thumbLabel->setFixedSize(76, 44);
        thumbLabel->setScaledContents(true);
        thumbLabel->setAlignment(Qt::AlignCenter);
        thumbLabel->setStyleSheet(isCurrent
            ? "background: #14141c; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.14);"
            : "background: #101014; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);");

        QString thumbPath = item.thumbnail.trimmed();
        if (thumbPath.startsWith("local-file:///")) thumbPath = thumbPath.mid(14);
        else if (thumbPath.startsWith("file:///")) thumbPath = thumbPath.mid(8);
        else if (thumbPath.startsWith("local-file://")) thumbPath = thumbPath.mid(13);

        if (!thumbPath.isEmpty()) {
            if (thumbPath.startsWith("http://") || thumbPath.startsWith("https://")) {
                loadRemoteThumbnail(thumbPath, thumbLabel);
            } else if (QFile::exists(thumbPath)) {
                QPixmap localPm(thumbPath);
                if (!localPm.isNull()) {
                    thumbLabel->setPixmap(localPm.scaled(76, 44, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
                } else {
                    thumbLabel->setText(item.episode > 0 ? QString("E%1").arg(item.episode) : "▶");
                }
            } else {
                thumbLabel->setText(item.episode > 0 ? QString("E%1").arg(item.episode) : "▶");
            }
        } else {
            thumbLabel->setText(item.episode > 0 ? QString("E%1").arg(item.episode) : "▶");
            thumbLabel->setStyleSheet(isCurrent
                ? "background: rgba(255,255,255,0.08); color: #FFFFFF; font-size: 11px; font-weight: 800; border-radius: 8px; border: 1px solid rgba(255,255,255,0.14);"
                : "background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.5); font-size: 11px; font-weight: 700; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);");
        }

        QVBoxLayout *textLayout = new QVBoxLayout();
        textLayout->setSpacing(2);
        textLayout->setContentsMargins(0, 0, 0, 0);

        QHBoxLayout *titleRow = new QHBoxLayout();
        titleRow->setContentsMargins(0, 0, 0, 0);
        titleRow->setSpacing(6);

        QLabel *titleLabel = new QLabel(epTitle, widget);
        titleLabel->setTextFormat(Qt::PlainText);
        titleLabel->setStyleSheet(isCurrent
            ? "font-size: 12px; font-weight: 700; color: #FFFFFF; background: transparent;"
            : "font-size: 12px; font-weight: 500; color: rgba(255, 255, 255, 0.88); background: transparent;");
        titleRow->addWidget(titleLabel, 1);

        if (isCurrent) {
            QLabel *playingBadge = new QLabel("NOW PLAYING", widget);
            playingBadge->setStyleSheet("background: #FFFFFF; color: #000000; font-size: 8px; font-weight: 800; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px;");
            titleRow->addWidget(playingBadge);
        }
        textLayout->addLayout(titleRow);

        QString subText;
        if (item.season > 0 && item.episode > 0) {
            subText = !item.showTitle.isEmpty()
                ? QString("%1 • %2").arg(epNumBadge).arg(item.showTitle)
                : epNumBadge;
        } else if (item.episode > 0) {
            subText = !item.showTitle.isEmpty()
                ? QString("%1 • %2").arg(epNumBadge).arg(item.showTitle)
                : epNumBadge;
        } else if (!item.showTitle.isEmpty()) {
            subText = item.showTitle;
        } else {
            subText = "";
        }

        if (!subText.isEmpty()) {
            QLabel *subLabel = new QLabel(subText, widget);
            subLabel->setTextFormat(Qt::PlainText);
            subLabel->setStyleSheet(isCurrent
                ? "font-size: 10px; font-weight: 600; color: rgba(255, 255, 255, 0.7); background: transparent;"
                : "font-size: 10px; font-weight: 500; color: rgba(200, 200, 215, 0.6); background: transparent;");
            textLayout->addWidget(subLabel);
        }

        rowLayout->addWidget(indexLabel);
        rowLayout->addWidget(thumbLabel);
        rowLayout->addLayout(textLayout, 1);

        QListWidgetItem *listItem = new QListWidgetItem(m_listWidget);
        listItem->setSizeHint(QSize(300, 58));
        listItem->setData(Qt::UserRole, i);
        listItem->setData(Qt::UserRole + 1, epTitle + " " + item.showTitle);

        m_listWidget->addItem(listItem);
        m_listWidget->setItemWidget(listItem, widget);

        if (isCurrent) {
            listItem->setSelected(true);
            currentListItem = listItem;
        }
    }

    if (currentListItem) {
        m_listWidget->scrollToItem(currentListItem, QAbstractItemView::PositionAtCenter);
    }

    m_countLabel->setText(QString("(%1 items)").arg(items.size()));
}

void PlaylistDrawer::filterList(const QString &text) {
    for (int i = 0; i < m_listWidget->count(); ++i) {
        QListWidgetItem *item = m_listWidget->item(i);
        QString searchText = item->data(Qt::UserRole + 1).toString();
        bool match = searchText.contains(text, Qt::CaseInsensitive);
        item->setHidden(!match);
    }
}
