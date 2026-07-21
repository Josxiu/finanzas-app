# =====================================================================
# Despliegue de Finanzas App con clasp (ejecutar desde esta carpeta)
#   1) clasp login (solo la primera vez, abre el navegador)
#   2) Vincula el proyecto a la hoja (solo la primera vez)
#   3) clasp push (cada vez que cambie el codigo)
# =====================================================================

$SHEET_ID = 'TU_ID_DE_HOJA_AQUI'
Set-Location $PSScriptRoot

# --- 0. Sanidad del manifiesto --------------------------------------
# Si quedo un respaldo de una corrida interrumpida, restaurarlo.
if (Test-Path 'appsscript.json.mio') {
    Write-Host "Restaurando appsscript.json desde el respaldo .mio..." -ForegroundColor Yellow
    if (Test-Path 'appsscript.json') { Remove-Item 'appsscript.json' -Force }
    Move-Item -Force 'appsscript.json.mio' 'appsscript.json'
}
# Nunca subir un manifiesto pisado por clasp create (paso una vez: la zona
# quedo en New York y la grafica de meses se corrio y julio desaparecio).
$manifiesto = Get-Content 'appsscript.json' -Raw
if ($manifiesto -notmatch 'America/Bogota' -or $manifiesto -notmatch '"webapp"') {
    Write-Host "ERROR: appsscript.json no tiene timeZone America/Bogota o el bloque webapp." -ForegroundColor Red
    Write-Host "Restauralo desde git (git checkout appsscript.json) antes de subir." -ForegroundColor Red
    exit 1
}

# --- 1. Login -------------------------------------------------------
$usuario = clasp show-authorized-user 2>&1
if ("$usuario" -match 'Not logged in') {
    Write-Host "Abriendo el navegador para iniciar sesion en Google..." -ForegroundColor Yellow
    Write-Host "(Si falla, activa primero la API en https://script.google.com/home/usersettings)"
    clasp login
    if ($LASTEXITCODE -ne 0) { Write-Host "Login fallo. Revisa el navegador." -ForegroundColor Red; exit 1 }
} else {
    Write-Host "Sesion activa: $usuario" -ForegroundColor Green
}

# --- 2. Crear/vincular el proyecto (solo si no existe .clasp.json) ---
if (-not (Test-Path '.clasp.json')) {
    Write-Host "Creando proyecto Apps Script vinculado a la hoja..." -ForegroundColor Yellow
    # clasp create se niega si ya existe appsscript.json: lo apartamos un momento
    Move-Item 'appsscript.json' 'appsscript.json.mio'
    clasp create --title 'Finanzas App' --parentId $SHEET_ID --rootDir .
    $ok = (Test-Path '.clasp.json')
    # Restauramos NUESTRO manifiesto (timezone Bogota + config de web app)
    if (Test-Path 'appsscript.json') { Remove-Item 'appsscript.json' -Force }
    Move-Item -Force 'appsscript.json.mio' 'appsscript.json'
    if (-not $ok) { Write-Host "clasp create fallo (API de Apps Script activada?)." -ForegroundColor Red; exit 1 }
}

# --- 3. Subir el código ---------------------------------------------
Write-Host "Subiendo archivos con clasp push..." -ForegroundColor Yellow
clasp push -f
if ($LASTEXITCODE -ne 0) {
    Write-Host "clasp push fallo." -ForegroundColor Red
    exit 1
}
Write-Host "OK: codigo subido." -ForegroundColor Green

# --- 4. Redesplegar: apuntar la URL /exec a una version nueva ---------
# (sin esto, la app sigue sirviendo la version anterior)
$linea = clasp list-deployments 2>&1 | Select-String '@\d+\s*$' | Select-Object -First 1
if ($linea -and ("$linea" -match '(AKfycb[\w-]+)')) {
    $id = $Matches[1]
    Write-Host "Redesplegando $id a una version nueva..." -ForegroundColor Yellow
    clasp update-deployment $id
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nListo: recarga la app en el celular/PC y ya veras los cambios." -ForegroundColor Green
    } else {
        Write-Host "El redespliegue fallo; hazlo en el editor: Implementar > Administrar implementaciones > editar > Version: Nueva." -ForegroundColor Red
    }
} else {
    Write-Host "`nNo hay implementacion todavia (primera vez). En el editor:" -ForegroundColor Yellow
    Write-Host "  clasp open-script   -> abre el editor"
    Write-Host "  Implementar > Nueva implementacion > Aplicacion web"
    Write-Host "  Ejecutar como: Yo | Acceso: Solo yo -> Implementar"
}
