#ifndef PLAYLISTMANAGER_H
#define PLAYLISTMANAGER_H

#include <QObject>
#include <QVector>
#include <QJsonObject>
#include <QJsonArray>
#include "PlaylistItem.h"

class PlaylistManager : public QObject {
    Q_OBJECT

public:
    enum RepeatMode {
        REPEAT_OFF = 0,
        REPEAT_ONE = 1,
        REPEAT_ALL = 2
    };

    explicit PlaylistManager(const QString &configPath = "config.json", QObject *parent = nullptr);

    void addItem(const QString &pathOrUrl);
    void addCustomItem(const QString &path, const QString &title = "", int season = 1, int episode = 1,
                       const QString &thumbnail = "", const QString &showTitle = "");
    void addDirectory(const QString &dirPath);
    bool loadFromJson(const QString &jsonPathOrContent);
    void removeItem(int index);
    void clear();

    PlaylistItem *setCurrentIndex(int index);
    PlaylistItem *getCurrentItem();
    PlaylistItem *getNextItem();
    PlaylistItem *getPreviousItem();

    bool toggleShuffle();
    int cycleRepeatMode();

    bool isShuffleEnabled() const { return m_shuffleEnabled; }
    int getRepeatMode() const { return m_repeatMode; }
    int getCurrentIndex() const { return m_currentIndex; }
    const QVector<PlaylistItem> &getItems() const { return m_items; }
    PlaylistItem *getItem(int index) {
        if (index >= 0 && index < m_items.size()) return &m_items[index];
        return nullptr;
    }
    void notifyUpdated() { emit playlistUpdated(); }

    int getVolume() const { return m_volume; }
    void setVolume(int v) { m_volume = qBound(0, v, 100); saveConfig(); }

    void updatePosition(qint64 posMs, qint64 durationMs);
    void saveConfig();
    void loadConfig();

signals:
    void playlistUpdated();
    void currentIndexChanged(int index, const PlaylistItem &item);

private:
    QString m_configPath;
    QVector<PlaylistItem> m_items;
    int m_currentIndex = -1;
    bool m_shuffleEnabled = false;
    int m_repeatMode = REPEAT_OFF;
    int m_volume = 80;
    QJsonArray m_history;

    void addToHistory(const PlaylistItem &item);
};

#endif // PLAYLISTMANAGER_H
