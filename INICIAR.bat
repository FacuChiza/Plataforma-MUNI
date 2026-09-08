@echo off
REM ============================================================================
REM  VISOR CATASTRAL - VILLA DE MERLO
REM  Uso diario: doble clic aca y listo.
REM
REM  Deja el servidor corriendo en esta ventana y abre el visor en el
REM  navegador. La ventana negra tiene que quedar ABIERTA mientras se usa:
REM  si se cierra, el visor deja de funcionar.
REM ============================================================================

title Visor Catastral - Villa de Merlo  (NO CERRAR esta ventana)
cd /d "%~dp0"
color 0A

echo.
echo  ============================================================
echo   VISOR CATASTRAL - VILLA DE MERLO
echo  ============================================================
echo.

REM --- Comprobaciones minimas, con mensajes que digan que hacer ---------------
where node >nul 2>nul
if errorlevel 1 (
    echo  ERROR: Node.js no esta instalado.
    echo  Ejecutar primero INSTALAR.bat
    echo.
    pause
    exit /b 1
)

if not exist "servidor\node_modules" (
    echo  ERROR: faltan los componentes del sistema.
    echo  Ejecutar primero INSTALAR.bat
    echo.
    pause
    exit /b 1
)

if not exist "servidor\.env" (
    echo  ERROR: falta la configuracion de la base de datos.
    echo  Ejecutar primero INSTALAR.bat
    echo.
    pause
    exit /b 1
)

REM ============================================================================
REM  PUERTO: SE BUSCA UNO LIBRE
REM ----------------------------------------------------------------------------
REM  No se usa un puerto fijo. El 8000 lo ocupa el visor anterior, y cualquier
REM  otro numero elegido de antemano puede estar tomado por otro programa de
REM  esta computadora. En vez de fallar, se prueban varios y se usa el primero
REM  que este libre.
REM
REM  El 8000 no se prueba nunca: es el del visor anterior y no hay que
REM  molestarlo. Este visor no cierra ni ocupa nada que ya este en uso; los dos
REM  tienen que poder funcionar al mismo tiempo, para que si algo aca falla en
REM  la Municipalidad sigan trabajando con el de siempre.
REM
REM  El numero elegido se le pasa al servidor por variable de entorno, asi el
REM  navegador se abre en el puerto correcto sin configurar nada a mano.
REM ============================================================================
setlocal enabledelayedexpansion

set "PUERTO="
for %%p in (8001 8002 8003 8010 8020 8080 8090 3000 3001 5000) do (
    if not defined PUERTO (
        netstat -ano | findstr /r /c:":%%p .*LISTENING" >nul 2>nul
        if errorlevel 1 set "PUERTO=%%p"
    )
)

if not defined PUERTO (
    echo.
    echo  No se encontro ningun puerto libre para abrir el visor.
    echo.
    echo  Cerrar algun programa que este usando la red y volver a intentar,
    echo  o reiniciar la computadora.
    echo.
    pause
    exit /b 1
)

echo  Puerto: !PUERTO!
set "PORT=!PUERTO!"

echo  Iniciando el visor...
echo.

REM  Se abre el navegador con unos segundos de retraso para que el servidor
REM  llegue a levantar. Si se abre antes, el navegador muestra un error y hay
REM  que recargar a mano.
REM
REM  timeout.exe va con la ruta completa a proposito: si la computadora tiene
REM  Git instalado, el PATH puede tener otro programa llamado igual que no
REM  entiende estos parametros, y el navegador no se abriria solo.
start "" /b cmd /c "%SystemRoot%\System32\timeout.exe /t 4 /nobreak >nul & start http://localhost:!PUERTO!"

echo  ------------------------------------------------------------
echo   El visor se abre solo en el navegador.
echo   Si no se abre, entrar a:  http://localhost:!PUERTO!
echo.
echo   DEJAR ESTA VENTANA ABIERTA mientras se use el visor.
echo   Para cerrarlo: cerrar esta ventana.
echo  ------------------------------------------------------------
echo.

cd servidor
node server.js

REM  Si llega aca es porque el servidor se detuvo o fallo al arrancar.
echo.
echo  ============================================================
echo   El visor se detuvo.
echo.
echo   Si fue un error, el motivo figura arriba. El mas comun es
echo   que este visor ya este abierto en otra ventana.
echo  ============================================================
echo.
pause
