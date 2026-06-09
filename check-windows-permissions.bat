@echo off
echo Checking Windows Screen Capture Permissions...
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Running as Administrator
) else (
    echo [WARNING] Not running as Administrator - some fixes may not work
    echo Right-click and "Run as Administrator" for full functionality
)

echo.
echo Checking PowerShell execution policy...
powershell -Command "Get-ExecutionPolicy" 2>nul
if %errorLevel% neq 0 (
    echo [ERROR] PowerShell access denied
    echo Attempting to fix execution policy...
    powershell -Command "Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" 2>nul
)

echo.
echo Testing screen capture capability...
powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width" 2>nul
if %errorLevel% == 0 (
    echo [OK] Screen capture APIs accessible
) else (
    echo [ERROR] Screen capture APIs not accessible
    echo.
    echo SOLUTIONS:
    echo 1. Open Windows Settings ^> Privacy ^& security ^> Screen recording
    echo 2. Enable "Let apps access screen recording"
    echo 3. Add this application to allowed apps
    echo 4. Restart the application
)

echo.
echo Checking for additional screenshot tools...
where nircmd >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] nircmd utility found
) else (
    echo [INFO] nircmd not found - install from nirsoft.net for additional screenshot support
)

echo.
pause