#ifndef PLAYLISTDRAWER_H
#define PLAYLISTDRAWER_H

#include <QFrame>
#include <QListWidget>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QMap>
#include <QPixmap>
#include "../core/PlaylistManager.h"

class PlaylistDrawer : public QFrame {
    Q_OBJECT

public:
    explicit PlaylistDrawer(PlaylistManager *playlistMgr, QWidget *parent = nullptr);

    void refreshList();
    void setIconsBasePath(const QString &basePath);

signals:
    void itemSelected(int index);
    void addFilesRequested();
    void addFolderRequested();
    void clearRequested();

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void showEvent(QShowEvent *event) override;
    bool nativeEvent(const QByteArray &eventType, void *message, qintptr *result) override;

private:
    QPoint m_dragPos;
    PlaylistManager *m_playlistMgr = nullptr;
    QLineEdit *m_searchEdit = nullptr;
    QListWidget *m_listWidget = nullptr;
    QLabel *m_countLabel = nullptr;
    QString m_iconsPath;

    QLabel *m_titleIconLabel = nullptr;
    QPushButton *m_closeBtn = nullptr;
    QPushButton *m_addFilesBtn = nullptr;
    QPushButton *m_addFolderBtn = nullptr;
    QPushButton *m_clearBtn = nullptr;

    void applyIcons();

    QNetworkAccessManager *m_netMgr = nullptr;
    static inline QMap<QString, QPixmap> s_thumbCache;

    void initUi();
    void filterList(const QString &text);
    void loadRemoteThumbnail(const QString &url, QLabel *targetLabel);
};

#endif // PLAYLISTDRAWER_H
