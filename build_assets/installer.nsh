!macro customHeader
  # This macro is called by electron-builder
!macroend

!macro customInit
  # Custom initialization
!macroend

# Customize colors (Modern UI 2) to match MediaVault Dark Theme
!define MUI_BGCOLOR "0A0A0F"
!define MUI_TEXTCOLOR "FFFFFF"
!define MUI_HEADERIMAGE_BGCOLOR "0A0A0F"

# Ensure the installer doesn't look like a standard white Windows app
# This sets the background of the inner pages
!define MUI_FINISHPAGE_BGCOLOR "0A0A0F"
!define MUI_FINISHPAGE_TEXTCOLOR "FFFFFF"
