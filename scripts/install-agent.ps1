param(
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$InstallCodexSkill,
  [string]$SourceDir = "",
  [string]$PackageUrl = $(if ($env:APEXCN_CLI_PACKAGE_URL) { $env:APEXCN_CLI_PACKAGE_URL } else { "https://oracleapex.cn/cli/apexcn-cli.tgz" }),
  [string]$Repo = $(if ($env:APEXCN_CLI_REPO) { $env:APEXCN_CLI_REPO } else { "" }),
  [string]$Ref = $(if ($env:APEXCN_CLI_REF) { $env:APEXCN_CLI_REF } else { "main" }),
  [string]$InstallRoot = $(if ($env:APEXCN_CLI_INSTALL_ROOT) { $env:APEXCN_CLI_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "apexcn\tools\apexcn-cli" }),
  [string]$BinDir = $(if ($env:APEXCN_CLI_BIN_DIR) { $env:APEXCN_CLI_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "apexcn\bin" }),
  [string]$Profile = $(if ($env:APEXCN_CLI_PROFILE) { $env:APEXCN_CLI_PROFILE } else { "agent-prod" }),
  [string]$BaseUrl = $(if ($env:APEXCN_CLI_BASE_URL) { $env:APEXCN_CLI_BASE_URL } else { "https://oracleapex.cn/ords/api" }),
  [string]$Token = $(if ($env:APEXCN_API_KEY) { $env:APEXCN_API_KEY } else { "" })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:APEXCN_CLI_YES -eq "1") { $Yes = $true }
if ($env:APEXCN_CLI_DRY_RUN -eq "1") { $DryRun = $true }
if ($env:APEXCN_CLI_INSTALL_CODEX_SKILL -eq "1") { $InstallCodexSkill = $true }
$UseGit = $false
if ($env:APEXCN_CLI_REPO -or $env:APEXCN_CLI_REF) { $UseGit = $true }

function Write-Step {
  param([string]$Message)
  Write-Host "[apexcn-cli] $Message"
}

function Invoke-AgentCommand {
  param([string[]]$Command)
  if ($DryRun) {
    Write-Step ("DRY-RUN: " + ($Command -join " "))
  } else {
    & $Command[0] @($Command | Select-Object -Skip 1)
  }
}

function Test-CommandExists {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-Dependency {
  param([string]$CommandName, [string]$PackageName)
  if (Test-CommandExists $CommandName) { return }
  if (-not $Yes) {
    throw "$CommandName is missing. Re-run with -Yes or install it manually first."
  }
  if (Test-CommandExists "winget") {
    Invoke-AgentCommand @("winget", "install", "--id", $PackageName, "--silent", "--accept-source-agreements", "--accept-package-agreements")
  } elseif (Test-CommandExists "choco") {
    Invoke-AgentCommand @("choco", "install", $PackageName, "-y")
  } else {
    throw "No supported package manager found to install $CommandName. Install it manually, then rerun this script."
  }
}

function Download-File {
  param([string]$Url, [string]$Target)
  if ($DryRun) {
    Write-Step "DRY-RUN: would download $Url to $Target"
    return
  }
  Invoke-WebRequest -Uri $Url -OutFile $Target
}

function Prepare-Source {
  if ($SourceDir) {
    $packagePath = Join-Path $SourceDir "package.json"
    if (-not (Test-Path $packagePath)) {
      throw "-SourceDir must point to apexcn-cli repo root."
    }
    Write-Step "Using local source: $SourceDir"
    if ($DryRun) {
      Write-Step "DRY-RUN: would copy $SourceDir to $InstallRoot"
      return
    }
    if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    Copy-Item -Recurse -Force (Join-Path $SourceDir "*") $InstallRoot
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $InstallRoot ".git")
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $InstallRoot "node_modules")
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $InstallRoot "dist")
    return
  }

  if (-not $UseGit) {
    if (-not (Test-CommandExists "tar")) {
      throw "tar is missing. Install bsdtar or use -Repo for Git-based installation."
    }
    $parent = Split-Path -Parent $InstallRoot
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("apexcn-cli-" + [guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $tempDir "apexcn-cli.tgz"
    Write-Step "Downloading apexcn-cli package: $PackageUrl"
    if ($DryRun) {
      Write-Step "DRY-RUN: would create $parent and $InstallRoot"
      Write-Step "DRY-RUN: would extract $archivePath into $InstallRoot"
      return
    }
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Download-File $PackageUrl $archivePath
    if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    & tar -xzf $archivePath -C $InstallRoot
    if ($LASTEXITCODE -ne 0) { throw "Package extraction failed." }
    Remove-Item -Recurse -Force $tempDir
    if (-not (Test-Path (Join-Path $InstallRoot "package.json"))) {
      throw "Downloaded package does not contain package.json."
    }
    return
  }

  if (-not $Repo) { $Repo = "https://github.com/wfg2513148/apexcn-cli.git" }
  Install-Dependency "git" "Git.Git"
  $parent = Split-Path -Parent $InstallRoot
  if ($DryRun) {
    Write-Step "DRY-RUN: would create $parent"
  } else {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  if (Test-Path (Join-Path $InstallRoot ".git")) {
    Invoke-AgentCommand @("git", "-C", $InstallRoot, "fetch", "--all", "--tags", "--prune")
    Invoke-AgentCommand @("git", "-C", $InstallRoot, "checkout", $Ref)
    Invoke-AgentCommand @("git", "-C", $InstallRoot, "pull", "--ff-only")
  } elseif (Test-Path $InstallRoot) {
    throw "$InstallRoot exists but is not a git checkout. Move it away or pass -InstallRoot."
  } else {
    Invoke-AgentCommand @("git", "clone", "--depth", "1", "--branch", $Ref, $Repo, $InstallRoot)
  }
}

function Build-Cli {
  Install-Dependency "node" "OpenJS.NodeJS.LTS"
  Install-Dependency "npm" "OpenJS.NodeJS.LTS"
  $cliRoot = $InstallRoot
  if ($DryRun) {
    Write-Step "DRY-RUN: cd $cliRoot && npm ci"
    Write-Step "DRY-RUN: cd $cliRoot && npm run build"
    return
  }

  Push-Location $cliRoot
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) {
      & npm install
      if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    }
    # Equivalent command: npm run build
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  } finally {
    Pop-Location
  }
}

function Install-Launcher {
  if ($DryRun) {
    Write-Step "DRY-RUN: would create launcher $BinDir\apexcn.cmd"
    return
  }
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $cmdPath = Join-Path $BinDir "apexcn.cmd"
  $entry = Join-Path $InstallRoot "dist\index.js"
  "@echo off`r`nnode `"$entry`" %*`r`n" | Set-Content -Path $cmdPath -Encoding ASCII
}

function Install-CodexSkill {
  if (-not $InstallCodexSkill) { return }
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
  $skillDir = Join-Path $codexHome "skills\apexcn-cli"
  if ($DryRun) {
    Write-Step "DRY-RUN: would install Codex skill to $skillDir"
    return
  }
  New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
  Copy-Item -Force (Join-Path $InstallRoot "agent-skill\SKILL.md") (Join-Path $skillDir "SKILL.md")
}

function Configure-Auth {
  if (-not $Token) {
    Write-Step "APEXCN_API_KEY not provided; skipping auth configuration."
    return
  }
  Write-Step "Configuring apexcn auth profile '$Profile' without printing the API key."
  $apexcn = Join-Path $BinDir "apexcn.cmd"
  if ($DryRun) {
    Write-Step "DRY-RUN: $apexcn auth set-token --profile $Profile --base-url $BaseUrl --token [redacted]"
    return
  }
  & $apexcn auth set-token --profile $Profile --base-url $BaseUrl --token $Token | Out-Null
}

function Verify-Install {
  $apexcn = Join-Path $BinDir "apexcn.cmd"
  if ($DryRun) {
    Write-Step "DRY-RUN: would run $apexcn --help"
    if ($Token) { Write-Step "DRY-RUN: would run $apexcn me --json" }
    return
  }
  & $apexcn --help | Out-Null
  if ($Token) { & $apexcn me --json | Out-Null }
}

Write-Step "Installing apexcn-cli for AI agent use."
Prepare-Source
Build-Cli
Install-Launcher
Install-CodexSkill
Configure-Auth
Verify-Install

Write-Host ""
Write-Host "apexcn-cli installation complete."
Write-Host "Launcher: $BinDir\apexcn.cmd"
Write-Host "Installed source: $InstallRoot"
Write-Host "Recommended next check:"
Write-Host "  apexcn auth show --json"
Write-Host "  apexcn me --json"
Write-Host ""
Write-Host "If your shell cannot find apexcn, add this directory to PATH:"
Write-Host "  $BinDir"
