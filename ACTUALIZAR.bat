@echo off
REM ============================================================================
REM  VISOR CATASTRAL - VILLA DE MERLO
REM  Actualizar a la ultima version.
REM
REM  Baja la version publicada y reemplaza los archivos del programa. NO toca
REM  la configuracion de la base ni los componentes ya instalados, asi que
REM  despues de actualizar el visor sigue andando sin volver a configurar nada.
REM
REM  Requiere que esta computadora tenga salida a internet. Si no la tiene, hay
REM  que bajar el ZIP desde otra maquina y reemplazar los archivos a mano.
REM ============================================================================

title Actualizar el Visor Catastral - Villa de Merlo
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "herramientas\actualizar.ps1"

echo.
pause
