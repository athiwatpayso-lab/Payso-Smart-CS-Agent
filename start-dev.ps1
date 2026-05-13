param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outLog = Join-Path $projectRoot ".codex-dev.out.log"
$errLog = Join-Path $projectRoot ".codex-dev.err.log"
$portWindow = @($Port, ($Port + 1), ($Port + 2), ($Port + 3), ($Port + 4))

Write-Host "Project root: $projectRoot" -ForegroundColor Cyan
Write-Host "Stopping existing Next.js dev servers for this project..." -ForegroundColor Yellow

$projectProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and
    $_.CommandLine -like "*$projectRoot*" -and
    $_.CommandLine -like "*next*start-server.js*"
  }

foreach ($process in $projectProcesses) {
  try {
    Write-Host "Stopping node PID $($process.ProcessId)" -ForegroundColor Yellow
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
  catch {
    Write-Host "Could not stop PID $($process.ProcessId): $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}

Write-Host "Checking ports $($portWindow -join ', ')..." -ForegroundColor Yellow

foreach ($candidatePort in $portWindow) {
  $connections = Get-NetTCPConnection -State Listen -LocalPort $candidatePort -ErrorAction SilentlyContinue

  foreach ($conn in $connections) {
    if ($conn.OwningProcess -and ($conn.OwningProcess -notin $projectProcesses.ProcessId)) {
      try {
        $owner = Get-Process -Id $conn.OwningProcess -ErrorAction Stop
        Write-Host "Port $candidatePort is in use by $($owner.ProcessName) PID $($conn.OwningProcess)." -ForegroundColor Red
      }
      catch {
        Write-Host "Port $candidatePort is in use by PID $($conn.OwningProcess)." -ForegroundColor Red
      }
    }
  }
}

if (Test-Path (Join-Path $projectRoot ".next")) {
  Write-Host "Removing .next cache..." -ForegroundColor Yellow
  Remove-Item -LiteralPath (Join-Path $projectRoot ".next") -Recurse -Force
}

Remove-Item -LiteralPath $outLog -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $errLog -Force -ErrorAction SilentlyContinue

Write-Host "Starting Next.js dev server on http://localhost:$Port ..." -ForegroundColor Green

$process = Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev", "--", "--hostname", "0.0.0.0", "--port", "$Port") `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

$ready = $false

for ($attempt = 1; $attempt -le 30; $attempt++) {
  Start-Sleep -Seconds 1

  if ($process.HasExited) {
    Write-Host "Dev server exited unexpectedly. Check $errLog" -ForegroundColor Red
    exit 1
  }

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port" -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      $ready = $true
      break
    }
  }
  catch {
    if (Test-Path $outLog) {
      $logTail = Get-Content -Path $outLog -Tail 20 -ErrorAction SilentlyContinue
      if ($logTail -match "Ready in") {
        $ready = $true
        break
      }
    }
  }
}

if (-not $ready) {
  Write-Host "Dev server did not become ready in time." -ForegroundColor Red
  Write-Host "Standard output: $outLog" -ForegroundColor DarkYellow
  Write-Host "Standard error:  $errLog" -ForegroundColor DarkYellow
  exit 1
}

Write-Host "Dev server is ready." -ForegroundColor Green
Write-Host "URL: http://localhost:$Port" -ForegroundColor Green
Write-Host "PID: $($process.Id)" -ForegroundColor Green
Write-Host "Logs: $outLog and $errLog" -ForegroundColor Cyan
