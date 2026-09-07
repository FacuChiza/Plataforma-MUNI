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

echo  Iniciando el visor...
echo.

REM  Se abre el navegador con unos segundos de retraso para que el servidor
REM  llegue a levantar. Si se abre antes, el navegador muestra un error y hay
REM  que recargar a mano.
REM
REM  timeout.exe va con la ruta completa a proposito: si la computadora tiene
REM  Git instalado, el PATH puede tener otro programa llamado igual que no
REM  entiende estos parametros, y el navegador no se abriria solo.
start "" /b cmd /c "%SystemRoot%\System32\timeout.exe /t 4 /nobreak >nul & start http://localhost:8000"

echo  ------------------------------------------------------------
echo   El visor se abre solo en el navegador.
echo   Si no se abre, entrar a:  http://localhost:8000
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
echo   que el puerto 8000 ya este ocupado por otro programa, o que
echo   el visor ya este abierto en otra ventana.
echo  ============================================================
echo.
pause
