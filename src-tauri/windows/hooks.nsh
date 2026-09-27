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
  ${EndIf}
!macroend
