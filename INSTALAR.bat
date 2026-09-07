@echo off
REM ============================================================================
REM  VISOR CATASTRAL - VILLA DE MERLO
REM  Instalacion. Se corre UNA SOLA VEZ, la primera vez.
REM  Para el uso de todos los dias esta INICIAR.bat
REM ----------------------------------------------------------------------------
REM  Sin acentos a proposito: la consola de Windows los muestra mal segun la
REM  configuracion regional del equipo, y este archivo tiene que leerse bien en
REM  cualquier maquina de la Municipalidad.
REM ============================================================================

title Instalacion del Visor Catastral - Villa de Merlo
cd /d "%~dp0"
color 0F

echo.
echo  ============================================================
echo   VISOR CATASTRAL - VILLA DE MERLO
echo   Instalacion inicial
echo  ============================================================
echo.

REM --------------------------------------------------------------------------
REM  PASO 1: Node.js
REM --------------------------------------------------------------------------
echo  [1/4] Verificando Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  ERROR: Node.js no esta instalado en esta computadora.
    echo.
    echo  El visor lo necesita para funcionar. Se descarga gratis de:
    echo      https://nodejs.org
    echo.
    echo  Bajar la version "LTS", instalarla con las opciones por defecto,
    echo  y volver a ejecutar este archivo.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set NODEVER=%%v
echo        Node.js %NODEVER% encontrado.
echo.

REM --------------------------------------------------------------------------
REM  PASO 2: dependencias
REM --------------------------------------------------------------------------
echo  [2/4] Instalando componentes (puede tardar unos minutos)...
cd servidor
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  ERROR: no se pudieron instalar los componentes.
    echo.
    echo  Causa mas comun: la computadora no tiene salida a internet.
    echo  Los componentes se bajan una sola vez; despues el visor funciona
    echo  sin internet, solo con la red interna de la Municipalidad.
    echo.
    echo  Si no hay internet en este equipo: copiar la carpeta
    echo  servidor\node_modules desde una computadora donde si haya.
    echo.
    cd ..
    pause
    exit /b 1
)
cd ..
echo        Componentes instalados.
echo.

REM --------------------------------------------------------------------------
REM  PASO 3: configuracion de la base de datos
REM ----------------------------------------------------------------------------
REM  Los datos se cargan editando el archivo en el Bloc de notas, y no
REM  preguntandolos en esta ventana. Es mas simple y menos fragil: escribir una
REM  contrasena en la consola no permite corregir errores, y el archivo ya trae
REM  explicado que significa cada linea.
REM --------------------------------------------------------------------------
echo  [3/4] Configuracion de la base de datos...

if exist "servidor\.env" (
    echo        Ya existe una configuracion. Se conserva.
    echo        Para cambiarla, editar el archivo servidor\.env
    goto :configurado
)

echo.
echo        Falta cargar los datos de conexion a la base municipal.
echo.
echo        Se va a abrir el Bloc de notas con el archivo de
echo        configuracion. Hay que completar estas cuatro lineas:
echo.
echo            DB_SERVER      nombre o IP del servidor de base de datos
echo            DB_DATABASE    nombre de la base
echo            DB_USER        usuario
echo            DB_PASSWORD    contrasena
echo.
echo        Si no tenes esos datos, pediselos a quien administre el
echo        sistema de catastro.
echo.
echo        Al terminar: GUARDAR con Ctrl+G y CERRAR el Bloc de notas
echo        para que la instalacion siga.
echo.
pause

copy /y "servidor\.env.example" "servidor\.env" >nul
if not exist "servidor\.env" (
    echo.
    echo  ERROR: no se pudo crear el archivo de configuracion.
    echo  Puede ser que la carpeta este protegida contra escritura.
    echo  Probar moviendo el programa a otra carpeta, por ejemplo:
    echo      C:\VisorCatastral
    echo.
    pause
    exit /b 1
)

REM  start /wait deja la instalacion detenida hasta que se cierre el Bloc de
REM  notas. Sin /wait seguiria de largo y probaria la conexion con el archivo
REM  todavia sin completar.
start /wait notepad "servidor\.env"

echo        Configuracion guardada.

:configurado
echo.

REM --------------------------------------------------------------------------
REM  PASO 4: probar la conexion
REM --------------------------------------------------------------------------
echo  [4/4] Probando la conexion con la base municipal...
echo.
node herramientas\probar-conexion.js
set RESULTADO=%errorlevel%

echo.
echo  ============================================================
if "%RESULTADO%"=="0" (
    echo   LISTO. La instalacion termino y la base responde.
    echo.
    echo   Para usar el visor, hace doble clic en INICIAR.bat
) else (
    echo   La instalacion termino, pero la base NO respondio.
    echo.
    echo   Arriba figura el motivo. Los mas comunes son:
    echo     - la computadora no esta en la red de la Municipalidad
    echo     - el usuario o la contrasena no son correctos
    echo.
    echo   El visor igual va a abrir y el mapa se va a ver, pero las
    echo   fichas de las parcelas van a salir sin datos.
    echo.
    echo   Para corregir los datos de conexion: editar servidor\.env
)
echo  ============================================================
echo.
pause
