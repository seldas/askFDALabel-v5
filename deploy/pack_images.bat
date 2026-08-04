@echo off
echo ===================================================
echo fdalabel-v3: Packaging Docker Images (Windows)
echo ===================================================
echo.

REM Ensure we are in the root directory (parent of deploy)
cd %~dp0\..

echo 1. Pulling third-party database and redis images...
docker pull ankane/pgvector:latest
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to pull ankane/pgvector:latest. Ensure you have internet access.
    exit /b %ERRORLEVEL%
)

docker pull redis:alpine
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to pull redis:alpine. Ensure you have internet access.
    exit /b %ERRORLEVEL%
)

echo.
echo Tagging images for production...
docker tag ankane/pgvector:latest fdalabel-v3-db:latest
docker tag redis:alpine fdalabel-v3-redis:latest

echo.
echo 2. Generating production docker-compose.yml configuration...
python start_server.py --mode prod --dry-run
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to generate production compose file.
    exit /b %ERRORLEVEL%
)

echo.
echo 3. Building all application images (backend, frontend, nginx)...
docker compose build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build application.
    exit /b %ERRORLEVEL%
)

echo.
echo 4. Saving all Docker images to separate archives...
echo This may take several minutes...
docker save fdalabel-v3-backend:latest -o deploy\fdalabel-v3-backend.tar
docker save fdalabel-v3-frontend:latest -o deploy\fdalabel-v3-frontend.tar
docker save fdalabel-v3-nginx:latest -o deploy\fdalabel-v3-nginx.tar
docker save fdalabel-v3-db:latest -o deploy\fdalabel-v3-db.tar
docker save fdalabel-v3-redis:latest -o deploy\fdalabel-v3-redis.tar

echo.
echo 5. Compressing archives using native Windows tar...
for %%i in (backend frontend nginx db redis) do (
    if exist "deploy\fdalabel-v3-%%i.tar" (
        tar -czf deploy\fdalabel-v3-%%i.tar.gz -C deploy fdalabel-v3-%%i.tar
        del deploy\fdalabel-v3-%%i.tar
    )
)

echo.
echo ===================================================
echo Packaging successful!
echo Transfer the following files to the target no-outbound environment:
echo - deploy\fdalabel-v3-*.tar.gz
echo - .env
echo - start_server.py
echo - deploy\load_images.bat
echo ===================================================
pause
