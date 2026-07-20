param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("install", "upgrade", "rollback", "uninstall")]
  [string]$Operation,
  [string]$InstallRoot = $(if ($env:APEXCN_CLI_INSTALL_ROOT) { $env:APEXCN_CLI_INSTALL_ROOT } else { Join-Path $HOME ".apexcn\tools\apexcn-cli" }),
  [string]$BinDir = $(if ($env:APEXCN_CLI_BIN_DIR) { $env:APEXCN_CLI_BIN_DIR } else { Join-Path $HOME ".local\bin" }),
  [string]$BackupRoot = $(if ($env:APEXCN_CLI_BACKUP_ROOT) { $env:APEXCN_CLI_BACKUP_ROOT } else { Join-Path $HOME ".apexcn\backups\apexcn-cli" }),
  [string]$Backup,
  [string]$PackageUrl,
  [string]$ChecksumsUrl,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$installer = Join-Path $PSScriptRoot "install-agent.ps1"

function Get-CliRoot {
  foreach ($candidate in @($InstallRoot, (Join-Path $InstallRoot "cli"), (Join-Path $InstallRoot "package"))) {
    if (Test-Path (Join-Path $candidate "package.json")) { return $candidate }
  }
  throw "No existing apexcn-cli installation at $InstallRoot"
}

function Get-InstalledVersion {
  $package = Get-Content -Raw (Join-Path (Get-CliRoot) "package.json") | ConvertFrom-Json
  return [string]$package.version
}

function Write-Launcher {
  $root = Get-CliRoot
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $launcher = Join-Path $BinDir "apexcn.cmd"
  "@echo off`r`nnode `"$root\dist\index.js`" %*`r`n" | Set-Content -Encoding ASCII $launcher
}

function New-Backup {
  $version = Get-InstalledVersion
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $target = Join-Path $BackupRoot "$version-$stamp"
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
  Copy-Item -Recurse -Force $InstallRoot $target
  return $target
}

function Restore-Backup([string]$Source) {
  if (-not $Source) { throw "Rollback requires -Backup <path>." }
  $valid = (Test-Path (Join-Path $Source "package.json")) -or
    (Test-Path (Join-Path $Source "cli\package.json")) -or
    (Test-Path (Join-Path $Source "package\package.json"))
  if (-not $valid) { throw "Invalid apexcn-cli backup: $Source" }
  if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallRoot) | Out-Null
  Copy-Item -Recurse -Force $Source $InstallRoot
  Write-Launcher
  & (Join-Path $BinDir "apexcn.cmd") --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Rollback verification failed." }
}

function Invoke-Installer {
  $arguments = @{
    InstallRoot = $InstallRoot
    BinDir = $BinDir
  }
  if ($PackageUrl) { $arguments.PackageUrl = $PackageUrl }
  if ($ChecksumsUrl) { $arguments.ChecksumsUrl = $ChecksumsUrl }
  if ($Yes) { $arguments.Yes = $true }
  & $installer @arguments
  if ($LASTEXITCODE -ne 0) { throw "Installer failed with exit code $LASTEXITCODE" }
}

switch ($Operation) {
  "install" {
    Invoke-Installer
  }
  "upgrade" {
    Get-CliRoot | Out-Null
    $backupPath = New-Backup
    try {
      Invoke-Installer
      Write-Host "[apexcn-cli] Upgrade complete. Rollback backup: $backupPath"
    } catch {
      Write-Warning "[apexcn-cli] Upgrade failed; restoring $backupPath"
      Restore-Backup $backupPath
      throw
    }
  }
  "rollback" {
    if (-not $Yes) { throw "Rollback requires -Yes." }
    Restore-Backup $Backup
    Write-Host "[apexcn-cli] Rollback complete: $(Get-InstalledVersion)"
  }
  "uninstall" {
    if (-not $Yes) { throw "Uninstall requires -Yes." }
    $launcher = Join-Path $BinDir "apexcn.cmd"
    if ((Test-Path $launcher) -and ((Get-Content -Raw $launcher) -like "*dist\index.js*")) {
      Remove-Item -Force $launcher
    }
    if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
    Write-Host "[apexcn-cli] Uninstall complete. Auth configuration was preserved."
  }
}
