$ErrorActionPreference = "Stop"

if ($args.Count -ne 0) {
  [Console]::Error.WriteLine("[apexcn-cli] install-agent.ps1 takes no arguments.")
  exit 2
}

[string]$PackageUrl = $(if ($env:APEXCN_CLI_PACKAGE_URL) { $env:APEXCN_CLI_PACKAGE_URL } else { "https://github.com/wfg2513148/apexcn-cli/releases/latest/download/apexcn-cli.tgz" })
$ChecksumsUrl = if ($env:APEXCN_CLI_CHECKSUMS_URL) { $env:APEXCN_CLI_CHECKSUMS_URL } else { $PackageUrl.Substring(0, $PackageUrl.LastIndexOf("/") + 1) + "checksums.txt" }
$InstallRoot = if ($env:APEXCN_CLI_INSTALL_ROOT) { $env:APEXCN_CLI_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "apexcn/tools/apexcn-cli" }
$BinDir = if ($env:APEXCN_CLI_BIN_DIR) { $env:APEXCN_CLI_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "apexcn/bin" }
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("apexcn-cli-" + [guid]::NewGuid())

function Write-Step([string]$Message) {
  Write-Host "[apexcn-cli] $Message"
}

function Receive-File([string]$Url, [string]$Target) {
  if ($Url.StartsWith("file://")) {
    Copy-Item ([uri]$Url).LocalPath $Target
    return
  }
  $lastError = $null
  foreach ($attempt in 1..5) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $Target -UseBasicParsing
      return
    } catch {
      $lastError = $_
      if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
    }
  }
  throw $lastError
}

try {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js 20 or newer is required." }
  $nodeMajor = & node -e 'process.stdout.write(process.versions.node.split(".")[0])'
  if ([int]$nodeMajor -lt 20) { throw "Node.js 20 or newer is required." }

  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  $Archive = Join-Path $TempDir "apexcn-cli.tgz"
  $Checksums = Join-Path $TempDir "checksums.txt"
  Write-Step "Downloading apexcn-cli package: $PackageUrl"
  Receive-File $PackageUrl $Archive
  try {
    Receive-File $ChecksumsUrl $Checksums
  } catch {
    throw "Unable to download checksums.txt."
  }
  $line = Get-Content $Checksums | Where-Object { $_ -match '\*?apexcn-cli\.tgz$' } | Select-Object -First 1
  if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64})\s+\*?apexcn-cli\.tgz$') {
    throw "checksums.txt has no valid apexcn-cli.tgz checksum."
  }
  $Expected = $Matches[1].ToLowerInvariant()
  $Actual = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "Checksum verification failed for apexcn-cli.tgz." }
  Write-Step "Verified package checksum."

  Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  & tar -xzf $Archive -C $InstallRoot
  if ($LASTEXITCODE -ne 0) { throw "Unable to extract apexcn-cli.tgz." }
  $CliRoot = $InstallRoot
  if (-not (Test-Path (Join-Path $CliRoot "package.json"))) { $CliRoot = Join-Path $InstallRoot "package" }
  if (-not (Test-Path (Join-Path $CliRoot "dist/index.js"))) { throw "Downloaded package is missing dist/index.js." }
  if (-not (Test-Path (Join-Path $CliRoot "node_modules/commander"))) { throw "Downloaded package is missing runtime dependencies." }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $Launcher = Join-Path $BinDir "apexcn.cmd"
  "@echo off`r`nnode `"$CliRoot\dist\index.js`" %*`r`n" | Set-Content -Encoding Ascii $Launcher

  foreach ($SkillRoot in @(
    (Join-Path $HOME ".agents/skills"),
    (Join-Path $HOME ".codex/skills"),
    (Join-Path $HOME ".config/opencode/skills")
  )) {
    $SkillTarget = Join-Path $SkillRoot "apexcn-cli"
    Remove-Item -Recurse -Force $SkillTarget -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $SkillRoot | Out-Null
    Copy-Item -Recurse (Join-Path $CliRoot "agent-skill") $SkillTarget
  }

  $Resolved = (Get-Command apexcn -ErrorAction SilentlyContinue).Source
  if ($Resolved -and $Resolved -ne $Launcher) {
    if ((Test-Path $Resolved) -and ((Get-Content -Raw $Resolved) -like "*dist*index.js*")) {
      Copy-Item -Force $Launcher $Resolved
      Write-Step "Updated shell-resolved launcher: $Resolved"
    } else {
      [Console]::Error.WriteLine("[apexcn-cli] Add $BinDir to PATH before older apexcn launchers.")
    }
  }

  $Version = & node (Join-Path $CliRoot "dist/index.js") --version
  if ($LASTEXITCODE -ne 0) { throw "Installed launcher verification failed." }
  Write-Step "Installed apexcn-cli $Version."
  Write-Host ""
  Write-Host "apexcn-cli installation complete."
  Write-Host ""
  Write-Host "Launcher:"
  Write-Host "  $Launcher"
  Write-Host ""
  Write-Host "Installed source:"
  Write-Host "  $CliRoot"
  Write-Host ""
  Write-Host "Authentication is configured after installation:"
  Write-Host '  apexcn -apikey "YOUR_API_KEY"'
  Write-Host "  apexcn me --json"
  Write-Host ""
  Write-Host "If your shell cannot find apexcn, add $BinDir to PATH."
} catch {
  [Console]::Error.WriteLine("[apexcn-cli] $($_.Exception.Message)")
  exit 1
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
