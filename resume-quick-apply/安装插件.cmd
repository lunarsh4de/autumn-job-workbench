@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\Install-ResumeQuickApply.ps1"
if errorlevel 1 (
  echo.
  echo Installation helper failed. See the message above.
  pause
)
endlocal
