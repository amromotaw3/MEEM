@echo off
set QT_DIR=C:\Qt\6.8.0\msvc2022_64\bin
set VLC_DIR=C:\Program Files\VideoLAN\VLC
set PATH=%QT_DIR%;%VLC_DIR%;%PATH%

start "" "%~dp0MEEM-Player-CPP.exe" %*
