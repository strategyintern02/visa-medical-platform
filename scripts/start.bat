@echo off
title Visa Medical Intelligence Platform

:: This script lives in scripts/. Step up to the project root before running
:: anything so node/npm pick up the correct package.json and node_modules.
cd /d "%~dp0\.."

echo.
echo  ================================================
echo   Visa Medical Intelligence Platform
echo  ================================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  Node.js is not installed on this computer.
    echo.
    echo  Please follow these steps:
    echo    1. Go to  https://nodejs.org
    echo    2. Download the "LTS" version ^(the green button^)
    echo    3. Run the installer and click Next on all steps
    echo    4. Restart your computer
    echo    5. Double-click start.bat again
    echo.
    echo  Opening the download page now...
    start https://nodejs.org
    pause
    exit /b 1
)

echo  Node.js found:
node --version
echo.

:: Install dependencies on first run
if not exist "node_modules\" (
    echo  Setting up for the first time, please wait...
    npm install
    echo.
)

:: Start the server
echo  Starting server...
echo.
echo  ================================================
echo   Open this in your browser:
echo   http://localhost:3000
echo  ================================================
echo.
echo  Keep this window open while using the platform.
echo  Close this window to stop the server.
echo.

start "" "http://localhost:3000"
node server/api.js

pause
