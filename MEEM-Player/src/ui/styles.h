#ifndef STYLES_H
#define STYLES_H

#include <QString>

static const QString BLACK_WHITE_STYLESHEET = R"(
    QMainWindow, QWidget#CentralContainer {
        background-color: #0A0A0C;
        color: #F0F0F5;
        font-family: 'Segoe UI', 'Comfortaa', sans-serif;
    }

    QWidget#ControlBarOverlay, QWidget#TopBarOverlay, QWidget#BottomBarOverlay {
        background: transparent;
    }

    QFrame#DrawerPanel {
        background-color: #0A0A0C;
        border: 1px solid rgba(255, 255, 255, 20);
        border-radius: 16px;
    }

    QPushButton {
        background-color: rgba(255, 255, 255, 14);
        color: #FFFFFF;
        border: 1px solid rgba(255, 255, 255, 18);
        border-radius: 10px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
    }

    QPushButton:hover {
        background-color: rgba(255, 255, 255, 25);
        border-color: rgba(255, 255, 255, 35);
    }

    QPushButton:pressed {
        background-color: rgba(255, 255, 255, 45);
    }

    QPushButton#IconButton {
        background-color: transparent;
        border: none;
        border-radius: 8px;
    }

    QPushButton#IconButton:hover {
        background-color: rgba(255, 255, 255, 24);
    }

    QLabel {
        color: #E2E2EC;
        font-size: 12px;
    }

    QLineEdit {
        background-color: rgba(255, 255, 255, 12);
        color: #FFFFFF;
        border: 1px solid rgba(255, 255, 255, 25);
        border-radius: 8px;
        padding: 7px 12px;
        font-size: 12px;
    }

    QLineEdit:focus {
        border-color: rgba(255, 255, 255, 70);
        background-color: rgba(255, 255, 255, 20);
    }

    QComboBox {
        background-color: rgba(255, 255, 255, 12);
        color: #FFFFFF;
        border: 1px solid rgba(255, 255, 255, 25);
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 12px;
    }

    QComboBox:hover {
        background-color: rgba(255, 255, 255, 24);
        border-color: rgba(255, 255, 255, 50);
    }

    QComboBox QAbstractItemView {
        background-color: #14141A;
        color: #FFFFFF;
        border: 1px solid rgba(255, 255, 255, 30);
        border-radius: 8px;
        selection-background-color: rgba(255, 255, 255, 35);
        padding: 4px;
    }

    QListWidget {
        background-color: transparent;
        border: none;
        outline: none;
    }

    QListWidget::item {
        background-color: rgba(255, 255, 255, 8);
        color: #E2E2EC;
        border-radius: 8px;
        padding: 0px;
        margin-bottom: 4px;
        border: 1px solid transparent;
    }

    QListWidget::item:hover {
        background-color: rgba(255, 255, 255, 18);
        color: #FFFFFF;
        border: 1px solid rgba(255, 255, 255, 30);
    }

    QListWidget::item:selected {
        background-color: rgba(255, 255, 255, 30);
        color: #FFFFFF;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 55);
    }

    QSlider::groove:horizontal {
        height: 4px;
        background: rgba(255, 255, 255, 40);
        border-radius: 2px;
    }

    QSlider::sub-page:horizontal {
        background: #FFFFFF;
        border-radius: 2px;
    }

    QSlider::handle:horizontal {
        background: #FFFFFF;
        width: 12px;
        height: 12px;
        margin: -4px 0;
        border-radius: 6px;
    }

    QSlider::handle:horizontal:hover {
        background: #E0E0E8;
        width: 14px;
        height: 14px;
        margin: -5px 0;
        border-radius: 7px;
    }
)";

#endif // STYLES_H
