#ifndef PLAYLISTITEM_H
#define PLAYLISTITEM_H

#include <QString>
#include <QJsonObject>

class PlaylistItem {
public:
    QString path;
    QString title;
    int season = 0;
    int episode = 0;
    QString thumbnail;
    QString showTitle;
    QString audioUrl;
    QString tmdbId;
    QString imdbId;
    QString mediaType = "tv";
    QString overview;
    QString subPath;
    qint64 durationMs = 0;
    qint64 lastPositionMs = 0;

    PlaylistItem() = default;
    PlaylistItem(const QString &p_path, const QString &p_title = "", int p_season = 0, int p_episode = 0,
                 const QString &p_thumbnail = "", const QString &p_showTitle = "", const QString &p_audioUrl = "");

    QJsonObject toJsonObject() const;
    static PlaylistItem fromJsonObject(const QJsonObject &json);
};

#endif // PLAYLISTITEM_H
