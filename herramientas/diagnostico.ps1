# =============================================================================
#  VISOR CATASTRAL - VILLA DE MERLO
#  Informe de diagnostico
# -----------------------------------------------------------------------------
#  Genera un informe con el estado real de ESTA instalacion: que version tiene,
#  desde que carpeta se ejecuta, que contienen los archivos y si los servidores
#  de mapas responden desde esta red.
#
#  Sirve para dejar de adivinar. Cuando algo "sigue sin andar" despues de
#  actualizar, las causas posibles son varias -carpeta equivocada, archivos a
#  medio reemplazar, un bloqueo de red- y desde afuera no hay forma de saber
#  cual es. Este informe lo dice.
#
#  El resultado se guarda en un archivo de texto y se abre solo.
# =============================================================================

$carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$raiz    = Split-Path -Parent $carpeta
$salida  = Join-Path $raiz "INFORME-DIAGNOSTICO.txt"
$lineas  = @()

function Agregar($texto) { $script:lineas += $texto }

Agregar "============================================================"
Agregar " INFORME DE DIAGNOSTICO - VISOR CATASTRAL"
Agregar " Generado el $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
Agregar "============================================================"
Agregar ""

# --- 1. Que instalacion es esta ----------------------------------------------
Agregar "1. ESTA INSTALACION"
Agregar "   Carpeta: $raiz"

$rutaVersion = Join-Path $raiz "VERSION.txt"
$version = if (Test-Path $rutaVersion) { (Get-Content $rutaVersion -Raw).Trim() } else { "NO EXISTE el archivo VERSION.txt" }
Agregar "   Version: $version"
Agregar ""

# --- 2. Contenido real de los archivos ---------------------------------------
# No alcanza con mirar la version: si alguien reemplazo unos archivos y otros
# no, la version puede ser nueva y el codigo viejo. Se revisa el contenido.
Agregar "2. QUE CONTIENEN LOS ARCHIVOS"

function Revisar($ruta, $marca, $descripcion) {
    $completa = Join-Path $raiz $ruta
    if (-not (Test-Path $completa)) {
        Agregar "   [FALTA]   $ruta"
        return
    }
    $texto = Get-Content $completa -Raw -EA SilentlyContinue
    $fecha = (Get-Item $completa).LastWriteTime.ToString('dd/MM/yyyy HH:mm')
    $tiene = $texto -match [regex]::Escape($marca)
    $estado = if ($tiene) { "SI " } else { "NO " }
    Agregar "   $estado  $descripcion   ($ruta, $fecha)"
}

Revisar "web\js\app.js"      "basemaps.cartocdn"      "mapa de calles nuevo (CARTO)"
Revisar "web\js\app.js"      "PROPORCION_MARCO_MAPA"  "plancheta nueva"
Revisar "web\js\app.js"      "tabla-titulares"        "plancheta con varios titulares"
Revisar "web\index.html"     "__VERSION__"            "version visible en el visor"
Revisar "servidor\server.js" "index: false"           "version automatica de archivos"
Revisar "servidor\server.js" "strict-origin"          "politica de referencia"
Agregar ""

# --- 3. Hay mas de una instalacion? ------------------------------------------
# La causa mas comun de "actualice y sigue igual" es que se actualizo una
# carpeta y se ejecuta otra.
Agregar "3. OTRAS COPIAS DEL PROGRAMA EN ESTA COMPUTADORA"
$encontradas = @()
foreach ($base in @("C:\", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Documents")) {
    if (-not (Test-Path $base)) { continue }
    try {
        Get-ChildItem -Path $base -Filter "INICIAR.bat" -Recurse -Depth 3 -EA SilentlyContinue |
            ForEach-Object { $encontradas += $_.DirectoryName }
    } catch { }
}
$encontradas = $encontradas | Sort-Object -Unique
if ($encontradas.Count -le 1) {
    Agregar "   Solo esta instalacion. Bien."
} else {
    Agregar "   ATENCION: hay $($encontradas.Count) copias del programa."
    Agregar "   Si se actualiza una y se ejecuta otra, los cambios no aparecen."
    foreach ($e in $encontradas) {
        $v = Join-Path $e "VERSION.txt"
        $ver = if (Test-Path $v) { (Get-Content $v -Raw).Trim() } else { "sin version" }
        $marca = if ($e -eq $raiz) { "  <-- ESTA" } else { "" }
        Agregar "     [$ver]  $e$marca"
    }
}
Agregar ""

# --- 4. El servidor esta corriendo? ------------------------------------------
Agregar "4. SERVIDOR"
# INICIAR.bat elige el primer puerto libre de esta lista, asi que hay que
# probarlos todos: no hay un numero fijo. El 8000 se prueba aparte y solo para
# avisar, porque ese es el del VISOR ANTERIOR.
$encontrado = $false
foreach ($p in @(8001, 8002, 8003, 8010, 8020, 8080, 8090, 3000, 3001, 5000)) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$p/health" -UseBasicParsing -TimeoutSec 3
        Agregar "   Responde en http://localhost:$p"
        Agregar "   $($r.Content)"
        $encontrado = $true
        break
    } catch { }
}
if (-not $encontrado) {
    Agregar "   No responde en ningun puerto (el visor no esta abierto en este momento)."
    Agregar "   Para incluir este dato: abrir INICIAR.bat y volver a ejecutar el diagnostico."
}

try {
    Invoke-WebRequest -Uri "http://localhost:8000/" -UseBasicParsing -TimeoutSec 3 | Out-Null
    Agregar ""
    Agregar "   Nota: el puerto 8000 tambien esta ocupado. Ese es el VISOR ANTERIOR."
    Agregar "   Es correcto que siga funcionando. Pero si al abrir localhost:8000 se ve"
    Agregar "   el visor de siempre, no es que la actualizacion no haya servido: hay que"
    Agregar "   entrar al puerto que dice la ventana negra de este visor."
} catch { }
Agregar ""

# --- 5. Los servidores de mapas responden desde esta red? --------------------
# Un firewall municipal puede dejar pasar unos dominios y bloquear otros.
Agregar "5. SERVIDORES DE MAPAS (desde esta red)"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Las teselas de prueba caen sobre Villa de Merlo. Ninguno de estos servicios
# pide clave ni cuenta: si alguno FALLA, es que esta red no lo deja salir.
$mapas = [ordered]@{
    "Esri (calles, el que usa primero)"  = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/13/4872/2616"
    "CARTO (calles, primer respaldo)"    = "https://a.basemaps.cartocdn.com/rastertiles/voyager/13/2616/4872.png"
    "OpenStreetMap (ultimo respaldo)"    = "https://a.tile.openstreetmap.org/13/2616/4872.png"
    "Esri (topografia)"                  = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/13/4872/2616"
    "Google (satelital)"                 = "https://mt1.google.com/vt/lyrs=s&x=2616&y=4872&z=13"
}
$callesOk = $false
foreach ($m in $mapas.GetEnumerator()) {
    try {
        $res = Invoke-WebRequest -Uri $m.Value -UseBasicParsing -TimeoutSec 10
        Agregar "   OK ($($res.StatusCode))   $($m.Key)"
        if ($m.Key -like "*calles*") { $callesOk = $true }
    } catch {
        $codigo = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "sin respuesta" }
        Agregar "   FALLA ($codigo)   $($m.Key)"
    }
}
if (-not $callesOk) {
    Agregar ""
    Agregar "   >>> Ningun mapa de calles responde desde esta red."
    Agregar "       Por eso el mapa se ve gris. NO falta ninguna clave ni licencia:"
    Agregar "       hay que pedirle a sistemas que permita el acceso a"
    Agregar "       server.arcgisonline.com"
    Agregar "       Las parcelas, los filtros y las planchetas funcionan igual:"
    Agregar "       salen de archivos de esta misma computadora."
}
Agregar ""

Agregar "============================================================"
Agregar " Pasar este archivo completo para poder ver que esta pasando."
Agregar "============================================================"

$lineas | Set-Content -Path $salida -Encoding UTF8
$lineas | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "  Informe guardado en:"
Write-Host "  $salida"
Write-Host ""

Start-Process notepad $salida
