@echo off
title PANDA KEY Ver.2.0.2 - Production Build
setlocal

cd /d "%~dp0"

echo.
echo ============================================================
echo   PANDA KEY - Ver.2.0.2  Production Build
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

where cargo >nul 2>nul
if errorlevel 1 goto :no_rust

rem -- Updater signing key (required for updater artifacts) --
if not exist "%USERPROFILE%\.tauri\pandaa2key.key" goto :no_signkey
set "TAURI_SIGNING_PRIVATE_KEY_PATH=%USERPROFILE%\.tauri\pandaa2key.key"
set "TAURI_SIGNING_PRIVATE_KEY_PASSWORD="

if not exist "node_modules\" goto :install
if not exist "node_modules\@tauri-apps\cli\package.json" goto :install
goto :build

:install
echo [INFO] Installing/updating dependencies for Tauri CLI...
echo.
call npm install
if errorlevel 1 goto :install_failed
echo.
goto :build

:build
echo [PREP] Staging Interception driver files for bundling...
if not exist "driver\interception.dll" goto :no_driver
if not exist "driver\install-interception.exe" goto :no_driver
copy /Y "driver\interception.dll" "src-tauri\interception.dll" >nul
copy /Y "driver\install-interception.exe" "src-tauri\install-interception.exe" >nul
echo        interception.dll + install-interception.exe staged.
echo.

echo [BUILD] Tauri release build (NSIS installer + portable exe)...
echo         Output: src-tauri\target\release\bundle\nsis\
echo         May take 5-15 minutes on first build (Rust compilation).
echo.
call npm run tauri:build
if errorlevel 1 goto :build_failed
echo.

echo [COPY] Collecting build artifacts into "build\"...
if not exist "build\" mkdir "build"
copy /Y "src-tauri\target\release\bundle\nsis\*.exe" "build\" >nul 2>nul
copy /Y "src-tauri\target\release\bundle\nsis\*.sig" "build\" >nul 2>nul
copy /Y "src-tauri\target\release\PANDA KEY.exe" "build\PANDA-KEY-portable.exe" >nul 2>nul
echo        Artifacts copied to build\
echo.

echo ============================================================
echo   Build complete!
echo ============================================================
echo   Output folder: build\
echo     - *-setup.exe            : NSIS installer (auto driver install)
echo     - *-setup.exe.sig        : updater signature (upload to GitHub release)
echo     - PANDA-KEY-portable.exe : portable single executable
echo.
echo   [Release steps]
echo     1. Create a new release (vX.Y.Z) on GitHub PanDaA2Key repo
echo     2. Upload setup.exe + setup.exe.sig + portable exe
echo     3. Write/upload latest.json (version, url=setup.exe URL,
echo        signature=contents of the .sig file)
echo.
explorer "build"
pause
exit /b 0

:no_node
echo [ERROR] Node.js not installed.
pause
exit /b 1

:no_rust
echo [ERROR] Rust not installed.
pause
exit /b 1

:no_signkey
echo [ERROR] Updater signing key not found:
echo         %USERPROFILE%\.tauri\pandaa2key.key
echo         Generate it with:
echo         npx tauri signer generate -w "%%USERPROFILE%%\.tauri\pandaa2key.key" --password ""
pause
exit /b 1

:no_driver
echo [ERROR] Driver files missing in "driver\" folder.
echo         Need: driver\interception.dll and driver\install-interception.exe
pause
exit /b 1

:install_failed
echo.
echo [ERROR] npm install failed.
pause
exit /b 1

:build_failed
echo.
echo [ERROR] Build failed.
pause
exit /b 1
