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

REM ============================================================================
REM  NAVEGADOR: SE PREFIERE GOOGLE CHROME
REM ----------------------------------------------------------------------------
REM  Antes se abria con "start http://...", que usa el navegador predeterminado
REM  de Windows. En las computadoras donde el predeterminado es Firefox, el
REM  visor abria ahi.
REM
REM  Se busca Chrome en los tres lugares donde se instala habitualmente y, si no
REM  aparece, en el registro de Windows, que es donde queda anotado aunque este
REM  instalado en otra carpeta.
REM
REM  Si no hay Chrome en la computadora NO se falla: se abre con el navegador
REM  predeterminado, como se hacia hasta ahora. El visor funciona igual en
REM  Firefox y en Edge; esto es una preferencia, no un requisito.
REM ============================================================================
set "CHROME="

for %%r in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if not defined CHROME if exist "%%~r" set "CHROME=%%~r"
)

REM  Instalado en otra carpeta: Windows anota la ruta real en App Paths.
if not defined CHROME (
    for /f "skip=2 tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do (
        if not defined CHROME if exist "%%~b" set "CHROME=%%~b"
    )
)
if not defined CHROME (
    for /f "skip=2 tokens=2,*" %%a in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do (
        if not defined CHROME if exist "%%~b" set "CHROME=%%~b"
    )
)

if defined CHROME (
    echo  Navegador: Google Chrome
) else (
    echo  Navegador: el predeterminado de Windows ^(no se encontro Chrome^)
)
echo.

REM  Se abre el navegador con unos segundos de retraso para que el servidor
REM  llegue a levantar. Si se abre antes, el navegador muestra un error y hay
REM  que recargar a mano.
REM
REM  POR QUE LA RAMA DE CHROME USA POWERSHELL Y LA OTRA NO
REM    La ruta de Chrome lleva espacios ("C:\Program Files\..."), asi que hay
REM    que pasarla entre comillas. Metida dentro del cmd /c que ya iba entre
REM    comillas, quedan comillas dentro de comillas: cmd se come las de los
REM    extremos, el comando llega partido y el navegador NO se abre. Probado:
REM    no abre nada y tampoco avisa, que es lo peor que podia pasar.
REM
REM    PowerShell recibe la ruta como un argumento y no tiene ese problema.
REM
REM    Cuando no hay Chrome se conserva la linea de siempre, con timeout.exe y
REM    start, que viene funcionando: no hay motivo para tocarla.
REM
REM    timeout.exe va con la ruta completa a proposito: si la computadora tiene
REM    Git instalado, el PATH puede tener otro programa llamado igual que no
REM    entiende estos parametros, y el navegador no se abriria solo.
if defined CHROME (
    start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process '!CHROME!' 'http://localhost:!PUERTO!'"
) else (
    start "" /b cmd /c "%SystemRoot%\System32\timeout.exe /t 4 /nobreak >nul & start http://localhost:!PUERTO!"
)

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
