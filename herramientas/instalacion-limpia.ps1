# =============================================================================
#  VISOR CATASTRAL - VILLA DE MERLO
#  Instalacion limpia en una carpeta, de una sola vez
# -----------------------------------------------------------------------------
#  QUE HACE
#    Descarga la ultima version, la instala en la carpeta indicada, instala los
#    componentes, abre la ventana de configuracion de la base y deja un acceso
#    directo en el escritorio. Al final avisa si quedaron copias viejas del
#    programa dando vueltas.
#
#  POR QUE
#    Bajar el ZIP y descomprimir a mano deja una carpeta nueva cada vez. Con
#    varias copias iguales es facil actualizar una y ejecutar otra, y entonces
#    los arreglos "no aparecen" aunque esten aplicados. Este camino instala en
#    un lugar definido y deja un unico acceso directo, para que no haya de
#    donde equivocarse.
#
#  USO
#    powershell -ExecutionPolicy Bypass -File instalacion-limpia.ps1
#    powershell -ExecutionPolicy Bypass -File instalacion-limpia.ps1 -Destino "C:\OtraCarpeta"
# =============================================================================

param(
    [string]$Destino = "C:\VisorCatastral"
)

$ErrorActionPreference = "Stop"
$origen = "https://github.com/FacuChiza/Plataforma-MUNI/archive/refs/heads/main.zip"

Write-Host ""
Write-Host "  ============================================================"
Write-Host "   VISOR CATASTRAL - VILLA DE MERLO"
Write-Host "   Instalacion limpia"
Write-Host "  ============================================================"
Write-Host ""
Write-Host "   Se va a instalar en:"
Write-Host "   $Destino"
Write-Host ""

# --- Node.js -----------------------------------------------------------------
Write-Host "  [1/6] Verificando Node.js..."
$node = Get-Command node -EA SilentlyContinue
if (-not $node) {
    Write-Host ""
    Write-Host "  Node.js no esta instalado en esta computadora."
    Write-Host "  Se baja gratis de https://nodejs.org (version LTS),"
    Write-Host "  se instala con las opciones por defecto, y se vuelve a"
    Write-Host "  ejecutar este script."
    Write-Host ""
    exit 1
}
Write-Host "        $(node --version) encontrado."

# --- Configuracion existente, si la hubiera ----------------------------------
# Si ya habia una instalacion ahi, se conserva su configuracion: es lo unico
# que no se puede volver a generar solo.
$envGuardado = $null
$envPrevio = Join-Path $Destino "servidor\.env"
if (Test-Path $envPrevio) {
    $envGuardado = Get-Content $envPrevio -Raw
    Write-Host "        Se encontro una configuracion anterior: se conserva."
}

# --- Descarga ----------------------------------------------------------------
Write-Host "  [2/6] Descargando la ultima version..."
$temporal = Join-Path $env:TEMP ("visor-" + [Guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $temporal -Force | Out-Null
$zip = Join-Path $temporal "programa.zip"

try {
    # TLS 1.2 explicito: en equipos con configuracion antigua la descarga desde
    # GitHub falla sin explicar el motivo.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $origen -OutFile $zip -UseBasicParsing
    Write-Host "        Descargada."

    Write-Host "  [3/6] Instalando los archivos..."
    Expand-Archive -Path $zip -DestinationPath $temporal -Force
    $contenido = Get-ChildItem -Path $temporal -Directory | Select-Object -First 1
    if (-not $contenido) { throw "El archivo descargado no tiene el contenido esperado." }

    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    Copy-Item -Path (Join-Path $contenido.FullName "*") -Destination $Destino -Recurse -Force
    Write-Host "        Instalados."

    # Devolver la configuracion anterior
    if ($envGuardado) {
        $sinBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $Destino "servidor\.env"), $envGuardado, $sinBom)
        Write-Host "        Configuracion anterior restaurada."
    }

} finally {
    if (Test-Path $temporal) { Remove-Item $temporal -Recurse -Force -EA SilentlyContinue }
}

# --- Componentes -------------------------------------------------------------
Write-Host "  [4/6] Instalando componentes (puede tardar unos minutos)..."
Push-Location (Join-Path $Destino "servidor")
try {
    & npm install --no-audit --no-fund 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm install fallo" }
    Write-Host "        Instalados."
} catch {
    Write-Host ""
    Write-Host "        No se pudieron instalar los componentes."
    Write-Host "        La causa mas comun es que la computadora no tenga"
    Write-Host "        salida a internet. Se bajan una sola vez."
    Write-Host ""
} finally {
    Pop-Location
}

# --- Configuracion de la base ------------------------------------------------
Write-Host "  [5/6] Configuracion de la base de datos..."
if (Test-Path (Join-Path $Destino "servidor\.env")) {
    Write-Host "        Ya hay una configuracion cargada."
    Write-Host "        Para cambiarla: CONFIGURAR.bat en la carpeta instalada."
} else {
    Write-Host "        Se abre la ventana para cargar los datos de conexion."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Destino "herramientas\configurar.ps1")
}

# --- Acceso directo ----------------------------------------------------------
Write-Host "  [6/6] Acceso directo en el escritorio..."
try {
    $enlace = Join-Path ([Environment]::GetFolderPath('Desktop')) "Visor Catastral.lnk"
    $shell  = New-Object -ComObject WScript.Shell
    $acceso = $shell.CreateShortcut($enlace)
    $acceso.TargetPath       = Join-Path $Destino "INICIAR.bat"
    $acceso.WorkingDirectory = $Destino
    $acceso.Description      = "Visor Catastral - Villa de Merlo"
    $acceso.Save()
    Write-Host "        Creado: 'Visor Catastral'"
} catch {
    Write-Host "        No se pudo crear: $($_.Exception.Message)"
}

# --- Copias viejas -----------------------------------------------------------
# El motivo por el que existe este script: avisar de lo que quedo dando vueltas.
Write-Host ""
Write-Host "  Buscando otras copias del programa..."
$otras = @()
foreach ($lugar in @("C:\", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Documents")) {
    if (-not (Test-Path $lugar)) { continue }
    Get-ChildItem -Path $lugar -Filter "INICIAR.bat" -Recurse -Depth 4 -EA SilentlyContinue |
        ForEach-Object {
            $d = $_.DirectoryName
            if ($d -ne $Destino) { $otras += $d }
        }
}
$otras = $otras | Sort-Object -Unique

$version = "desconocida"
$rutaVer = Join-Path $Destino "VERSION.txt"
if (Test-Path $rutaVer) { $version = (Get-Content $rutaVer -Raw).Trim() }

Write-Host ""
Write-Host "  ============================================================"
Write-Host "   INSTALADO - version $version"
Write-Host "  ============================================================"
Write-Host ""
Write-Host "   Carpeta: $Destino"
Write-Host "   Para usar el visor: el acceso directo del escritorio."
Write-Host ""

Write-Host "   Este visor usa el puerto 8001. El visor anterior usa el 8000,"
Write-Host "   asi que los dos pueden estar abiertos a la vez sin molestarse:"
Write-Host ""
Write-Host "     http://localhost:8000   visor anterior"
Write-Host "     http://localhost:8001   este"
Write-Host ""

if ($otras.Count -gt 0) {
    Write-Host "   Hay $($otras.Count) instalacion(es) mas en esta computadora:"
    Write-Host ""
    foreach ($o in $otras) { Write-Host "     $o" }
    Write-Host ""
    Write-Host "   NO BORRARLAS TODAVIA. Mientras este visor se este probando, el"
    Write-Host "   anterior tiene que seguir disponible: si algo aca no funciona,"
    Write-Host "   se sigue trabajando con el de siempre."
    Write-Host ""
    Write-Host "   Recien cuando este confirmado que este anda bien, y despues de"
    Write-Host "   un tiempo de uso, tiene sentido ordenar las carpetas."
}
Write-Host ""
Write-Host "  ============================================================"
Write-Host ""
