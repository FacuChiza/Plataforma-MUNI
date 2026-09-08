@echo off
REM ============================================================================
REM  VISOR CATASTRAL - VILLA DE MERLO
REM  Cambiar los datos de conexion a la base de datos.
REM
REM  Sirve para corregir el servidor, el usuario o la contrasena sin tener que
REM  reinstalar. Los campos aparecen con lo que ya estaba cargado.
REM ============================================================================

title Configuracion de la conexion - Visor Catastral
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "herramientas\configurar.ps1"

if errorlevel 1 (
    echo.
    echo  No se guardaron cambios.
    echo.
    timeout /t 3 /nobreak >nul
    exit /b 1
)

echo.
echo  Configuracion guardada. Al iniciar el visor va a usar estos datos.
echo.
timeout /t 4 /nobreak >nul
