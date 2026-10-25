; 0.4.8 L: an installer run while the background helper works asks it to
; hand its tasks back and exit first (it is the app's own executable, so it
; would hold the files being replaced). The app stops it itself before an
; in-app update. The command-line tool knows where the data folder is (a
; relocated one included) and whether a helper holds its lock, so the
; installer asks it instead of looking for a file; --force ends a helper that
; does not stop in time. Without a tool in the install folder (a first
; install) there is no helper.
!macro OLEAFLY_STOP_BACKGROUND_HELPER
  ${If} ${FileExists} "$INSTDIR\oleafly-cli.exe"
    nsExec::Exec '"$INSTDIR\oleafly-cli.exe" daemon stop --wait 60 --force'
    Pop $R8
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OLEAFLY_STOP_BACKGROUND_HELPER
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ReadRegStr $R7 HKCU "Software\Classes\Directory\shell\Oleafly\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --open-folder $\"%V$\""
      DeleteRegKey HKCU "Software\Classes\Directory\shell\Oleafly"
    ${EndIf}
    ReadRegStr $R7 HKCU "Software\Classes\Directory\Background\shell\Oleafly\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --open-folder $\"%V$\""
      DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Oleafly"
    ${EndIf}
    ; 0.4.8 F1: remove the terminal command (and its PATH entry) if this
    ; app installed it. The CLI checks its own record and never fails.
    nsExec::Exec '"$INSTDIR\oleafly-cli.exe" internal remove-command-line-tool'
    Pop $0
    ; 0.4.8 L: stop the background helper and remove its sign-in entry
    ; when it starts this installation.
    !insertmacro OLEAFLY_STOP_BACKGROUND_HELPER
    ReadRegStr $R7 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OleaflyBackground"
    StrCpy $R5 "$\"$INSTDIR\"
    StrLen $R4 $R5
    StrCpy $R6 $R7 $R4
    ${If} $R6 == $R5
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OleaflyBackground"
    ${EndIf}
  ${EndIf}
!macroend
