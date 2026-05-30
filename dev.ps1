#requires -Version 5
<#
  dev.ps1 - launch both halves of the app in separate PowerShell windows:
    * backend  detector API + WebSocket   ->  http://localhost:5000
    * frontend React dev server           ->  http://localhost:3000

  First run sets up the Python venv (PyTorch is a large download) and npm deps.
#>
$ErrorActionPreference = 'Stop'
$root     = $PSScriptRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

$backendCmd = @"
Set-Location '$backend'
if (-not (Test-Path '.venv\Scripts\python.exe')) {
  Write-Host 'First run: creating venv + installing requirements (PyTorch is a large download)...' -ForegroundColor Yellow
  python -m venv .venv
  .\.venv\Scripts\python.exe -m pip install --upgrade pip
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}
Write-Host 'Starting detector backend on http://localhost:5000 ...' -ForegroundColor Cyan
.\.venv\Scripts\python.exe app.py
"@

$frontendCmd = @"
Set-Location '$frontend'
if (-not (Test-Path 'node_modules')) { npm install }
Write-Host 'Starting React frontend on http://localhost:3000 ...' -ForegroundColor Cyan
npm start
"@

Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd
Start-Sleep -Seconds 1
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd

Write-Host ''
Write-Host 'Launched:' -ForegroundColor Green
Write-Host '  backend  -> http://localhost:5000   (window 1)'
Write-Host '  frontend -> http://localhost:3000   (window 2, opens browser)'
Write-Host ''
Write-Host 'For phone / AR testing over HTTPS:  ngrok http 3000'
