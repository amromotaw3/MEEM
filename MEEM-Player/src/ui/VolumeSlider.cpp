#include "VolumeSlider.h"
#include <QMouseEvent>
#include <QWheelEvent>
#include <QEnterEvent>
#include <QTimer>

VolumeSlider::VolumeSlider(QWidget *parent) : QSlider(Qt::Horizontal, parent) {
    setRange(0, 200);
    setValue(100);
    setFixedWidth(125);
    setFixedHeight(28);
    setCursor(Qt::PointingHandCursor);
    setMouseTracking(true);

    m_tooltipLabel = new QLabel(parent ? parent : this);
    m_tooltipLabel->setWindowFlags(Qt::ToolTip | Qt::FramelessWindowHint);
    m_tooltipLabel->setStyleSheet(
        "background-color: rgba(18, 18, 24, 235); "
        "color: #FFFFFF; "
        "border: 1px solid rgba(255, 255, 255, 40); "
        "border-radius: 5px; "
        "padding: 3px 8px; "
        "font-size: 11px; "
        "font-weight: 600;"
    );
    m_tooltipLabel->hide();

    applyCustomStyle();
}

void VolumeSlider::applyCustomStyle() {
    setStyleSheet(
        "QSlider::groove:horizontal {"
        "  height: 5px;"
        "  background: rgba(255, 255, 255, 35);"
        "  border-radius: 2px;"
        "}"
        "QSlider::sub-page:horizontal {"
        "  background: #FFFFFF;"
        "  border-radius: 2px;"
        "}"
        "QSlider::handle:horizontal {"
        "  width: 14px;"
        "  height: 14px;"
        "  margin: -4.5px 0;"
        "  background: #FFFFFF;"
        "  border-radius: 7px;"
        "  border: 1px solid rgba(0, 0, 0, 30);"
        "}"
        "QSlider::handle:horizontal:hover {"
        "  background: #FFFFFF;"
        "  border: 2px solid rgba(255, 255, 255, 90);"
        "}"
    );
}

void VolumeSlider::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton && width() > 0) {
        int val = qBound(0, (event->pos().x() * maximum()) / width(), maximum());
        setValue(val);
        updateTooltip(event->pos().x());
        m_tooltipLabel->show();
    }
    QSlider::mousePressEvent(event);
}

void VolumeSlider::mouseMoveEvent(QMouseEvent *event) {
    if (event->buttons() & Qt::LeftButton && width() > 0) {
        int val = qBound(0, (event->pos().x() * maximum()) / width(), maximum());
        setValue(val);
    }
    updateTooltip(event->pos().x());
    QSlider::mouseMoveEvent(event);
}

void VolumeSlider::wheelEvent(QWheelEvent *event) {
    int delta = event->angleDelta().y();
    if (delta != 0) {
        int step = (delta > 0) ? 5 : -5;
        setValue(qBound(0, value() + step, maximum()));
        updateTooltip(width() / 2);
        m_tooltipLabel->show();
        QTimer::singleShot(900, m_tooltipLabel, [this]() {
            if (!underMouse()) {
                m_tooltipLabel->hide();
            }
        });
        event->accept();
    } else {
        QSlider::wheelEvent(event);
    }
}

void VolumeSlider::enterEvent(QEnterEvent *event) {
    Q_UNUSED(event);
    updateTooltip(width() / 2);
    m_tooltipLabel->show();
}

void VolumeSlider::leaveEvent(QEvent *event) {
    Q_UNUSED(event);
    m_tooltipLabel->hide();
}

void VolumeSlider::updateTooltip(int mouseX) {
    int v = value();
    QString text;
    if (v > 100) {
        text = QString("%1% (Boost)").arg(v);
    } else {
        text = QString("%1%").arg(v);
    }

    m_tooltipLabel->setText(text);
    m_tooltipLabel->adjustSize();

    QPoint globalPos = mapToGlobal(QPoint(qBound(0, mouseX, width() - m_tooltipLabel->width()), -m_tooltipLabel->height() - 8));
    m_tooltipLabel->move(globalPos);
}
