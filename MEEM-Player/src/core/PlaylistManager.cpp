#include "PlaylistManager.h"
#include <QFile>
#include <QDir>
#include <QDirIterator>
#include <QJsonDocument>
#include <QRandomGenerator>
#include <QDebug>

static const QStringList SUPPORTED_EXTENSIONS = {
    "mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "ts", "m2ts",
    "3gp", "m4v", "mpg", "mpeg", "vob", "ogv",
    "mp3", "flac", "wav", "aac", "ogg", "m4a", "opus", "wma", "ac3", "dts"
};

PlaylistManager::PlaylistManager(const QString &configPath, QObject *parent)
    : QObject(parent), m_configPath(configPath)
{
    loadConfig();
}

void PlaylistManager::addItem(const QString &pathOrUrl) {
    if (pathOrUrl.isEmpty()) return;
    m_items.append(PlaylistItem(pathOrUrl));
    emit playlistUpdated();
}

void PlaylistManager::addCustomItem(const QString &path, const QString &title, int season, int episode,
                                    const QString &thumbnail, const QString &showTitle) {
    if (path.isEmpty()) return;
    m_items.append(PlaylistItem(path, title, season, episode, thumbnail, showTitle));
    emit playlistUpdated();
}

void PlaylistManager::addDirectory(const QString &dirPath) {
    QDir dir(dirPath);
    if (!dir.exists()) return;

    QDirIterator it(dirPath, QDir::Files, QDirIterator::Subdirectories);
    int added = 0;
    while (it.hasNext()) {
        QString file = it.next();
        QFileInfo fi(file);
        if (SUPPORTED_EXTENSIONS.contains(fi.suffix().toLower())) {
            m_items.append(PlaylistItem(file));
            added++;
        }
    }
    if (added > 0) {
        emit playlistUpdated();
    }
}

bool PlaylistManager::loadFromJson(const QString &jsonPathOrContent) {
    QByteArray data;
    QFile file(jsonPathOrContent);
    if (file.exists() && file.open(QIODevice::ReadOnly)) {
        data = file.readAll();
        file.close();
    } else {
        data = jsonPathOrContent.toUtf8();
    }

    QJsonDocument doc = QJsonDocument::fromJson(data);
    if (!doc.isArray()) return false;

    m_items.clear();
    QJsonArray arr = doc.array();
    for (const QJsonValue &val : arr) {
        if (val.isObject()) {
            m_items.append(PlaylistItem::fromJsonObject(val.toObject()));
        }
    }
    emit playlistUpdated();
    return !m_items.isEmpty();
}

void PlaylistManager::removeItem(int index) {
    if (index >= 0 && index < m_items.size()) {
        m_items.removeAt(index);
        if (m_currentIndex >= m_items.size()) {
            m_currentIndex = m_items.size() - 1;
        }
        emit playlistUpdated();
    }
}

void PlaylistManager::clear() {
    m_items.clear();
    m_currentIndex = -1;
    emit playlistUpdated();
}

PlaylistItem *PlaylistManager::setCurrentIndex(int index) {
    if (index >= 0 && index < m_items.size()) {
        m_currentIndex = index;
        addToHistory(m_items[m_currentIndex]);
        emit currentIndexChanged(m_currentIndex, m_items[m_currentIndex]);
        return &m_items[m_currentIndex];
    }
    return nullptr;
}

PlaylistItem *PlaylistManager::getCurrentItem() {
    if (m_currentIndex >= 0 && m_currentIndex < m_items.size()) {
        return &m_items[m_currentIndex];
    }
    return nullptr;
}

PlaylistItem *PlaylistManager::getNextItem() {
    if (m_items.isEmpty()) return nullptr;

    if (m_repeatMode == REPEAT_ONE && m_currentIndex != -1) {
        return &m_items[m_currentIndex];
    }

    if (m_shuffleEnabled) {
        int nextIdx = QRandomGenerator::global()->bounded(m_items.size());
        return setCurrentIndex(nextIdx);
    }

    int nextIdx = m_currentIndex + 1;
    if (nextIdx >= m_items.size()) {
        if (m_repeatMode == REPEAT_ALL) {
            nextIdx = 0;
        } else {
            return nullptr;
        }
    }
    return setCurrentIndex(nextIdx);
}

PlaylistItem *PlaylistManager::getPreviousItem() {
    if (m_items.isEmpty()) return nullptr;

    if (m_shuffleEnabled) {
        int prevIdx = QRandomGenerator::global()->bounded(m_items.size());
        return setCurrentIndex(prevIdx);
    }

    int prevIdx = m_currentIndex - 1;
    if (prevIdx < 0) {
        if (m_repeatMode == REPEAT_ALL) {
            prevIdx = m_items.size() - 1;
        } else {
            prevIdx = 0;
        }
    }
    return setCurrentIndex(prevIdx);
}

bool PlaylistManager::toggleShuffle() {
    m_shuffleEnabled = !m_shuffleEnabled;
    return m_shuffleEnabled;
}

int PlaylistManager::cycleRepeatMode() {
    m_repeatMode = (m_repeatMode + 1) % 3;
    return m_repeatMode;
}

void PlaylistManager::updatePosition(qint64 posMs, qint64 durationMs) {
    PlaylistItem *item = getCurrentItem();
    if (item) {
        item->lastPositionMs = posMs;
        if (durationMs > 0) {
            item->durationMs = durationMs;
        }
    }
}

void PlaylistManager::saveConfig() {
    QJsonObject obj;
    obj["history"] = m_history;
    obj["repeat_mode"] = m_repeatMode;
    obj["shuffle_enabled"] = m_shuffleEnabled;
    obj["volume"] = m_volume;

    QJsonDocument doc(obj);
    QFile file(m_configPath);
    if (file.open(QIODevice::WriteOnly)) {
        file.write(doc.toJson());
        file.close();
    }
}

void PlaylistManager::loadConfig() {
    QFile file(m_configPath);
    if (file.open(QIODevice::ReadOnly)) {
        QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
        file.close();
        if (doc.isObject()) {
            QJsonObject obj = doc.object();
            m_history = obj["history"].toArray();
            m_repeatMode = obj.value("repeat_mode").toInt(REPEAT_OFF);
            m_shuffleEnabled = obj.value("shuffle_enabled").toBool(false);
            m_volume = obj.value("volume").toInt(80);
        }
    }
}

void PlaylistManager::addToHistory(const PlaylistItem &item) {
    QJsonObject itemObj = item.toJsonObject();
    for (int i = 0; i < m_history.size(); ++i) {
        if (m_history[i].toObject()["path"].toString() == item.path) {
            m_history.removeAt(i);
            break;
        }
    }
    m_history.prepend(itemObj);
    while (m_history.size() > 30) {
        m_history.removeLast();
    }
    saveConfig();
}
