@echo off
title PANDA KEY - Interception Driver Install
setlocal enableextensions

cd /d "%~dp0"

rem --- request admin / auto-elevate ---
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo [INFO] Requesting administrator privileges ^(UAC^)...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

echo.
echo ============================================================
echo   PANDA KEY - Interception Driver Install
echo   (physical keyboard input mode)
echo ============================================================
echo.

set "DRV=%~dp0driver"
set "INSTALLER=%DRV%\install-interception.exe"
set "DLL=%DRV%\interception.dll"

if not exist "%INSTALLER%" (
  echo [ERROR] Installer not found:
  echo         "%INSTALLER%"
  echo         Put install-interception.exe in the "driver" folder.
  echo.
  pause
  exit /b 1
)

echo [1/2] Installing Interception kernel driver...
"%INSTALLER%" /install
echo.

echo [2/2] Copying interception.dll next to the app executables...
copy /Y "%DLL%" "%~dp0interception.dll" >nul 2>&1
copy /Y "%DLL%" "%~dp0src-tauri\interception.dll" >nul 2>&1
if exist "%~dp0src-tauri\target\debug"   copy /Y "%DLL%" "%~dp0src-tauri\target\debug\interception.dll"   >nul 2>&1
if exist "%~dp0src-tauri\target\release" copy /Y "%DLL%" "%~dp0src-tauri\target\release\interception.dll" >nul 2>&1
echo       done.
echo.

echo ============================================================
echo   Driver installed. A REBOOT IS REQUIRED to activate it.
echo   After reboot: launch PANDA KEY, turn ON physical input.
echo   Status should show: driver active.
echo ============================================================
echo.

choice /C YN /M "Reboot now"
if errorlevel 2 goto :end
echo Rebooting in 5 seconds... (close this window to cancel)
shutdown /r /t 5
goto :end

:end
echo.
pause
exit /b 0
