# Kiran Cable Management System (KCMS) - local start script
# Usage:  powershell -ExecutionPolicy Bypass -File .\start-kcms.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[KCMS] Starting Docker Desktop if needed..."
if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
}

Write-Host "[KCMS] Waiting for the Docker daemon..."
for ($i = 0; $i -lt 60; $i++) {
    docker info *> $null
    if ($?) { break }
    Start-Sleep -Seconds 5
}

Write-Host "[KCMS] Starting backend services (Postgres, Redis, RabbitMQ, MinIO, API, workers)..."
docker compose -f docker-compose-local.yml up -d

Write-Host "[KCMS] Waiting for the API on http://localhost:8000 ..."
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-WebRequest -Uri "http://localhost:8000/api/instances/" -UseBasicParsing -TimeoutSec 5 | Out-Null
        break
    } catch { Start-Sleep -Seconds 5 }
}

Write-Host "[KCMS] Starting the web apps (this takes a few minutes on first run)..."
Write-Host ""
Write-Host "  App          http://localhost:3000"
Write-Host "  Admin        http://localhost:3001/god-mode/"
Write-Host "  Public pages http://localhost:3002/spaces/"
Write-Host "  Live server  http://localhost:3100/live/"
Write-Host ""

pnpm dev
