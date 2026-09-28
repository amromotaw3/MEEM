#ifndef SEEKBAR_H
#define SEEKBAR_H

#include <QSlider>
#include <QLabel>

class SeekBar : public QSlider {
    Q_OBJECT

public:
    explicit SeekBar(QWidget *parent = nullptr);

    void setDuration(qint64 durationMs);
    void setPositionRatio(float ratio);

signals:
    void seekRequested(float posRatio);
    void seekOffsetRequested(qint64 offsetMs);

protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void enterEvent(QEnterEvent *event) override;
    void leaveEvent(QEvent *event) override;

private:
    qint64 m_durationMs = 0;
    QLabel *m_tooltipLabel = nullptr;

    void updateToolTipPos(int mouseX);
    static QString formatTime(qint64 ms);
};

#endif // SEEKBAR_H
