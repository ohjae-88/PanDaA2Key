@echo off
title PANDA KEY Ver.2.0.1 - Tauri Dev
setlocal

cd /d "%~dp0"

echo.
echo ============================================================
echo   PANDA KEY - Ver.2.0.1  Tauri Dev
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

where cargo >nul 2>nul
if errorlevel 1 goto :no_rust

if not exist "node_modules\" goto :install
if not exist "node_modules\@tauri-apps\cli\package.json" goto :install
goto :run

:install
echo [INFO] Installing/updating dependencies...
echo        First-time setup may take several minutes.
echo.
call npm install
if errorlevel 1 goto :install_failed
echo.
echo [OK] Dependencies ready.
echo.
goto :run

:run
echo [RUN] Starting Tauri dev mode...
echo       Native window will open when ready.
echo       First-time Rust compile may take 1-5 minutes.
echo       Press Ctrl+C in this window to stop.
echo.
call npm run tauri:dev
echo.
echo ============================================================
echo   Tauri dev stopped.
echo ============================================================
pause
exit /b 0

:no_node
echo [ERROR] Node.js is not installed.
echo.
pause
exit /b 1

:no_rust
echo [ERROR] Rust (cargo) is not installed.
echo.
pause
exit /b 1

:install_failed
echo.
echo [ERROR] npm install failed. See messages above.
pause
exit /b 1
