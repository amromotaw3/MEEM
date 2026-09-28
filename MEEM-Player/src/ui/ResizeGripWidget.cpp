#include "ResizeGripWidget.h"
#include "MainWindow.h"

ResizeGripWidget::ResizeGripWidget(Qt::Edges edges, Qt::CursorShape cursorShape, MainWindow *mainWin, QWidget *parent)
    : QWidget(parent ? parent : (QWidget*)mainWin), m_edges(edges), m_mainWin(mainWin)
{
    setCursor(cursorShape);
    setStyleSheet("background: transparent;");
    setAttribute(Qt::WA_NoSystemBackground, true);
    setAttribute(Qt::WA_Hover, true);
}

void ResizeGripWidget::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_isDragging = true;
        m_dragStartPos = event->globalPosition().toPoint();
        m_dragStartGeo = m_mainWin->geometry();
        event->accept();
    }
}

void ResizeGripWidget::mouseMoveEvent(QMouseEvent *event) {
    if (m_isDragging && (event->buttons() & Qt::LeftButton)) {
        QPoint curPos = event->globalPosition().toPoint();
        QPoint delta = curPos - m_dragStartPos;
        QRect geo = m_dragStartGeo;

        int minW = m_mainWin->minimumWidth();
        int minH = m_mainWin->minimumHeight();

        if (m_edges & Qt::LeftEdge) {
            int newW = m_dragStartGeo.width() - delta.x();
            if (newW >= minW) {
                geo.setLeft(m_dragStartGeo.left() + delta.x());
            } else {
                geo.setLeft(m_dragStartGeo.right() - minW + 1);
            }
        } else if (m_edges & Qt::RightEdge) {
            int newW = m_dragStartGeo.width() + delta.x();
            if (newW >= minW) {
                geo.setRight(m_dragStartGeo.right() + delta.x());
            } else {
                geo.setRight(m_dragStartGeo.left() + minW - 1);
            }
        }

        if (m_edges & Qt::TopEdge) {
            int newH = m_dragStartGeo.height() - delta.y();
            if (newH >= minH) {
                geo.setTop(m_dragStartGeo.top() + delta.y());
            } else {
                geo.setTop(m_dragStartGeo.bottom() - minH + 1);
            }
        } else if (m_edges & Qt::BottomEdge) {
            int newH = m_dragStartGeo.height() + delta.y();
            if (newH >= minH) {
                geo.setBottom(m_dragStartGeo.bottom() + delta.y());
            } else {
                geo.setBottom(m_dragStartGeo.top() + minH - 1);
            }
        }

        m_mainWin->setGeometry(geo);
        event->accept();
    }
}

void ResizeGripWidget::mouseReleaseEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_isDragging = false;
        event->accept();
    }
}
