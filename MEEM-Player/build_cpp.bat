@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   Building MEEM Player C++ (Qt6 + LibVLC C-API)
echo ===================================================

call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64

set QT_DIR=C:\Qt\6.8.0\msvc2022_64
set VLC_DIR=C:\Program Files\VideoLAN\VLC

echo [1/3] Generating local libvlc.lib from libvlc.dll...
if not exist "libvlc.lib" (
    echo EXPORTS > libvlc.def
    for /f "tokens=4" %%a in ('dumpbin /exports "%VLC_DIR%\libvlc.dll" ^| findstr /R /C:"libvlc_"') do (
        echo %%a >> libvlc.def
    )
    lib /def:libvlc.def /out:libvlc.lib /machine:x64
)

echo [2/3] Running Qt MOC preprocessor...
if not exist build_cpp mkdir build_cpp

"%QT_DIR%\bin\moc.exe" src/core/PlaylistManager.h -o build_cpp/moc_PlaylistManager.cpp
"%QT_DIR%\bin\moc.exe" src/core/PlayerEngine.h -o build_cpp/moc_PlayerEngine.cpp
"%QT_DIR%\bin\moc.exe" src/ui/VideoCanvasWidget.h -o build_cpp/moc_VideoCanvasWidget.cpp
"%QT_DIR%\bin\moc.exe" src/ui/SeekBar.h -o build_cpp/moc_SeekBar.cpp
"%QT_DIR%\bin\moc.exe" src/ui/ControlBarWidget.h -o build_cpp/moc_ControlBarWidget.cpp
"%QT_DIR%\bin\moc.exe" src/ui/PlaylistDrawer.h -o build_cpp/moc_PlaylistDrawer.cpp
"%QT_DIR%\bin\moc.exe" src/ui/VolumeSlider.h -o build_cpp/moc_VolumeSlider.cpp
"%QT_DIR%\bin\moc.exe" src/ui/SettingsDrawer.h -o build_cpp/moc_SettingsDrawer.cpp
"%QT_DIR%\bin\moc.exe" src/ui/MainWindow.h -o build_cpp/moc_MainWindow.cpp

echo [2.5/3] Compiling Windows resource (app icon)...
rc.exe /nologo /fo build_cpp\app.res app.rc

echo [3/3] Compiling C++ application with MSVC cl.exe (/permissive- /std:c++20)...
cl.exe /permissive- /std:c++20 /EHsc /O2 /W3 /Zc:__cplusplus /Fo:build_cpp\ ^
    /I"vlc_sdk" /I"src" /I"src/core" /I"src/ui" /I"build_cpp" ^
    /I"%QT_DIR%\include" /I"%QT_DIR%\include\QtCore" /I"%QT_DIR%\include\QtGui" /I"%QT_DIR%\include\QtWidgets" /I"%QT_DIR%\include\QtNetwork" ^
    src/main.cpp src/core/PlaylistItem.cpp src/core/PlaylistManager.cpp src/core/PlayerEngine.cpp ^
    src/ui/VideoCanvasWidget.cpp src/ui/SeekBar.cpp src/ui/VolumeSlider.cpp src/ui/ControlBarWidget.cpp src/ui/PlaylistDrawer.cpp ^
    src/ui/SettingsDrawer.cpp src/ui/MainWindow.cpp src/ui/ResizeGripWidget.cpp ^
    build_cpp/moc_PlaylistManager.cpp build_cpp/moc_PlayerEngine.cpp build_cpp/moc_VideoCanvasWidget.cpp ^
    build_cpp/moc_SeekBar.cpp build_cpp/moc_VolumeSlider.cpp build_cpp/moc_ControlBarWidget.cpp build_cpp/moc_PlaylistDrawer.cpp ^
    build_cpp/moc_SettingsDrawer.cpp build_cpp/moc_MainWindow.cpp ^
    /Fe:MEEM-Player.exe ^
    /link /subsystem:windows /entry:mainCRTStartup /LIBPATH:"%QT_DIR%\lib" Qt6Core.lib Qt6Gui.lib Qt6Widgets.lib Qt6Svg.lib Qt6Network.lib libvlc.lib User32.lib Shell32.lib dwmapi.lib Ole32.lib build_cpp\app.res

echo.
if exist MEEM-Player.exe (
    if exist MEEM-Player-CPP.exe del /F /Q MEEM-Player-CPP.exe
    echo ===================================================
    echo  SUCCESS: MEEM-Player.exe built with embedded icon!
    echo ===================================================
) else (
    echo ===================================================
    echo  BUILD FAILED!
    echo ===================================================
)
