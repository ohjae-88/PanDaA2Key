@echo off
title PANDA KEY - Interception Driver Uninstall
setlocal enableextensions

cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo [INFO] Requesting administrator privileges ^(UAC^)...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

set "INSTALLER=%~dp0driver\install-interception.exe"
if not exist "%INSTALLER%" (
  echo [ERROR] Installer not found: "%INSTALLER%"
  pause
  exit /b 1
)

echo Uninstalling Interception kernel driver...
"%INSTALLER%" /uninstall
echo.
echo Done. A REBOOT is required to fully remove the driver.
echo.
choice /C YN /M "Reboot now"
if errorlevel 2 goto :end
shutdown /r /t 5
:end
pause
exit /b 0
