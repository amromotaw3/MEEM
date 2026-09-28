#ifndef VIDEOCANVASWIDGET_H
#define VIDEOCANVASWIDGET_H

#include <QWidget>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QLabel>
#include <QPushButton>
#include <QTimer>

class VideoCanvasWidget : public QWidget {
    Q_OBJECT

public:
    explicit VideoCanvasWidget(QWidget *parent = nullptr);

    void *getNativeWinId() const;
    void setMediaActive(bool active);
    bool isMediaActive() const { return m_mediaActive; }
    void setIconsBasePath(const QString &basePath);
    void hookChildWindows();
    void showOsdToast(const QString &title, int percentage, const QString &iconPath = "");

    void showLoading(const QString &title, const QString &subtitle = "", const QString &thumbnailOrPoster = "");
    void hideLoading();
    bool isLoading() const { return m_isLoading; }

signals:
    void filesDropped(const QStringList &paths);
    void mouseMovedSignal();
    void doubleClickedSignal();
    void clickedSignal();
    void openFileRequested();
    void volumeAdjustRequested(int delta);
    void brightnessAdjustRequested(float delta);

protected:
    void dragEnterEvent(QDragEnterEvent *event) override;
    void dropEvent(QDropEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void mouseDoubleClickEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;
    void paintEvent(QPaintEvent *event) override;
    bool nativeEvent(const QByteArray &eventType, void *message, qintptr *result) override;

private:
    QWidget *m_idleWidget = nullptr;
    QLabel *m_idleLogo = nullptr;
    QLabel *m_idleTitle = nullptr;
    QLabel *m_idleSubtitle = nullptr;
    QPushButton *m_idleOpenBtn = nullptr;

    // Loading HUD
    QWidget *m_loadingWidget = nullptr;
    QLabel *m_loadingThumb = nullptr;
    QLabel *m_loadingTitle = nullptr;
    QLabel *m_loadingSubtitle = nullptr;
    QLabel *m_loadingStatus = nullptr;
    class QProgressBar *m_loadingBar = nullptr;
    bool m_isLoading = false;
    class QNetworkAccessManager *m_netMgr = nullptr;

    // OSD Toast HUD
    QWidget *m_osdWidget = nullptr;
    QLabel *m_osdLabel = nullptr;
    QTimer m_osdTimer;

    bool m_mediaActive = false;
    QString m_iconsBasePath;

    void initIdleUi();
    void initLoadingUi();
    void initOsdUi();
};

#endif // VIDEOCANVASWIDGET_H
