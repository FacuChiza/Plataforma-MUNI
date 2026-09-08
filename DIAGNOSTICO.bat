@echo off
REM ============================================================================
REM  VISOR CATASTRAL - VILLA DE MERLO
REM  Genera un informe con el estado real de esta instalacion.
REM
REM  Usarlo cuando algo "sigue sin andar" despues de actualizar: dice que
REM  version hay, desde que carpeta se ejecuta, si quedaron copias viejas del
REM  programa en la computadora, y si los servidores de mapas responden desde
REM  esta red.
REM
REM  Al terminar abre el informe en el Bloc de notas para poder copiarlo.
REM ============================================================================

title Diagnostico del Visor Catastral
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "herramientas\diagnostico.ps1"

echo.
pause
