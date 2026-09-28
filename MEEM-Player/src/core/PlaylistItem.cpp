#include "PlaylistItem.h"
#include <QFileInfo>
#include <QRegularExpression>

static void parseMediaFilename(const QString &rawName, QString &outTitle, QString &outShowTitle, int &outSeason, int &outEpisode) {
    QString clean = rawName;
    clean.replace('.', ' ').replace('_', ' ').trimmed();

    // S01E02 / s01e02 / S1E2
    static QRegularExpression seRe("(?i)\\bS(\\d{1,2})[ ._-]*E(\\d{1,3})\\b");
    QRegularExpressionMatch m = seRe.match(clean);
    if (!m.hasMatch()) {
        // 1x02
        static QRegularExpression xRe("(?i)\\b(\\d{1,2})x(\\d{1,3})\\b");
        m = xRe.match(clean);
    }
    if (!m.hasMatch()) {
        // E02 / Episode 2
        static QRegularExpression epRe("(?i)\\b(?:ep|episode)[ ._-]*(\\d{1,3})\\b");
        m = epRe.match(clean);
        if (m.hasMatch()) {
            outSeason = 1;
            outEpisode = m.captured(1).toInt();
            int pos = m.capturedStart();
            if (pos > 0) {
                outShowTitle = clean.left(pos).trimmed();
            }
            outTitle = QString("Episode %1").arg(outEpisode);
            return;
        }
    }

    if (m.hasMatch()) {
        outSeason = m.captured(1).toInt();
        outEpisode = m.captured(2).toInt();
        int pos = m.capturedStart();
        if (pos > 0) {
            outShowTitle = clean.left(pos).trimmed();
        }
        int endPos = m.capturedEnd();
        QString rest = clean.mid(endPos).trimmed();
        static QRegularExpression qualRe("(?i)\\b(2160p|1080p|720p|480p|web-?dl|bluray|hdtv|x264|x265|hevc|aac|dts|remux|repack)\\b.*");
        rest.remove(qualRe);
        rest = rest.trimmed();
        if (rest.startsWith('-') || rest.startsWith('.')) rest = rest.mid(1).trimmed();
        if (!rest.isEmpty()) {
            outTitle = rest;
        } else {
            outTitle = QString("Episode %1").arg(outEpisode);
        }
    } else {
        outSeason = 0;
        outEpisode = 0;
        static QRegularExpression qualRe("(?i)\\b(2160p|1080p|720p|480p|web-?dl|bluray|hdtv|x264|x265|hevc|aac|dts|remux|repack)\\b.*");
        clean.remove(qualRe);
        outTitle = clean.trimmed();
    }
}

PlaylistItem::PlaylistItem(const QString &p_path, const QString &p_title, int p_season, int p_episode,
                           const QString &p_thumbnail, const QString &p_showTitle, const QString &p_audioUrl)
    : path(p_path),
      season(p_season),
      episode(p_episode),
      thumbnail(p_thumbnail),
      showTitle(p_showTitle),
      audioUrl(p_audioUrl)
{
    QString rawName;
    if (!p_path.isEmpty()) {
        QFileInfo fi(p_path);
        rawName = fi.completeBaseName();
        if (rawName.isEmpty()) rawName = fi.fileName();
    }

    if (season <= 0 && episode <= 0 && !rawName.isEmpty()) {
        QString parsedTitle, parsedShow;
        int s = 0, e = 0;
        parseMediaFilename(rawName, parsedTitle, parsedShow, s, e);
        if (s > 0 && e > 0) {
            season = s;
            episode = e;
            mediaType = "tv";
            if (showTitle.isEmpty()) showTitle = parsedShow;
            if (title.isEmpty()) title = parsedTitle;
        } else {
            season = 0;
            episode = 0;
            mediaType = "movie";
            if (title.isEmpty()) title = parsedTitle.isEmpty() ? rawName : parsedTitle;
        }
    } else {
        if (season > 0) mediaType = "tv";
        else mediaType = "movie";
    }

    if (!p_title.isEmpty()) {
        title = p_title;
    } else if (title.isEmpty() && !rawName.isEmpty()) {
        title = rawName;
    }
}

QJsonObject PlaylistItem::toJsonObject() const {
    QJsonObject obj;
    obj["path"] = path;
    obj["title"] = title;
    obj["season"] = season;
    obj["episode"] = episode;
    obj["thumbnail"] = thumbnail;
    obj["show_title"] = showTitle;
    obj["audio_url"] = audioUrl;
    obj["tmdb_id"] = tmdbId;
    obj["imdb_id"] = imdbId;
    obj["media_type"] = mediaType;
    obj["overview"] = overview;
    obj["sub_path"] = subPath;
    obj["duration_ms"] = durationMs;
    obj["last_position_ms"] = lastPositionMs;
    return obj;
}

PlaylistItem PlaylistItem::fromJsonObject(const QJsonObject &json) {
    QString p = json.contains("path") ? json["path"].toString() : json["url"].toString();
    QString t = json.contains("title") ? json["title"].toString() : json["name"].toString();
    int s = json.value("season").toInt(0);
    int e = json.value("episode").toInt(0);
    QString thumb = json.contains("thumbnail") ? json["thumbnail"].toString() : "";
    if (thumb.isEmpty() && json.contains("still_path")) thumb = json["still_path"].toString();
    if (thumb.isEmpty() && json.contains("still")) thumb = json["still"].toString();
    if (thumb.isEmpty() && json.contains("poster")) thumb = json["poster"].toString();
    if (thumb.isEmpty() && json.contains("poster_path")) thumb = json["poster_path"].toString();
    if (thumb.isEmpty() && json.contains("cover")) thumb = json["cover"].toString();
    if (thumb.isEmpty() && json.contains("image")) thumb = json["image"].toString();

    if (!thumb.isEmpty() && thumb.startsWith("/") && !thumb.startsWith("//")) {
        thumb = "https://image.tmdb.org/t/p/w500" + thumb;
    }

    QString showT = json.contains("show_title") ? json["show_title"].toString() : json["showTitle"].toString();
    QString audioU = json.contains("audio_url") ? json["audio_url"].toString() : json["audioUrl"].toString();

    PlaylistItem item(p, t, s, e, thumb, showT, audioU);
    item.tmdbId = json.contains("tmdb_id") ? json["tmdb_id"].toString() : json["tmdbId"].toString();
    item.imdbId = json.contains("imdb_id") ? json["imdb_id"].toString() : json["imdbId"].toString();
    item.mediaType = json.contains("media_type") ? json["media_type"].toString() : json["mediaType"].toString(s > 0 ? "tv" : "movie");
    item.overview = json.contains("overview") ? json["overview"].toString() : "";
    item.subPath = json.contains("sub_path") ? json["sub_path"].toString() : (json.contains("sub") ? json["sub"].toString() : json["subtitle"].toString());
    item.durationMs = json.value("duration_ms").toVariant().toLongLong();
    item.lastPositionMs = json.value("last_position_ms").toVariant().toLongLong();
    return item;
}
