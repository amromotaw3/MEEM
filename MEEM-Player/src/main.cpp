#include <QApplication>
#include <QFontDatabase>
#include <QFont>
#include <QIcon>
#include <QFileInfo>
#include <QDir>
#include <QTimer>
#include <QDebug>
#include <QRegularExpression>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>

#ifdef Q_OS_WIN
#include <windows.h>
#include <shellapi.h>
#endif

#include "ui/MainWindow.h"
#include "ui/styles.h"

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("MEEM Player");
    app.setOrganizationName("MEEM");
    app.setStyleSheet(BLACK_WHITE_STYLESHEET);

    // Icon setup
    QString iconPath = QCoreApplication::applicationDirPath() + "/assets/ico.png";
    if (QFile::exists(iconPath)) {
        app.setWindowIcon(QIcon(iconPath));
    }

    // Custom Font setup with robust Arabic fallback
    QFont appFont("Segoe UI", 10);
    QString fontPath = QCoreApplication::applicationDirPath() + "/assets/fonts/Comfortaa.ttf";
    if (QFile::exists(fontPath)) {
        int fontId = QFontDatabase::addApplicationFont(fontPath);
        QStringList fontFamilies = QFontDatabase::applicationFontFamilies(fontId);
        if (!fontFamilies.isEmpty()) {
            appFont = QFont(fontFamilies.first(), 10);
            appFont.setFamilies(QStringList() << fontFamilies.first() << "Segoe UI" << "Cairo" << "Tahoma" << "Arial");
        }
    } else {
        appFont.setFamilies(QStringList() << "Segoe UI" << "Cairo" << "Tahoma" << "Arial");
    }
    app.setFont(appFont);

    // Parse CLI arguments with true Unicode preservation on Windows
    QStringList mediaItems;
    QString playlistJsonPath;
    QString metaJsonPath;
    int playlistIndex = 0;
    QString title;
    QString subtitle;
    QString posterPath;
    float startTimeSec = 0.0f;
    QString subPath;
    QString audioPath;
    bool fullscreen = false;
    QString pbKey;
    QString profileId;
    QString syncFile;
    int syncPort = 0;
    QString videoId;
    QString ytQuality = "1080";
    QString tmdbId;
    QString imdbId;
    QString mediaType = "tv";
    int season = 0;
    int episode = 0;
    QString tmdbKey = "";
    QString subdlKey;

    QStringList args;
#ifdef Q_OS_WIN
    int argcW = 0;
    LPWSTR *argvW = CommandLineToArgvW(GetCommandLineW(), &argcW);
    if (argvW) {
        for (int i = 0; i < argcW; ++i) {
            args.append(QString::fromWCharArray(argvW[i]));
        }
        LocalFree(argvW);
    } else {
        args = app.arguments();
    }
#else
    args = app.arguments();
#endif

    for (int i = 1; i < args.size(); ++i) {
        const QString &arg = args[i];
        if (arg.startsWith("--title=")) {
            title = arg.mid(8).trimmed();
        } else if (arg.startsWith("--meta-title=")) {
            title = arg.mid(13).trimmed();
        } else if (arg.startsWith("--subtitle=") || arg.startsWith("--meta-subtitle=")) {
            subtitle = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--poster=") || arg.startsWith("--thumbnail=")) {
            posterPath = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--start-time=")) {
            startTimeSec = arg.mid(arg.indexOf('=') + 1).toFloat();
        } else if (arg.startsWith("--sub=") || arg.startsWith("--sub-file=")) {
            subPath = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--audio=") || arg.startsWith("--audio-url=")) {
            audioPath = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--playlist=")) {
            playlistJsonPath = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--meta-json=")) {
            metaJsonPath = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--playlist-index=")) {
            playlistIndex = arg.mid(arg.indexOf('=') + 1).toInt();
        } else if (arg.startsWith("--pb-key=")) {
            pbKey = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--profile-id=")) {
            profileId = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--sync-file=")) {
            syncFile = arg.mid(arg.indexOf('=') + 1).trimmed();
        } else if (arg.startsWith("--sync-port=")) {
            syncPort = arg.mid(arg.indexOf('=') + 1).toInt();
        } else if (arg.startsWith("--video-id=")) {
            videoId = arg.mid(11).trimmed();
        } else if (arg.startsWith("--yt-quality=")) {
            ytQuality = arg.mid(13).trimmed();
        } else if (arg.startsWith("--tmdb-id=")) {
            tmdbId = arg.mid(10).trimmed();
        } else if (arg.startsWith("--imdb-id=")) {
            imdbId = arg.mid(10).trimmed();
        } else if (arg.startsWith("--media-type=")) {
            mediaType = arg.mid(13).trimmed();
        } else if (arg.startsWith("--season=")) {
            season = arg.mid(9).toInt();
        } else if (arg.startsWith("--episode=")) {
            episode = arg.mid(10).toInt();
        } else if (arg.startsWith("--tmdb-key=")) {
            tmdbKey = arg.mid(11).trimmed();
        } else if (arg.startsWith("--subdl-key=")) {
            subdlKey = arg.mid(12).trimmed();
        } else if (arg == "--fullscreen" || arg == "-f") {
            fullscreen = true;
        } else if (!arg.startsWith("--")) {
            if (!arg.isEmpty()) mediaItems.append(arg);
        }
    }

    // If a UTF-8 metadata JSON was provided, load rich metadata without CLI encoding limits
    if (!metaJsonPath.isEmpty() && QFile::exists(metaJsonPath)) {
        QFile metaFile(metaJsonPath);
        if (metaFile.open(QIODevice::ReadOnly)) {
            QJsonDocument doc = QJsonDocument::fromJson(metaFile.readAll());
            if (doc.isObject()) {
                QJsonObject obj = doc.object();
                if (title.isEmpty() && obj.contains("title")) title = obj["title"].toString();
                if (subtitle.isEmpty() && obj.contains("subtitle")) subtitle = obj["subtitle"].toString();
                if (posterPath.isEmpty() && obj.contains("poster")) posterPath = obj["poster"].toString();
                if (subPath.isEmpty() && obj.contains("sub")) subPath = obj["sub"].toString();
                if (audioPath.isEmpty() && obj.contains("audio")) audioPath = obj["audio"].toString();
                if (startTimeSec <= 0.0f && obj.contains("startTime")) startTimeSec = obj["startTime"].toDouble();
                if (pbKey.isEmpty() && obj.contains("pbKey")) pbKey = obj["pbKey"].toString();
                if (profileId.isEmpty() && obj.contains("profileId")) profileId = obj["profileId"].toString();
                if (videoId.isEmpty() && obj.contains("videoId")) videoId = obj["videoId"].toString();
                if (obj.contains("ytQuality")) ytQuality = obj["ytQuality"].toString();
                if (tmdbId.isEmpty() && obj.contains("tmdbId")) tmdbId = obj["tmdbId"].toString();
                if (imdbId.isEmpty() && obj.contains("imdbId")) imdbId = obj["imdbId"].toString();
                if (obj.contains("mediaType")) mediaType = obj["mediaType"].toString();
                if (season <= 0 && obj.contains("season")) season = obj["season"].toInt();
                if (episode <= 0 && obj.contains("episode")) episode = obj["episode"].toInt();
                if (obj.contains("tmdbApiKey")) tmdbKey = obj["tmdbApiKey"].toString();
                if (subdlKey.isEmpty() && obj.contains("subdlApiKey")) subdlKey = obj["subdlApiKey"].toString();
                if (syncPort <= 0 && obj.contains("syncPort")) syncPort = obj["syncPort"].toInt();
                if (mediaItems.isEmpty() && obj.contains("path")) {
                    QString p = obj["path"].toString();
                    if (!p.isEmpty()) mediaItems.append(p);
                }
            }
            metaFile.close();
        }
    }

    if (videoId.isEmpty() && !mediaItems.isEmpty()) {
        for (const QString &item : mediaItems) {
            static QRegularExpression ytRe("(?:youtube\\.com\\/(?:watch\\?v=|embed\\/|shorts\\/)|youtu\\.be\\/|videoplayback.*id=)([a-zA-Z0-9_-]{11})");
            QRegularExpressionMatch m = ytRe.match(item);
            if (m.hasMatch()) {
                videoId = m.captured(1);
                break;
            }
        }
    }

    MainWindow window;
    window.setMediaIds(tmdbId, imdbId, mediaType, season, episode, tmdbKey, subdlKey);
    if (!pbKey.isEmpty()) {
        window.setupPlaybackSync(pbKey, profileId, syncFile, syncPort);
    }
    if (startTimeSec > 0.0f) {
        window.setPendingStartTime(startTimeSec);
    }
    if (!videoId.isEmpty()) {
        if (posterPath.isEmpty()) {
            posterPath = QString("https://i.ytimg.com/vi/%1/hqdefault.jpg").arg(videoId);
        }
        window.setYouTubeContext(videoId, ytQuality);
    }
    window.show();
    window.raise();
    window.activateWindow();

    if (!title.isEmpty()) window.setMediaTitle(title, subtitle);
    if (!posterPath.isEmpty()) window.setPoster(posterPath);

    if (!playlistJsonPath.isEmpty() && QFile::exists(playlistJsonPath)) {
        window.getPlaylistManager()->loadFromJson(playlistJsonPath);
        if (!window.getPlaylistManager()->getItems().isEmpty()) {
            int targetIdx = qBound(0, playlistIndex, window.getPlaylistManager()->getItems().size() - 1);
            window.playIndex(targetIdx, audioPath);
        }
    } else if (!mediaItems.isEmpty()) {
        for (const QString &item : mediaItems) {
            if (!title.isEmpty()) {
                window.getPlaylistManager()->addCustomItem(item, title, 0, 0, posterPath, subtitle);
            } else {
                window.getPlaylistManager()->addItem(item);
            }
        }
        window.playIndex(0, audioPath);
    }

    if (!subPath.isEmpty() && QFile::exists(subPath)) {
        QTimer::singleShot(800, [&window, subPath]() {
            window.getPlayerEngine()->loadExternalSubtitle(subPath);
        });
    }

    if (fullscreen) {
        QTimer::singleShot(300, [&window]() {
            window.toggleFullscreen();
        });
    }

    return app.exec();
}
