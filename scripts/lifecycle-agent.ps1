param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("install", "upgrade", "rollback", "uninstall")]
  [string]$Operation,
  [string]$InstallRoot,
  [string]$BinDir,
  [string]$BackupRoot = $(if ($env:APEXCN_CLI_BACKUP_ROOT) { $env:APEXCN_CLI_BACKUP_ROOT } else { Join-Path $HOME ".apexcn\backups\apexcn-cli" }),
  [string]$Backup,
  [string]$PackageUrl,
  [string]$ChecksumsUrl,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$installer = Join-Path $PSScriptRoot "install-agent.ps1"
$sourceRoot = Split-Path -Parent $PSScriptRoot
$installRootMarker = Join-Path $sourceRoot ".apexcn-install-root"
$binDirMarker = Join-Path $sourceRoot ".apexcn-bin-dir"
if (-not $InstallRoot) {
  $InstallRoot = if ($env:APEXCN_CLI_INSTALL_ROOT) { $env:APEXCN_CLI_INSTALL_ROOT } elseif (Test-Path $installRootMarker) { (Get-Content -Raw $installRootMarker).Trim() } else { Join-Path $HOME ".apexcn\tools\apexcn-cli" }
}
if (-not $BinDir) {
  $BinDir = if ($env:APEXCN_CLI_BIN_DIR) { $env:APEXCN_CLI_BIN_DIR } elseif (Test-Path $binDirMarker) { (Get-Content -Raw $binDirMarker).Trim() } else { Join-Path $HOME ".local\bin" }
}

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

function Compare-Version([string]$Left, [string]$Right) {
  $compareScript = @'
const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
};
const [left, right] = process.argv.slice(1).map(parse);
for (let index = 0; index < 3; index += 1) {
  if (left[index] !== right[index]) {
    process.stdout.write(left[index] < right[index] ? "-1" : "1");
    process.exit(0);
  }
}
process.stdout.write("0");
'@
  $result = & node -e $compareScript $Left $Right
  if ($LASTEXITCODE -ne 0) { throw "Unable to compare lifecycle versions." }
  return [int]$result
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
  $env:APEXCN_CLI_INSTALL_ROOT = $InstallRoot
  $env:APEXCN_CLI_BIN_DIR = $BinDir
  if ($PackageUrl) { $env:APEXCN_CLI_PACKAGE_URL = $PackageUrl }
  if ($ChecksumsUrl) { $env:APEXCN_CLI_CHECKSUMS_URL = $ChecksumsUrl }
  & $installer
  if ($LASTEXITCODE -ne 0) { throw "Installer failed with exit code $LASTEXITCODE" }
}

switch ($Operation) {
  "install" {
    Invoke-Installer
  }
  "upgrade" {
    Get-CliRoot | Out-Null
    $previousVersion = Get-InstalledVersion
    $backupPath = New-Backup
    try {
      Invoke-Installer
      $newVersion = Get-InstalledVersion
      if ((Compare-Version $newVersion $previousVersion) -lt 0) {
        throw "Refusing downgrade from $previousVersion to $newVersion."
      }
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
