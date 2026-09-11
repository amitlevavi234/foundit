# Repair Docker Desktop when it refuses to start on Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\fix-docker-sockets.ps1
#
# THE PROBLEM
# Docker Desktop creates AF_UNIX socket files on Windows as reparse points. If
# it is killed rather than shut down — a crash, a forced restart, a laptop lid
# closing at the wrong moment — those files are left behind in a state Windows
# cannot open. Then Docker will not start, because starting means binding the
# socket, and binding means deleting the old one first:
#
#   starting services: initializing Secrets Engine: listening on
#   ...\docker-secrets-engine\engine.sock: remove ...engine.sock:
#   The file cannot be accessed by the system.
#
# The file cannot be deleted. del, Remove-Item and even
# `fsutil reparsepoint delete` all fail with error 1920. But the FOLDER
# containing it can be renamed, because renaming a directory does not require
# opening what is inside it. Docker then creates a clean one.
#
# Rebooting does not fix this. The files survive a reboot; that is the point of
# a filesystem.
#
# Nothing here touches images, containers or volumes. It moves runtime socket
# folders aside. Do not use "Reset to factory defaults" for this — that does
# delete your images and containers, and it is the button Docker's own error
# dialog offers you.
#
# This file is saved with a UTF-8 byte-order mark on purpose. Windows
# PowerShell 5.1 reads a BOM-less script as the system code page, where the em
# dashes in these messages decode to a sequence ending in a curly quote, which
# PowerShell takes as the end of the string. The script then fails to parse at
# all — which is what it looked like when Docker was the thing that was broken.

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$folders = @(
  "$env:LOCALAPPDATA\docker-secrets-engine",   # engine.sock — the Secrets Engine
  "$env:LOCALAPPDATA\Docker\run"               # dockerInference and friends
)

Write-Host 'Stopping Docker...'
Get-Process 'Docker Desktop','com.docker.backend','com.docker.build','docker' `
  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6

foreach ($f in $folders) {
  if (-not (Test-Path $f)) { Write-Host "  $f — not there, nothing to do"; continue }

  # Only act on folders that actually contain a stuck reparse point. A healthy
  # runtime folder is left alone.
  $stuck = Get-ChildItem $f -Force -ErrorAction SilentlyContinue |
           Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
  if (-not $stuck) { Write-Host "  $f — clean"; continue }

  $aside = "$f.orphaned-$stamp"
  try {
    Rename-Item -LiteralPath $f -NewName (Split-Path $aside -Leaf) -ErrorAction Stop
    New-Item -ItemType Directory -Path $f -Force | Out-Null
    Write-Host "  $f — moved aside ($($stuck.Count) stuck file(s)), fresh folder created"
  } catch {
    Write-Warning "  $f — could not rename: $($_.Exception.Message)"
    Write-Warning '  Something still has it open. Sign out of Windows and run this again.'
  }
}

Write-Host 'Starting Docker Desktop...'
Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

Write-Host 'Waiting for the engine (up to 4 minutes)...'
$deadline = (Get-Date).AddMinutes(4)
do {
  Start-Sleep -Seconds 10
  $v = docker version --format '{{.Server.Version}}' 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Host "Docker engine is up: $v"; exit 0 }
} while ((Get-Date) -lt $deadline)

Write-Warning "Still not up. Last error: $v"
Write-Warning 'Read the real reason with:'
Write-Warning '  Select-String -Path "$env:LOCALAPPDATA\Docker\log\host\com.docker.backend.exe.log" -Pattern ''"error":"starting services'' | Select-Object -Last 1'
exit 1
