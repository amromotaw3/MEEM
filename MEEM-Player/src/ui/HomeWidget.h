#ifndef HOMEWIDGET_H
#define HOMEWIDGET_H

#include <QWidget>
#include <QPushButton>
#include <QLabel>
#include <QListWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QIcon>

class HomeWidget : public QWidget {
    Q_OBJECT

public:
    explicit HomeWidget(QWidget *parent = nullptr);

    void setRecentHistory(const QList<QPair<QString, QString>> &history);
    void setIconsBasePath(const QString &basePath);

signals:
    void openFileRequested();
    void openFolderRequested();
    void openPlaylistRequested();
    void recentItemClicked(const QString &path);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;

private:
    QLabel *m_logoLabel = nullptr;
    QLabel *m_subLabel = nullptr;

    QPushButton *m_openFileBtn = nullptr;
    QPushButton *m_openFolderBtn = nullptr;
    QPushButton *m_openPlaylistBtn = nullptr;

    QLabel *m_dropHintLabel = nullptr;
    QListWidget *m_recentListWidget = nullptr;

    QString m_iconsPath;

    void initUi();
    void applyIcons();
};

#endif // HOMEWIDGET_H
