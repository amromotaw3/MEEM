cmake_minimum_required(VERSION 3.16)
project(MEEM_Player_CPP LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets)

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/vlc_sdk
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/src/core
    ${CMAKE_CURRENT_SOURCE_DIR}/src/ui
)

set(SOURCES
    src/main.cpp
    src/core/PlaylistItem.cpp
    src/core/PlaylistManager.cpp
    src/core/PlayerEngine.cpp
    src/ui/VideoCanvasWidget.cpp
    src/ui/HomeWidget.cpp
    src/ui/SeekBar.cpp
    src/ui/ControlBarWidget.cpp
    src/ui/PlaylistDrawer.cpp
    src/ui/SettingsDrawer.cpp
    src/ui/MainWindow.cpp
)

set(HEADERS
    vlc_sdk/vlc/vlc.h
    src/core/PlaylistItem.h
    src/core/PlaylistManager.h
    src/core/PlayerEngine.h
    src/ui/styles.h
    src/ui/VideoCanvasWidget.h
    src/ui/HomeWidget.h
    src/ui/SeekBar.h
    src/ui/ControlBarWidget.h
    src/ui/PlaylistDrawer.h
    src/ui/SettingsDrawer.h
    src/ui/MainWindow.h
)

add_executable(MEEM-Player-CPP ${SOURCES} ${HEADERS})

target_link_libraries(MEEM-Player-CPP PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
)

if (WIN32)
    target_link_libraries(MEEM-Player-CPP PRIVATE "C:/Program Files/VideoLAN/VLC/libvlc.lib")
endif()
