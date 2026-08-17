# start.ps1 — one-command launcher for the Binance chart app.
# Run from any shell:   powershell -ExecutionPolicy Bypass -File .\start.ps1
# Or double-click if PowerShell execution policy allows it.

$ErrorActionPreference = 'Stop'

# Move into the script's own directory so it works no matter where
# it's invoked from.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "==> Footprint Trader — local launcher" -ForegroundColor Cyan
Write-Host "    $ScriptDir" -ForegroundColor DarkGray

# First-run guard: install deps if node_modules is missing.
if (-not (Test-Path -Path 'node_modules' -PathType Container)) {
  Write-Host "`n==> Installing dependencies (first run only)..." -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`n!! npm install failed. See output above." -ForegroundColor Red
    exit 1
  }
}

# Pre-flight build to surface any TypeScript errors before starting the
# dev server. Skipped if the user just wants a quick run — comment out
# the next 4 lines to disable.
# Write-Host "`n==> Type-checking..." -ForegroundColor Yellow
# npx tsc --noEmit
# if ($LASTEXITCODE -ne 0) {
#   Write-Host "`n!! TypeScript errors. See output above." -ForegroundColor Red
#   exit 1
# }

# Start the dev server in the background and open the browser once it's
# serving. Vite picks the next free port if 5173 is taken.
$port = 5173
Write-Host "`n==> Starting Vite dev server on http://localhost:$port" -ForegroundColor Green
Write-Host "    Press Ctrl+C in this window to stop.`n" -ForegroundColor DarkGray

# Launch the dev server (this will block until the user cancels).
npm run dev
