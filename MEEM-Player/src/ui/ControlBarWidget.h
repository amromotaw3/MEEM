#ifndef CONTROLBARWIDGET_H
#define CONTROLBARWIDGET_H

#include <QWidget>
#include <QPushButton>
#include <QLabel>
#include <QSlider>
#include <QHBoxLayout>
#include <QVBoxLayout>
#include "SeekBar.h"
#include "VolumeSlider.h"

class MainWindow;

class TopBarWidget : public QWidget {
    Q_OBJECT

public:
    explicit TopBarWidget(MainWindow *mainWin);

    void setIconsBasePath(const QString &basePath);
    void setMediaTitle(const QString &title, const QString &subtitle = "");
    void setMediaActive(bool active);

signals:
    void openFileClicked();
    void homeClicked();

public:
    void updateMaximizeButton(bool maximized);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseDoubleClickEvent(QMouseEvent *event) override;
    bool nativeEvent(const QByteArray &eventType, void *message, qintptr *result) override;

private:
    MainWindow *m_mainWin = nullptr;

    QLabel *m_logoLabel = nullptr;
    QLabel *m_titleLabel = nullptr;
    QLabel *m_subtitleLabel = nullptr;
    QPushButton *m_openFileBtn = nullptr;
    QPushButton *m_homeBtn = nullptr;
    QPushButton *m_minimizeBtn = nullptr;
    QPushButton *m_maximizeBtn = nullptr;
    QPushButton *m_closeBtn = nullptr;

    QPoint m_dragPos;
    QString m_iconsPath;
    QIcon m_iconMax;
    QIcon m_iconRestore;

    void initUi();
    void applyIcons();
};

class BottomBarWidget : public QWidget {
    Q_OBJECT

public:
    explicit BottomBarWidget(MainWindow *mainWin);

    void setIconsBasePath(const QString &basePath);
    void setPlaybackState(bool isPlaying);
    void setTime(qint64 currentMs, qint64 totalMs);
    void setPositionRatio(float ratio);
    void setVolume(int volume);

signals:
    void playPauseToggled();
    void nextClicked();
    void prevClicked();
    void seekRequested(float pos);
    void seekOffsetRequested(qint64 offsetMs);
    void volumeChanged(int vol);
    void muteToggled();
    void playlistToggled();
    void settingsToggled();
    void pipToggled();
    void fullscreenToggled();

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    bool nativeEvent(const QByteArray &eventType, void *message, qintptr *result) override;

private:
    MainWindow *m_mainWin = nullptr;

    QPushButton *m_playBtn = nullptr;
    QPushButton *m_prevBtn = nullptr;
    QPushButton *m_nextBtn = nullptr;
    QPushButton *m_muteBtn = nullptr;
    VolumeSlider *m_volSlider = nullptr;

    QPushButton *m_playlistBtn = nullptr;
    QPushButton *m_settingsBtn = nullptr;
    QPushButton *m_fullscreenBtn = nullptr;

    SeekBar *m_seekBar = nullptr;
    QLabel *m_timeLabel = nullptr;

    QString m_iconsPath;

    void initUi();
    void applyIcons();
    static QString formatTime(qint64 ms);
};

#endif // CONTROLBARWIDGET_H
