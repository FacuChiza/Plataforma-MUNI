# =============================================================================
#  VISOR CATASTRAL - VILLA DE MERLO
#  Actualizador: baja la ultima version y la aplica sobre esta instalacion
# -----------------------------------------------------------------------------
#  POR QUE EXISTE
#    Actualizar bajando el ZIP y descomprimiendo a mano falla de maneras que no
#    se notan: se descomprime en otra carpeta y se sigue ejecutando la vieja, o
#    Windows pregunta si reemplazar y alguien elige omitir, o quedan mezclados
#    archivos de dos versiones. El visor abre igual y parece actualizado, pero
#    se comporta como antes.
#
#    Este script baja la version publicada, reemplaza los archivos del programa
#    y CONSERVA lo que es de esta computadora: la configuracion de la base
#    (.env) y los componentes ya instalados (node_modules).
#
#  CODIGOS DE SALIDA
#    0 = actualizado
#    1 = fallo (el motivo queda escrito en pantalla)
# =============================================================================

$ErrorActionPreference = "Stop"

$carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$raiz    = Split-Path -Parent $carpeta
$origen  = "https://github.com/FacuChiza/Plataforma-MUNI/archive/refs/heads/main.zip"

Write-Host ""
Write-Host "  ============================================================"
Write-Host "   ACTUALIZAR EL VISOR CATASTRAL"
Write-Host "  ============================================================"
Write-Host ""

# Version actual, para poder comparar al terminar
$rutaVersion = Join-Path $raiz "VERSION.txt"
$versionAntes = if (Test-Path $rutaVersion) { (Get-Content $rutaVersion -Raw).Trim() } else { "desconocida" }
Write-Host "  Version instalada: $versionAntes"
Write-Host ""

$temporal = Join-Path $env:TEMP ("visor-actualizacion-" + [Guid]::NewGuid().ToString("N").Substring(0,8))
$zip      = Join-Path $temporal "programa.zip"

try {
    New-Item -ItemType Directory -Path $temporal -Force | Out-Null

    Write-Host "  [1/4] Descargando la ultima version..."
    # TLS 1.2 explicito: Windows Server y equipos con configuracion antigua no
    # lo negocian solo, y la descarga desde GitHub falla sin decir por que.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $origen -OutFile $zip -UseBasicParsing
    Write-Host "        Descargada."

    Write-Host "  [2/4] Descomprimiendo..."
    Expand-Archive -Path $zip -DestinationPath $temporal -Force
    $descomprimida = Get-ChildItem -Path $temporal -Directory | Select-Object -First 1
    if (-not $descomprimida) { throw "El archivo descargado no tiene el contenido esperado." }
    Write-Host "        Listo."

    Write-Host "  [3/4] Aplicando la actualizacion..."

    # Se reemplaza SOLO lo que es el programa. Todo lo que pertenece a esta
    # computadora se deja como esta:
    #   servidor\.env           configuracion de la base
    #   servidor\node_modules   componentes instalados
    #   web\datos               los GeoJSON, si fueran distintos a los publicados
    $aReemplazar = @(
        "web\index.html",
        "web\css",
        "web\js",
        "web\img",
        "servidor\server.js",
        "servidor\package.json",
        "servidor\.env.example",
        "herramientas",
        "docs",
        "INICIAR.bat",
        "INSTALAR.bat",
        "CONFIGURAR.bat",
        "ACTUALIZAR.bat",
        "VERSION.txt",
        "README.md"
    )

    foreach ($item in $aReemplazar) {
        $desde = Join-Path $descomprimida.FullName $item
        $hasta = Join-Path $raiz $item
        if (-not (Test-Path $desde)) { continue }

        $padre = Split-Path -Parent $hasta
        if ($padre -and -not (Test-Path $padre)) {
            New-Item -ItemType Directory -Path $padre -Force | Out-Null
        }

        if (Test-Path $desde -PathType Container) {
            # Copia el contenido de la carpeta, sin borrar lo que no viene en
            # la actualizacion (por ejemplo, node_modules dentro de servidor).
            Copy-Item -Path (Join-Path $desde "*") -Destination $hasta -Recurse -Force
        } else {
            Copy-Item -Path $desde -Destination $hasta -Force
        }
    }

    # Los GeoJSON solo se copian si esta computadora no los tiene. Si ya estan,
    # se dejan: pueden ser una carga mas nueva que la publicada.
    $datosLocales = Join-Path $raiz "web\datos"
    $datosNuevos  = Join-Path $descomprimida.FullName "web\datos"
    if ((Test-Path $datosNuevos) -and (-not (Test-Path $datosLocales) -or
        ((Get-ChildItem $datosLocales -Filter *.json -EA SilentlyContinue).Count -eq 0))) {
        New-Item -ItemType Directory -Path $datosLocales -Force | Out-Null
        Copy-Item -Path (Join-Path $datosNuevos "*") -Destination $datosLocales -Recurse -Force
        Write-Host "        Se copiaron tambien los archivos del mapa."
    }

    Write-Host "        Aplicada."

    Write-Host "  [4/4] Verificando..."
    $versionDespues = if (Test-Path $rutaVersion) { (Get-Content $rutaVersion -Raw).Trim() } else { "desconocida" }

    Write-Host ""
    Write-Host "  ============================================================"
    if ($versionDespues -ne $versionAntes) {
        Write-Host "   ACTUALIZADO"
        Write-Host ""
        Write-Host "   Antes:  $versionAntes"
        Write-Host "   Ahora:  $versionDespues"
    } else {
        Write-Host "   YA ESTABA AL DIA (version $versionDespues)"
    }
    Write-Host ""
    Write-Host "   La configuracion de la base NO se toco."
    Write-Host "   Para usar el visor: doble clic en INICIAR.bat"
    Write-Host "  ============================================================"
    Write-Host ""
    exit 0

} catch {
    Write-Host ""
    Write-Host "  ============================================================"
    Write-Host "   NO SE PUDO ACTUALIZAR"
    Write-Host "  ============================================================"
    Write-Host ""
    Write-Host "   $($_.Exception.Message)"
    Write-Host ""
    Write-Host "   La causa mas comun es que esta computadora no tenga salida a"
    Write-Host "   internet. En ese caso hay que bajar el ZIP desde otra maquina:"
    Write-Host "     https://github.com/FacuChiza/Plataforma-MUNI"
    Write-Host "   y reemplazar los archivos a mano, SIN tocar servidor\.env"
    Write-Host ""
    Write-Host "   La instalacion actual quedo intacta."
    Write-Host ""
    exit 1

} finally {
    if (Test-Path $temporal) { Remove-Item $temporal -Recurse -Force -EA SilentlyContinue }
}
