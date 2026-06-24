; Fancy MediaVault Installer (NSIS)
; Place your artwork in build_assets/installer_images/
; Recommended image sizes (you can replace these):
; - background: 1280x720 (jpg/png)  <-- main hero background shown on installer
; - banner/logo: 600x200 (png with transparency) <-- top logo inside installer
; - header: 900x200 (optional) for header area
; - installer icon: 256x256 (ico)
;
; This script is a template. Integrate into your build pipeline (electron-builder or custom NSIS build).

!include "MUI2.nsh"
!define APP_NAME "MediaVault"
!define APP_EXE "MediaVault Setup.exe"
!define VERSION "11.6.0"

;--------------------------------
; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

;--------------------------------
; Language
!insertmacro MUI_LANGUAGE "English"

;--------------------------------
; Installer Attributes
OutFile "${APP_EXE}"
InstallDir "$PROGRAMFILES\\MediaVault"
RequestExecutionLevel admin

;--------------------------------
; Resources (place images under build_assets/installer_images)
Var INST_BG
Var INST_LOGO

; If you want a background image, load it as a bitmap
; NSIS expects BMP for some background methods; you can convert at build time.
!define INST_BG_FILE "${NSISDIR}\\Contrib\\Graphics\\default.bmp"

Function .onInit
  ; Custom initialization (if needed)
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  ; Copy files (replace with your actual packaged files)
  ; File /r "path\to\release\*"
  ; For template, just create a placeholder
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir $INSTDIR
SectionEnd

;--------------------------------
; Branding notes:
; - Use a 1280x720 hero background and a 600x200 logo for best visual quality.
; - Prefer PNG for transparency in logos; convert background to BMP if embedding as NSIS background (or use a custom page and HTML-based installer).
; - For a truly "fancy" themed installer, consider using an HTML-based installer (NSIS + WebUI) or Inno Setup with custom dialogs.
;--------------------------------
