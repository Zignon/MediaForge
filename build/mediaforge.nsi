; =====================================================================
;  Media Forge — Windows x64 installer (NSIS 3, Unicode, MUI2)
;  Compiled by scripts/build-installer.js. Defines passed in:
;    APP_DIR   = packaged application directory (dist/win-unpacked)
;    VERSION   = x.y.z
;    OUT_FILE  = output installer path
;    PREREQ_DIR= directory holding vc_redist.x64.exe (optional)
; =====================================================================
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ManifestDPIAware true

!define APP_NAME "Media Forge"
!define APP_EXE "Media Forge.exe"
!define APP_ID "MediaForge"
!define PUBLISHER "Media Forge"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
!define PROGID "MediaForge.Video"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "Software\${APP_ID}" "InstallDir"
RequestExecutionLevel admin
BrandingText "${APP_NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright © 2026 ${PUBLISHER}"

!include "MUI2.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; ---------- look & feel (icon palette) ----------
!define MUI_ICON "${__FILEDIR__}\icon.ico"
!define MUI_UNICON "${__FILEDIR__}\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${__FILEDIR__}\installerSidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${__FILEDIR__}\installerSidebar.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${__FILEDIR__}\installerHeader.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "This wizard installs ${APP_NAME} ${VERSION}, a hardware-accelerated video converter.$\r$\n$\r$\nEverything the app needs — the FFmpeg engine and the Visual C++ runtime — is installed for you. No other downloads are required.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!define MUI_FINISHPAGE_SHOWREADME_CHECKED
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; ---------- pages ----------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${__FILEDIR__}\..\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ---------- helpers ----------
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APP_NAME} requires 64-bit Windows."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "${APP_NAME} requires Windows 10 or newer."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
FunctionEnd

!macro RegisterExt EXT
  WriteRegStr HKCR ".${EXT}\OpenWithProgids" "${PROGID}" ""
!macroend
!macro UnregisterExt EXT
  DeleteRegValue HKCR ".${EXT}\OpenWithProgids" "${PROGID}"
!macroend

; ---------- install ----------
Section "Install"
  SetOutPath "$INSTDIR"
  SetOverwrite on
  DetailPrint "Closing running instances…"
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXE}"'

  DetailPrint "Installing ${APP_NAME} and the FFmpeg engine…"
  File /r "${APP_DIR}\*.*"

  ; --- Visual C++ 2015-2022 x64 runtime (silent, only if missing) ---
!if /FileExists "${PREREQ_DIR}\vc_redist.x64.exe"
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
  ${If} $0 == 1
  ${AndIf} $1 >= 14
    DetailPrint "Visual C++ runtime already present."
  ${Else}
    DetailPrint "Installing Visual C++ 2015-2022 runtime…"
    SetOutPath "$TEMP\MediaForgePrereqs"
    File "${PREREQ_DIR}\vc_redist.x64.exe"
    ExecWait '"$TEMP\MediaForgePrereqs\vc_redist.x64.exe" /install /quiet /norestart' $2
    DetailPrint "Visual C++ runtime installer returned $2"
    Delete "$TEMP\MediaForgePrereqs\vc_redist.x64.exe"
    RMDir "$TEMP\MediaForgePrereqs"
    SetOutPath "$INSTDIR"
  ${EndIf}
!else
  DetailPrint "Visual C++ runtime: using the copy shipped with Windows 10/11."
!endif

  ; --- sanity check ---
  IfFileExists "$INSTDIR\resources\ffmpeg\ffmpeg.exe" +2 0
    MessageBox MB_ICONEXCLAMATION "FFmpeg was not found in this package; conversions will not work."

  ; --- shortcuts ---
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; --- uninstaller + Add/Remove Programs ---
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"

  ; --- "Open with Media Forge" for video files (does not steal defaults) ---
  WriteRegStr HKCR "${PROGID}" "" "Video file"
  WriteRegStr HKCR "${PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCR "${PROGID}\shell\open" "" "Convert with ${APP_NAME}"
  WriteRegStr HKCR "${PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr HKCR "Applications\${APP_EXE}" "FriendlyAppName" "${APP_NAME}"
  WriteRegStr HKCR "Applications\${APP_EXE}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  !insertmacro RegisterExt "mkv"
  !insertmacro RegisterExt "mp4"
  !insertmacro RegisterExt "avi"
  !insertmacro RegisterExt "mpg"
  !insertmacro RegisterExt "mpeg"
  !insertmacro RegisterExt "mov"
  !insertmacro RegisterExt "wmv"
  !insertmacro RegisterExt "ts"
  !insertmacro RegisterExt "m2ts"
  !insertmacro RegisterExt "webm"
  !insertmacro RegisterExt "flv"
  !insertmacro RegisterExt "m4v"
  !insertmacro RegisterExt "vob"
  ; right-click context menu entry for all video files
  WriteRegStr HKCR "SystemFileAssociations\video\shell\${APP_ID}" "" "Convert with ${APP_NAME}"
  WriteRegStr HKCR "SystemFileAssociations\video\shell\${APP_ID}" "Icon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCR "SystemFileAssociations\video\shell\${APP_ID}\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

; ---------- uninstall ----------
Section "Uninstall"
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXE}"'
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\${APP_ID}"
  DeleteRegKey HKCR "${PROGID}"
  DeleteRegKey HKCR "Applications\${APP_EXE}"
  DeleteRegKey HKCR "SystemFileAssociations\video\shell\${APP_ID}"
  !insertmacro UnregisterExt "mkv"
  !insertmacro UnregisterExt "mp4"
  !insertmacro UnregisterExt "avi"
  !insertmacro UnregisterExt "mpg"
  !insertmacro UnregisterExt "mpeg"
  !insertmacro UnregisterExt "mov"
  !insertmacro UnregisterExt "wmv"
  !insertmacro UnregisterExt "ts"
  !insertmacro UnregisterExt "m2ts"
  !insertmacro UnregisterExt "webm"
  !insertmacro UnregisterExt "flv"
  !insertmacro UnregisterExt "m4v"
  !insertmacro UnregisterExt "vob"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
