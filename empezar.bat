@echo off
REM ============================================================
REM  Whiteboard TTRPG - levantar el server
REM  Doble click y listo. La primera vez tarda varios minutos
REM  porque construye la imagen de Docker.
REM ============================================================
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Docker no esta corriendo.
    echo.
    echo  Abri Docker Desktop, espera a que termine de arrancar
    echo  ^(el icono de la ballena en la bandeja, abajo a la derecha^)
    echo  y volve a hacer doble click en este archivo.
    echo.
    pause
    exit /b 1
)

echo.
echo  Construyendo y levantando el server...
echo  (la primera vez tarda varios minutos, despues es instantaneo)
echo.
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo  [ERROR] Algo fallo. Saca una captura de esta ventana
    echo  y mandasela a Bauti.
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo   Listo! El server esta corriendo.
echo   Se te va a abrir el navegador en http://localhost:8000
echo.
echo   Crea tu campaña y comparti el link que aparece
echo   en el banner azul con tu mesa por Discord.
echo  ====================================================
echo.
timeout /t 3 >nul
start http://localhost:8000
