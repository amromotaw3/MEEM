#ifndef SETTINGSDRAWER_H
#define SETTINGSDRAWER_H

#include <QFrame>
#include <QComboBox>
#include <QPushButton>
#include <QLabel>
#include <QLineEdit>
#include <QSlider>
#include <QStackedWidget>
#include "../core/PlayerEngine.h"

class SettingsDrawer : public QFrame {
    Q_OBJECT

public:
    explicit SettingsDrawer(PlayerEngine *engine, QWidget *parent = nullptr);

    void refreshTracks();
    void refreshProfileSubtitles();
    void setIconsBasePath(const QString &basePath);
    void setAvailableQualities(const QStringList &qualities, const QString &currentQuality);
    void setCurrentQuality(const QString &quality);
    void setQualityVisible(bool visible);
    void setMediaContext(const QString &imdbId, const QString &tmdbId, const QString &showTitle, int season, int episode, const QString &subdlApiKey, int syncPort);
    void searchSubdlSubtitles(const QString &queryOverride = "");
    void downloadSubdlSubtitle(const QString &url, const QString &label);
    void switchToTab(int index);
    void updateActiveSubtitleIndicator();

signals:
    void loadSubtitleRequested();
    void qualitySelected(const QString &quality);
    void toggleNerdStatsRequested();

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void showEvent(QShowEvent *event) override;
    bool nativeEvent(const QByteArray &eventType, void *message, qintptr *result) override;

private:
    QPoint m_dragPos;
    PlayerEngine *m_engine = nullptr;
    QString m_iconsPath;

    QLabel *m_titleIconLabel = nullptr;
    QPushButton *m_closeBtn = nullptr;
    QList<QPair<QLabel*, QString>> m_sectionIconLabels;

    // Tab System
    QStackedWidget *m_tabStack = nullptr;
    QPushButton *m_tabSubBtn = nullptr;
    QPushButton *m_tabAudioBtn = nullptr;
    QPushButton *m_tabVideoBtn = nullptr;

    // Active Subtitle Status Card
    QWidget *m_activeSubCard = nullptr;
    QLabel *m_activeSubBadge = nullptr;
    QLabel *m_activeSubTitle = nullptr;
    QString m_currentActiveSubdlName;

    QWidget *m_qualityRowWidget = nullptr;
    QComboBox *m_qualityCombo = nullptr;
    QComboBox *m_audioCombo = nullptr;
    QComboBox *m_subCombo = nullptr;
    QComboBox *m_subDelayCombo = nullptr;
    QComboBox *m_audioDelayCombo = nullptr;
    QComboBox *m_profileCombo = nullptr;
    QComboBox *m_showCombo = nullptr;
    QComboBox *m_profileSubCombo = nullptr;
    QComboBox *m_speedCombo = nullptr;
    QComboBox *m_aspectCombo = nullptr;

    // SubDL Online Subtitles Controls
    QLineEdit *m_subdlSearchEdit = nullptr;
    QPushButton *m_subdlSearchBtn = nullptr;
    QComboBox *m_subdlResultsCombo = nullptr;
    QPushButton *m_subdlDownloadBtn = nullptr;
    QLabel *m_subdlStatusLabel = nullptr;
    class QNetworkAccessManager *m_netMgr = nullptr;

    QString m_currentImdbId;
    QString m_currentTmdbId;
    QString m_currentShowTitle;
    int m_currentSeason = 0;
    int m_currentEpisode = 0;
    QString m_subdlApiKey;
    int m_syncPort = 0;

    QPushButton *m_loadSubBtn = nullptr;
    QPushButton *m_addFolderSubBtn = nullptr;
    QPushButton *m_refreshProfileSubsBtn = nullptr;
    QPushButton *m_toggleStatsBtn = nullptr;

    // Video Filter Sliders
    QSlider *m_brightnessSlider = nullptr;
    QSlider *m_contrastSlider = nullptr;
    QSlider *m_saturationSlider = nullptr;
    QLabel *m_brightnessValLabel = nullptr;
    QLabel *m_contrastValLabel = nullptr;
    QLabel *m_saturationValLabel = nullptr;
    QPushButton *m_resetFiltersBtn = nullptr;

    void initUi();
    void applyIcons();
    void populateProfileFolders();
    void populateShowFolders(const QString &profileRoot);
    void scanProfileSubtitles(const QString &folderPath);
};

#endif // SETTINGSDRAWER_H
