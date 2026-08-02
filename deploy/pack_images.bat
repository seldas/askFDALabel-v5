@echo off
echo ===================================================
echo askFDALabel: Packaging Docker Images (Windows)
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
docker tag ankane/pgvector:latest askfdalabel-db:latest
docker tag redis:alpine askfdalabel-redis:latest

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
docker save askfdalabel-backend:latest -o deploy\askfdalabel-backend.tar
docker save askfdalabel-frontend:latest -o deploy\askfdalabel-frontend.tar
docker save askfdalabel-nginx:latest -o deploy\askfdalabel-nginx.tar
docker save askfdalabel-db:latest -o deploy\askfdalabel-db.tar
docker save askfdalabel-redis:latest -o deploy\askfdalabel-redis.tar

echo.
echo 5. Compressing archives using native Windows tar...
for %%i in (backend frontend nginx db redis) do (
    if exist "deploy\askfdalabel-%%i.tar" (
        tar -czf deploy\askfdalabel-%%i.tar.gz -C deploy askfdalabel-%%i.tar
        del deploy\askfdalabel-%%i.tar
    )
)

echo.
echo ===================================================
echo Packaging successful!
echo Transfer the following files to the target no-outbound environment:
echo - deploy\askfdalabel-*.tar.gz
echo - .env
echo - start_server.py
echo - deploy\load_images.bat
echo ===================================================
pause
