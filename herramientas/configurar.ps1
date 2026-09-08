# =============================================================================
#  VISOR CATASTRAL - VILLA DE MERLO
#  Ventana de configuracion de la conexion a la base de datos
# -----------------------------------------------------------------------------
#  Reemplaza al Bloc de notas: campos con nombre, contrasena oculta y un boton
#  para probar la conexion antes de guardar, parecido al cuadro de conexion de
#  SQL Server Management Studio.
#
#  Usa Windows Forms, que ya viene incluido en Windows: no hay nada que
#  instalar.
#
#  SOBRE EL ESCALADO DE PANTALLA
#    La ventana NO usa posiciones fijas. Muchas computadoras tienen el escalado
#    de Windows al 125% o 150%, y con coordenadas fijas los controles de abajo
#    -los botones- terminan quedando fuera de la ventana, con lo cual no se
#    puede guardar nada. Con contenedores que se acomodan solos
#    (TableLayoutPanel) y la ventana en AutoSize, entra bien con cualquier
#    escalado.
#
#  CODIGOS DE SALIDA
#    0 = se guardo la configuracion
#    1 = el usuario cancelo
# =============================================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# $PSScriptRoot queda vacio si el script no se ejecuta con -File (por ejemplo,
# si alguien pega su contenido en una consola). Sin esta salvaguarda, la ruta
# del .env se arma mal y el archivo se escribiria en cualquier lado.
$carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $carpeta) { $carpeta = (Get-Location).Path }

$raiz    = Split-Path -Parent $carpeta
$rutaEnv = Join-Path $raiz "servidor\.env"

if (-not (Test-Path (Join-Path $raiz "servidor"))) {
    [void][System.Windows.Forms.MessageBox]::Show(
        "No se encontro la carpeta del servidor.`n`nEste archivo tiene que quedar dentro de la carpeta herramientas del programa.",
        "Ubicacion incorrecta",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}

# --- Valores actuales, si ya hay configuracion -------------------------------
# Al reconfigurar, los campos aparecen con lo que ya estaba cargado: es mas
# facil corregir un dato que volver a escribir los cuatro.
$actual = @{ DB_SERVER = ""; DB_DATABASE = ""; DB_USER = ""; DB_PASSWORD = "" }
if (Test-Path $rutaEnv) {
    foreach ($linea in Get-Content $rutaEnv -Encoding UTF8) {
        $t = $linea.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $clave = $t.Substring(0, $i).Trim()
        $valor = $t.Substring($i + 1).Trim()
        if ($actual.ContainsKey($clave) -and $valor -ne "completar") { $actual[$clave] = $valor }
    }
}

$verde = [System.Drawing.Color]::FromArgb(6, 78, 59)

# --- Ventana -----------------------------------------------------------------
$form                 = New-Object System.Windows.Forms.Form
$form.Text            = "Visor Catastral - Conexion a la base de datos"
$form.StartPosition   = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox     = $false
$form.MinimizeBox     = $false
$form.BackColor       = [System.Drawing.Color]::White
$form.Font            = New-Object System.Drawing.Font("Segoe UI", 9)
$form.AutoSize        = $true
$form.AutoSizeMode    = "GrowAndShrink"
$form.Padding         = New-Object System.Windows.Forms.Padding(0, 0, 0, 12)

# Contenedor vertical: encabezado, campos, ayuda, estado y botones
$pila              = New-Object System.Windows.Forms.TableLayoutPanel
$pila.ColumnCount  = 1
$pila.AutoSize     = $true
$pila.AutoSizeMode = "GrowAndShrink"
$pila.Dock         = "Fill"
$form.Controls.Add($pila)

# --- Encabezado --------------------------------------------------------------
$cabecera           = New-Object System.Windows.Forms.Panel
$cabecera.BackColor = $verde
$cabecera.AutoSize  = $true
$cabecera.Dock      = "Fill"
$cabecera.Padding   = New-Object System.Windows.Forms.Padding(16, 12, 16, 12)
$cabecera.Margin    = New-Object System.Windows.Forms.Padding(0, 0, 0, 14)

$textoCab              = New-Object System.Windows.Forms.TableLayoutPanel
$textoCab.ColumnCount  = 1
$textoCab.AutoSize     = $true
$textoCab.AutoSizeMode = "GrowAndShrink"
$textoCab.Dock         = "Fill"

$titulo           = New-Object System.Windows.Forms.Label
$titulo.Text      = "Conexion a la base de datos municipal"
$titulo.ForeColor = [System.Drawing.Color]::White
$titulo.Font      = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$titulo.AutoSize  = $true
$textoCab.Controls.Add($titulo)

$subtitulo           = New-Object System.Windows.Forms.Label
$subtitulo.Text      = "Si no tenes estos datos, pediselos a quien administre el sistema"
$subtitulo.ForeColor = [System.Drawing.Color]::FromArgb(167, 243, 208)
$subtitulo.AutoSize  = $true
$subtitulo.Margin    = New-Object System.Windows.Forms.Padding(3, 2, 3, 0)
$textoCab.Controls.Add($subtitulo)

$cabecera.Controls.Add($textoCab)
$pila.Controls.Add($cabecera)

# --- Campos ------------------------------------------------------------------
$tabla              = New-Object System.Windows.Forms.TableLayoutPanel
$tabla.ColumnCount  = 2
$tabla.AutoSize     = $true
$tabla.AutoSizeMode = "GrowAndShrink"
$tabla.Margin       = New-Object System.Windows.Forms.Padding(16, 0, 16, 0)
[void]$tabla.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::AutoSize)))
[void]$tabla.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::AutoSize)))

function Agregar-Campo($etiqueta, $valor, $esClave) {
    $lbl          = New-Object System.Windows.Forms.Label
    $lbl.Text     = $etiqueta
    $lbl.AutoSize = $true
    $lbl.Anchor   = "Left"
    $lbl.Margin   = New-Object System.Windows.Forms.Padding(3, 8, 12, 8)
    $tabla.Controls.Add($lbl)

    $txt        = New-Object System.Windows.Forms.TextBox
    $txt.Text   = $valor
    $txt.Width  = 250
    $txt.Margin = New-Object System.Windows.Forms.Padding(3, 5, 3, 5)
    if ($esClave) { $txt.UseSystemPasswordChar = $true }
    $tabla.Controls.Add($txt)
    return $txt
}

$txtServidor = Agregar-Campo "Nombre del servidor"  $actual.DB_SERVER   $false
$txtBase     = Agregar-Campo "Nombre de la base"    $actual.DB_DATABASE $false
$txtUsuario  = Agregar-Campo "Nombre de usuario"    $actual.DB_USER     $false
$txtClave    = Agregar-Campo "Contrasena"           $actual.DB_PASSWORD $true

$pila.Controls.Add($tabla)

# --- Ayuda y estado ----------------------------------------------------------
$ayuda           = New-Object System.Windows.Forms.Label
$ayuda.Text      = "El servidor se puede indicar por su nombre de equipo o por su direccion IP."
$ayuda.ForeColor = [System.Drawing.Color]::Gray
$ayuda.AutoSize  = $true
$ayuda.Margin    = New-Object System.Windows.Forms.Padding(19, 6, 16, 0)
$pila.Controls.Add($ayuda)

$estado          = New-Object System.Windows.Forms.Label
$estado.Text     = ""
$estado.AutoSize = $false
$estado.Height   = 36
$estado.Width    = 420
$estado.Margin   = New-Object System.Windows.Forms.Padding(19, 8, 16, 0)
$pila.Controls.Add($estado)

# --- Guardar -----------------------------------------------------------------
function Guardar-Configuracion {
    # Se parte de la plantilla para conservar los comentarios y las opciones que
    # el usuario no toca (puerto, limites, modo de prueba).
    $plantilla = Join-Path $raiz "servidor\.env.example"
    $lineas = @()
    if (Test-Path $plantilla)   { $lineas = Get-Content $plantilla -Encoding UTF8 }
    elseif (Test-Path $rutaEnv) { $lineas = Get-Content $rutaEnv -Encoding UTF8 }

    $nuevos = @{
        "DB_SERVER"   = $txtServidor.Text.Trim()
        "DB_DATABASE" = $txtBase.Text.Trim()
        "DB_USER"     = $txtUsuario.Text.Trim()
        "DB_PASSWORD" = $txtClave.Text
    }

    $salida = @(); $puestos = @{}
    foreach ($linea in $lineas) {
        $t = $linea.Trim(); $reemplazada = $false
        if ($t -ne "" -and -not $t.StartsWith("#")) {
            $i = $t.IndexOf("=")
            if ($i -gt 0) {
                $clave = $t.Substring(0, $i).Trim()
                if ($nuevos.ContainsKey($clave)) {
                    $salida += "$clave=$($nuevos[$clave])"
                    $puestos[$clave] = $true
                    $reemplazada = $true
                }
            }
        }
        if (-not $reemplazada) { $salida += $linea }
    }
    foreach ($clave in $nuevos.Keys) {
        if (-not $puestos.ContainsKey($clave)) { $salida += "$clave=$($nuevos[$clave])" }
    }

    # Sin BOM: Node lee el .env como texto plano, y un BOM le ensucia la primera
    # variable, que suele ser justamente el nombre del servidor.
    $sinBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($rutaEnv, ($salida -join "`r`n") + "`r`n", $sinBom)
}

function Campos-Completos {
    if ($txtServidor.Text.Trim() -eq "" -or $txtBase.Text.Trim() -eq "" -or
        $txtUsuario.Text.Trim()  -eq "" -or $txtClave.Text -eq "") {
        [void][System.Windows.Forms.MessageBox]::Show(
            "Hay que completar los cuatro campos.", "Faltan datos",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning)
        return $false
    }
    return $true
}

# --- Botones -----------------------------------------------------------------
$fila               = New-Object System.Windows.Forms.FlowLayoutPanel
$fila.AutoSize      = $true
$fila.AutoSizeMode  = "GrowAndShrink"
$fila.FlowDirection = "LeftToRight"
$fila.Margin        = New-Object System.Windows.Forms.Padding(16, 4, 16, 0)

function Nuevo-Boton($texto, $ancho) {
    $b           = New-Object System.Windows.Forms.Button
    $b.Text      = $texto
    $b.Width     = $ancho
    $b.Height    = 30
    $b.FlatStyle = "System"
    $b.Margin    = New-Object System.Windows.Forms.Padding(0, 0, 8, 0)
    return $b
}

$btnProbar   = Nuevo-Boton "Probar conexion" 120
$btnGuardar  = Nuevo-Boton "Guardar"          95
$btnCancelar = Nuevo-Boton "Cancelar"         95

$fila.Controls.Add($btnProbar)
$fila.Controls.Add($btnGuardar)
$fila.Controls.Add($btnCancelar)
$pila.Controls.Add($fila)

# Probar guarda primero y despues corre el mismo diagnostico que usa la
# instalacion, para que lo que se prueba sea exactamente lo que va a quedar.
$btnProbar.Add_Click({
    if (-not (Campos-Completos)) { return }
    $estado.ForeColor = [System.Drawing.Color]::Gray
    $estado.Text = "Probando la conexion..."
    $form.Refresh()

    Guardar-Configuracion
    $salida = & node (Join-Path $PSScriptRoot "probar-conexion.js") 2>&1

    if ($LASTEXITCODE -eq 0) {
        $estado.ForeColor = [System.Drawing.Color]::FromArgb(4, 120, 87)
        $estado.Text = "Conexion correcta. La base respondio."
    } else {
        $estado.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
        $motivo = $salida | Select-String -Pattern "Failed to connect|Login failed|no se resuelve|rechaza el usuario" | Select-Object -First 1
        if ($motivo) { $estado.Text = "No se pudo conectar. " + $motivo.ToString().Trim() }
        else { $estado.Text = "No se pudo conectar. Revisar los datos, o si la computadora esta en la red municipal." }
    }
})

$btnGuardar.Add_Click({
    if (-not (Campos-Completos)) { return }
    Guardar-Configuracion
    $form.Tag = "guardado"
    $form.Close()
})

$btnCancelar.Add_Click({
    $form.Tag = "cancelado"
    $form.Close()
})

$form.AcceptButton = $btnGuardar
$form.CancelButton = $btnCancelar
$form.Add_Shown({ $txtServidor.Select() })

[void]$form.ShowDialog()

if ($form.Tag -eq "guardado") { exit 0 } else { exit 1 }
