@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" -Mode "%~1"
set "UNIFIEDMAIL_EXIT=%ERRORLEVEL%"

if not "%UNIFIEDMAIL_EXIT%"=="0" (
  echo.
  echo UnifiedMail could not start. Review the message above.
  if not defined UNIFIEDMAIL_NO_PAUSE pause
)

exit /b %UNIFIEDMAIL_EXIT%
