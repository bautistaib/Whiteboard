@echo off
REM ============================================================
REM  Whiteboard TTRPG - actualizar a la ultima version
REM  Baja los cambios del repo y reconstruye el server.
REM  Tus datos NO se pierden (estan en la carpeta "data").
REM ============================================================
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Docker no esta corriendo.
    echo  Abri Docker Desktop y volve a intentar.
    echo.
    pause
    exit /b 1
)

echo.
echo  Bajando los cambios...
git pull
if errorlevel 1 (
    echo.
    echo  [ERROR] git pull fallo. Si editaste archivos locales,
    echo  avisale a Bauti. Tus datos en la carpeta "data" estan a salvo.
    echo.
    pause
    exit /b 1
)

echo.
echo  Reconstruyendo el server...
echo.
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo  [ERROR] Algo fallo. Saca una captura y mandasela a Bauti.
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo   Actualizado! El server ya esta corriendo.
echo.
echo   OJO: el link publico puede haber cambiado.
echo   Entra a http://localhost:8000 con tu link de DM
echo   y comparti el nuevo link del banner azul.
echo  ====================================================
echo.
timeout /t 3 >nul
start http://localhost:8000
