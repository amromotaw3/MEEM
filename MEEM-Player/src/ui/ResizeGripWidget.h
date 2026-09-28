#ifndef RESIZEGRIPWIDGET_H
#define RESIZEGRIPWIDGET_H

#include <QWidget>
#include <QMouseEvent>
#include <QPoint>
#include <QRect>

class MainWindow;

class ResizeGripWidget : public QWidget {
public:
    ResizeGripWidget(Qt::Edges edges, Qt::CursorShape cursorShape, MainWindow *mainWin, QWidget *parent = nullptr);

protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;

private:
    Qt::Edges m_edges;
    MainWindow *m_mainWin;
    QPoint m_dragStartPos;
    QRect m_dragStartGeo;
    bool m_isDragging = false;
};

#endif // RESIZEGRIPWIDGET_H
