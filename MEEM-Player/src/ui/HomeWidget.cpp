#include "HomeWidget.h"
#include <QFrame>
#include <QPainter>
#include <QMouseEvent>
#include <QApplication>
#include <QFileInfo>

HomeWidget::HomeWidget(QWidget *parent) : QWidget(parent) {
    // IMPORTANT: This widget must accept mouse events and be on top
    setMouseTracking(true);
    setAttribute(Qt::WA_TransparentForMouseEvents, false);
    setFocusPolicy(Qt::StrongFocus);
    initUi();
}

void HomeWidget::initUi() {
    // Dark semi-transparent background so it sits nicely over the black canvas
    setStyleSheet(
        "HomeWidget {"
        "  background-color: rgba(8, 8, 12, 200);"
        "}"
    );

    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setAlignment(Qt::AlignCenter);

    // ---- Card ----
    QFrame *card = new QFrame(this);
    card->setObjectName("HomeCard");
    card->setFixedWidth(640);
    card->setStyleSheet(
        "QFrame#HomeCard {"
        "  background: rgba(20, 20, 28, 210);"
        "  border: 1px solid rgba(255,255,255,22);"
        "  border-radius: 20px;"
        "}"
    );

    QVBoxLayout *cl = new QVBoxLayout(card);
    cl->setContentsMargins(44, 38, 44, 38);
    cl->setSpacing(20);
    cl->setAlignment(Qt::AlignHCenter);

    // Logo
    m_logoLabel = new QLabel("MEEM PLAYER", card);
    m_logoLabel->setStyleSheet(
        "font-size: 30px; font-weight: 700; color: #FFFFFF; letter-spacing: 3px;"
        "background: transparent; border: none;"
    );
    m_logoLabel->setAlignment(Qt::AlignCenter);

    m_subLabel = new QLabel("High-Performance Native Media Engine", card);
    m_subLabel->setStyleSheet(
        "font-size: 12px; color: rgba(200,200,210,150); letter-spacing: 0.5px;"
        "background: transparent; border: none;"
    );
    m_subLabel->setAlignment(Qt::AlignCenter);

    cl->addWidget(m_logoLabel);
    cl->addWidget(m_subLabel);
    cl->addSpacing(8);

    // Divider
    QFrame *divider = new QFrame(card);
    divider->setFixedHeight(1);
    divider->setStyleSheet("background: rgba(255,255,255,18); border: none;");
    cl->addWidget(divider);
    cl->addSpacing(4);

    // ---- Primary Action Buttons ----
    // Helper lambda to build action button
    auto makeActionBtn = [&](const QString &text, bool isPrimary) -> QPushButton* {
        QPushButton *btn = new QPushButton(text, card);
        btn->setCursor(Qt::PointingHandCursor);
        btn->setIconSize(QSize(20, 20));
        btn->setMinimumHeight(44);
        if (isPrimary) {
            btn->setStyleSheet(
                "QPushButton {"
                "  background-color: #FFFFFF;"
                "  color: #0A0A0C;"
                "  font-weight: 700;"
                "  font-size: 13px;"
                "  padding: 10px 22px;"
                "  border-radius: 10px;"
                "  border: none;"
                "  text-align: left;"
                "}"
                "QPushButton:hover { background-color: #E8E8F0; }"
                "QPushButton:pressed { background-color: #D0D0DC; }"
            );
        } else {
            btn->setStyleSheet(
                "QPushButton {"
                "  background-color: rgba(255,255,255,14);"
                "  color: #FFFFFF;"
                "  font-weight: 500;"
                "  font-size: 13px;"
                "  padding: 10px 22px;"
                "  border-radius: 10px;"
                "  border: 1px solid rgba(255,255,255,28);"
                "  text-align: left;"
                "}"
                "QPushButton:hover { background-color: rgba(255,255,255,28); border-color: rgba(255,255,255,55); }"
                "QPushButton:pressed { background-color: rgba(255,255,255,40); }"
            );
        }
        return btn;
    };

    m_openFileBtn    = makeActionBtn("   Open Video / Audio File", true);
    m_openFolderBtn  = makeActionBtn("   Open Folder", false);
    m_openPlaylistBtn = makeActionBtn("   Open Playlist  (.json)", false);

    QHBoxLayout *btnRow = new QHBoxLayout();
    btnRow->setSpacing(10);
    btnRow->addWidget(m_openFileBtn, 2);
    btnRow->addWidget(m_openFolderBtn, 1);
    btnRow->addWidget(m_openPlaylistBtn, 1);
    cl->addLayout(btnRow);

    // Connect button signals
    connect(m_openFileBtn,    &QPushButton::clicked, this, &HomeWidget::openFileRequested);
    connect(m_openFolderBtn,  &QPushButton::clicked, this, &HomeWidget::openFolderRequested);
    connect(m_openPlaylistBtn,&QPushButton::clicked, this, &HomeWidget::openPlaylistRequested);

    // ---- Drop zone hint ----
    QFrame *dropBox = new QFrame(card);
    dropBox->setStyleSheet(
        "QFrame {"
        "  border: 1px dashed rgba(255,255,255,25);"
        "  border-radius: 12px;"
        "  background: rgba(255,255,255,4);"
        "}"
    );
    QVBoxLayout *dropLayout = new QVBoxLayout(dropBox);
    dropLayout->setContentsMargins(14, 14, 14, 14);

    m_dropHintLabel = new QLabel("Drag and drop media files or subtitle (.srt) anywhere", dropBox);
    m_dropHintLabel->setStyleSheet(
        "font-size: 11px; color: rgba(190,190,200,120);"
        "background: transparent; border: none;"
    );
    m_dropHintLabel->setAlignment(Qt::AlignCenter);
    dropLayout->addWidget(m_dropHintLabel);
    cl->addWidget(dropBox);

    // ---- Recent Files ----
    m_recentListWidget = new QListWidget(card);
    m_recentListWidget->setMaximumHeight(130);
    m_recentListWidget->setStyleSheet(
        "QListWidget { background: transparent; border: none; outline: none; }"
        "QListWidget::item {"
        "  color: rgba(210,210,220,220);"
        "  padding: 7px 12px;"
        "  border-radius: 8px;"
        "  font-size: 12px;"
        "}"
        "QListWidget::item:hover { background: rgba(255,255,255,18); color: #FFFFFF; }"
        "QListWidget::item:selected { background: rgba(255,255,255,30); color: #FFFFFF; font-weight: bold; }"
    );
    m_recentListWidget->hide();
    connect(m_recentListWidget, &QListWidget::itemClicked, this, [this](QListWidgetItem *item) {
        emit recentItemClicked(item->data(Qt::UserRole).toString());
    });
    cl->addWidget(m_recentListWidget);

    mainLayout->addWidget(card);
}

void HomeWidget::setIconsBasePath(const QString &basePath) {
    m_iconsPath = basePath;
    applyIcons();
}

void HomeWidget::applyIcons() {
    if (m_iconsPath.isEmpty()) return;

    auto loadIcon = [&](const QString &name) -> QIcon {
        QString path = m_iconsPath + "/" + name;
        if (QFileInfo::exists(path)) return QIcon(path);
        return QIcon();
    };

    QIcon iconFile    = loadIcon("open_file.svg");
    QIcon iconFolder  = loadIcon("home.svg");    // use home as folder placeholder
    QIcon iconPlaylist = loadIcon("playlist.svg");

    if (!iconFile.isNull())    m_openFileBtn->setIcon(iconFile);
    if (!iconFolder.isNull())  m_openFolderBtn->setIcon(iconFolder);
    if (!iconPlaylist.isNull()) m_openPlaylistBtn->setIcon(iconPlaylist);

    m_openFileBtn->setIconSize(QSize(18, 18));
    m_openFolderBtn->setIconSize(QSize(18, 18));
    m_openPlaylistBtn->setIconSize(QSize(18, 18));
}

void HomeWidget::setRecentHistory(const QList<QPair<QString, QString>> &history) {
    m_recentListWidget->clear();
    if (history.isEmpty()) {
        m_recentListWidget->hide();
        return;
    }
    for (const auto &entry : history) {
        QListWidgetItem *item = new QListWidgetItem(entry.first, m_recentListWidget);
        item->setData(Qt::UserRole, entry.second);
    }
    m_recentListWidget->show();
}

void HomeWidget::paintEvent(QPaintEvent *event) {
    // Draw the semi-transparent background manually for proper compositing
    QPainter p(this);
    p.fillRect(rect(), QColor(8, 8, 12, 200));
    QWidget::paintEvent(event);
}

void HomeWidget::mouseReleaseEvent(QMouseEvent *event) {
    // Accept all mouse events so clicks don't pass through to video canvas
    event->accept();
}
