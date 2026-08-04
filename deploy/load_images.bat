@echo off
echo ===================================================
echo fdalabel-v3: Loading Docker Images (Windows)
echo ===================================================
echo.

REM Ensure we are in the root directory (parent of deploy)
cd %~dp0\..

set SPECIFIED_TARGET=%1
set TARGET_FOUND=0

if "%SPECIFIED_TARGET%"=="" goto LOAD_ALL

:: If target is specified, validate and load it
set TARGET_LOWER=%SPECIFIED_TARGET%
:: Basic conversion or check
if "%TARGET_LOWER%"=="backend" (
    set TARGET_FOUND=1
    call :LOAD_IMAGE backend
)
if "%TARGET_LOWER%"=="frontend" (
    set TARGET_FOUND=1
    call :LOAD_IMAGE frontend
)
if "%TARGET_LOWER%"=="nginx" (
    set TARGET_FOUND=1
    call :LOAD_IMAGE nginx
)
if "%TARGET_LOWER%"=="db" (
    set TARGET_FOUND=1
    call :LOAD_IMAGE db
)
if "%TARGET_LOWER%"=="redis" (
    set TARGET_FOUND=1
    call :LOAD_IMAGE redis
)

if "%TARGET_FOUND%"=="0" (
    echo [ERROR] Invalid target: '%SPECIFIED_TARGET%'. Valid choices are: backend, frontend, nginx, db, redis
    exit /b 1
)
goto FINISH

:LOAD_ALL
echo [INFO] No specific target requested. Checking for all available image archives...
set LOADED_ANY=0

for %%i in (backend frontend nginx db redis) do (
    if exist "deploy\fdalabel-v3-%%i.tar.gz" (
        set LOADED_ANY=1
        call :LOAD_IMAGE %%i
    )
)

if "%LOADED_ANY%"=="0" (
    echo [WARNING] No image archives (.tar.gz) found in the deploy directory.
)
goto FINISH

:LOAD_IMAGE
set IMG=%1
set ARCHIVE_GZ=deploy\fdalabel-v3-%IMG%.tar.gz
set ARCHIVE_TAR=deploy\fdalabel-v3-%IMG%.tar

echo [INFO] Loading '%IMG%' image from %ARCHIVE_GZ%...
if exist "C:\Program Files\Git\usr\bin\tar.exe" (
    tar -xzf "%ARCHIVE_GZ%" -C deploy
) else if exist "C:\Windows\System32\tar.exe" (
    tar -xzf "%ARCHIVE_GZ%" -C deploy
) else (
    echo [ERROR] Native 'tar' command not found. Cannot extract .tar.gz.
    exit /b 1
)

if exist "%ARCHIVE_TAR%" (
    docker load -i "%ARCHIVE_TAR%"
    del "%ARCHIVE_TAR%"
) else (
    echo [ERROR] Failed to extract archive to %ARCHIVE_TAR%
    exit /b 1
)
exit /b 0

:FINISH
echo.
echo ===================================================
echo Load process complete!
echo.
echo Next steps:
echo 1. Ensure your .env file is configured correctly.
echo 2. Start the application stack:
echo    - For standard production deployment:
echo      python start_server.py --mode prod
echo    - For resource-efficient deployment (low-memory/t3.small):
echo      python start_server.py --mode prod --efficient
echo ===================================================
pause
