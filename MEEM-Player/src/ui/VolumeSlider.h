#ifndef VOLUMESLIDER_H
#define VOLUMESLIDER_H

#include <QSlider>
#include <QLabel>
#include <QPoint>

class VolumeSlider : public QSlider {
    Q_OBJECT

public:
    explicit VolumeSlider(QWidget *parent = nullptr);
    ~VolumeSlider() override = default;

protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void enterEvent(QEnterEvent *event) override;
    void leaveEvent(QEvent *event) override;

private:
    QLabel *m_tooltipLabel = nullptr;
    void updateTooltip(int mouseX);
    void applyCustomStyle();
};

#endif // VOLUMESLIDER_H
