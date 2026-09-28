#include "SeekBar.h"
#include <QMouseEvent>
#include <QTime>

SeekBar::SeekBar(QWidget *parent) : QSlider(Qt::Horizontal, parent) {
    setMouseTracking(true);
    setRange(0, 1000);
    setValue(0);
    setCursor(Qt::PointingHandCursor);

    m_tooltipLabel = new QLabel(parent ? parent : this);
    m_tooltipLabel->setWindowFlags(Qt::ToolTip | Qt::FramelessWindowHint);
    m_tooltipLabel->setAttribute(Qt::WA_TranslucentBackground, true);
    m_tooltipLabel->setStyleSheet(
        "background-color: rgba(14, 14, 18, 235); "
        "color: #FFFFFF; "
        "border: 1px solid rgba(255, 255, 255, 50); "
        "border-radius: 6px; "
        "padding: 3px 8px; "
        "font-size: 11px;"
        "font-weight: 700;"
        "font-family: 'Consolas', monospace;"
    );
    m_tooltipLabel->hide();
}

void SeekBar::setDuration(qint64 durationMs) {
    m_durationMs = durationMs;
}

void SeekBar::setPositionRatio(float ratio) {
    if (!isSliderDown()) {
        setValue(qBound(0, static_cast<int>(ratio * 1000.0f), 1000));
    }
}

void SeekBar::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        float ratio = static_cast<float>(event->pos().x()) / static_cast<float>(width());
        ratio = qBound(0.0f, ratio, 1.0f);
        setValue(static_cast<int>(ratio * 1000.0f));
        emit seekRequested(ratio);
    }
    QSlider::mousePressEvent(event);
}

void SeekBar::mouseMoveEvent(QMouseEvent *event) {
    updateToolTipPos(event->pos().x());
    QSlider::mouseMoveEvent(event);
}

void SeekBar::wheelEvent(QWheelEvent *event) {
    int delta = event->angleDelta().y();
    if (delta != 0) {
        qint64 stepMs = (delta > 0) ? 5000 : -5000;
        emit seekOffsetRequested(stepMs);
        event->accept();
        return;
    }
    QSlider::wheelEvent(event);
}

void SeekBar::enterEvent(QEnterEvent *event) {
    Q_UNUSED(event);
    m_tooltipLabel->show();
}

void SeekBar::leaveEvent(QEvent *event) {
    Q_UNUSED(event);
    m_tooltipLabel->hide();
}

void SeekBar::updateToolTipPos(int mouseX) {
    if (width() <= 0 || m_durationMs <= 0) return;
    float ratio = qBound(0.0f, static_cast<float>(mouseX) / static_cast<float>(width()), 1.0f);
    qint64 targetMs = static_cast<qint64>(ratio * m_durationMs);

    m_tooltipLabel->setText(formatTime(targetMs));
    m_tooltipLabel->adjustSize();

    QPoint globalPos = mapToGlobal(QPoint(mouseX, -m_tooltipLabel->height() - 6));
    m_tooltipLabel->move(globalPos);
}

QString SeekBar::formatTime(qint64 ms) {
    qint64 totalSeconds = ms / 1000;
    qint64 hours = totalSeconds / 3600;
    qint64 minutes = (totalSeconds % 3600) / 60;
    qint64 seconds = totalSeconds % 60;

    if (hours > 0) {
        return QString("%1:%2:%3")
            .arg(hours, 2, 10, QChar('0'))
            .arg(minutes, 2, 10, QChar('0'))
            .arg(seconds, 2, 10, QChar('0'));
    } else {
        return QString("%1:%2")
            .arg(minutes, 2, 10, QChar('0'))
            .arg(seconds, 2, 10, QChar('0'));
    }
}
