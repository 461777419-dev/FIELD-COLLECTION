!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\runtime\node.exe" "${PRODUCTNAME}"
!macroend
