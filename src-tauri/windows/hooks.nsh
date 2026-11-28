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

!macro OLEAFLY_OPEN_WITH EXT PROGID DESCRIPTION
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}" ""
!macroend

!macro OLEAFLY_RELEASE_DEFAULT EXT PROGID
  ReadRegStr $R7 SHCTX "Software\Classes\${EXT}" ""
  ${If} $R7 == "${PROGID}"
    ReadRegStr $R6 SHCTX "Software\Classes\${EXT}" "${PROGID}_backup"
    ${If} $R6 != ""
    ${AndIf} $R6 != "${PROGID}"
      WriteRegStr SHCTX "Software\Classes\${EXT}" "" "$R6"
    ${Else}
      DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "${PROGID}_backup"
!macroend

!macro OLEAFLY_REMOVE_OPEN_WITH EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  ReadRegStr $R7 SHCTX "Software\Classes\${PROGID}\shell\open\command" ""
  ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    DeleteRegKey SHCTX "Software\Classes\${PROGID}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OLEAFLY_STOP_BACKGROUND_HELPER
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro OLEAFLY_OPEN_WITH ".tex" "Oleafly.tex" "LaTeX document"
  !insertmacro OLEAFLY_OPEN_WITH ".typ" "Oleafly.typ" "Typst document"
  !insertmacro OLEAFLY_OPEN_WITH ".md" "Oleafly.md" "Markdown document"
  !insertmacro OLEAFLY_OPEN_WITH ".markdown" "Oleafly.markdown" "Markdown document"
  !insertmacro OLEAFLY_OPEN_WITH ".qmd" "Oleafly.qmd" "Quarto document"
  !insertmacro OLEAFLY_OPEN_WITH ".Rmd" "Oleafly.Rmd" "R Markdown document"
  !insertmacro OLEAFLY_RELEASE_DEFAULT ".md" "Oleafly.md"
  !insertmacro OLEAFLY_RELEASE_DEFAULT ".markdown" "Oleafly.markdown"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities" "ApplicationName" "Oleafly"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities" "ApplicationDescription" "Write LaTeX, Typst, Markdown and Quarto documents."
  WriteRegStr SHCTX "Software\Oleafly\Capabilities\FileAssociations" ".tex" "Oleafly.tex"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities\FileAssociations" ".typ" "Oleafly.typ"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities\FileAssociations" ".md" "Oleafly.md"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities\FileAssociations" ".markdown" "Oleafly.markdown"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities\FileAssociations" ".qmd" "Oleafly.qmd"
  WriteRegStr SHCTX "Software\Oleafly\Capabilities\FileAssociations" ".Rmd" "Oleafly.Rmd"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Oleafly" "Software\Oleafly\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
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
    !insertmacro OLEAFLY_RELEASE_DEFAULT ".tex" "Oleafly.tex"
    !insertmacro OLEAFLY_RELEASE_DEFAULT ".typ" "Oleafly.typ"
    !insertmacro OLEAFLY_RELEASE_DEFAULT ".md" "Oleafly.md"
    !insertmacro OLEAFLY_RELEASE_DEFAULT ".markdown" "Oleafly.markdown"
    !insertmacro OLEAFLY_RELEASE_DEFAULT ".qmd" "Oleafly.qmd"
    !insertmacro OLEAFLY_RELEASE_DEFAULT ".Rmd" "Oleafly.Rmd"
    !insertmacro OLEAFLY_REMOVE_OPEN_WITH ".tex" "Oleafly.tex"
    !insertmacro OLEAFLY_REMOVE_OPEN_WITH ".typ" "Oleafly.typ"
    !insertmacro OLEAFLY_REMOVE_OPEN_WITH ".md" "Oleafly.md"
    !insertmacro OLEAFLY_REMOVE_OPEN_WITH ".markdown" "Oleafly.markdown"
    !insertmacro OLEAFLY_REMOVE_OPEN_WITH ".qmd" "Oleafly.qmd"
    !insertmacro OLEAFLY_REMOVE_OPEN_WITH ".Rmd" "Oleafly.Rmd"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "Oleafly"
    DeleteRegKey SHCTX "Software\Oleafly\Capabilities"
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
