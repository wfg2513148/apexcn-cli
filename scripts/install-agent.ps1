param(
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$InstallCodexSkill,
  [switch]$InstallAgentSkills,
  [string]$SourceDir = "",
  [string]$PackageUrl = $(if ($env:APEXCN_CLI_PACKAGE_URL) { $env:APEXCN_CLI_PACKAGE_URL } else { "https://github.com/wfg2513148/apexcn-cli/releases/download/v0.4.0/apexcn-cli.tgz" }),
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
if ($env:APEXCN_CLI_INSTALL_AGENT_SKILLS -eq "1") { $InstallAgentSkills = $true }
$UseGit = $false
if ($env:APEXCN_CLI_REPO -or $env:APEXCN_CLI_REF) { $UseGit = $true }
$InstalledAgentSkillDirs = @()
$CurrentAgentSkillInstalled = $false

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

function Get-CliRoot {
  $rootPackage = Join-Path $InstallRoot "package.json"
  if (Test-Path $rootPackage) { return $InstallRoot }
  $nestedRoot = Join-Path $InstallRoot "cli"
  $nestedPackage = Join-Path $nestedRoot "package.json"
  if (Test-Path $nestedPackage) { return $nestedRoot }
  $npmRoot = Join-Path $InstallRoot "package"
  $npmPackage = Join-Path $npmRoot "package.json"
  if (Test-Path $npmPackage) { return $npmRoot }
  throw "Installed files do not contain package.json at $InstallRoot, $nestedRoot, or $npmRoot."
}

function Get-SkillSourcePath {
  if ($DryRun -and $SourceDir) {
    $rootSkill = Join-Path $SourceDir "agent-skill\SKILL.md"
    if (Test-Path $rootSkill) { return $rootSkill }
    $nestedSkill = Join-Path $SourceDir "cli\agent-skill\SKILL.md"
    if (Test-Path $nestedSkill) { return $nestedSkill }
  }
  $cliRoot = Get-CliRoot
  return Join-Path $cliRoot "agent-skill\SKILL.md"
}

function Prepare-Source {
  if ($SourceDir) {
    $packagePath = Join-Path $SourceDir "package.json"
    $nestedPackagePath = Join-Path $SourceDir "cli\package.json"
    if ((-not (Test-Path $packagePath)) -and (-not (Test-Path $nestedPackagePath))) {
      throw "-SourceDir must point to apexcn-cli repo root."
    }
    Write-Step "Using local source: $SourceDir"
    if ($DryRun) {
      Write-Step "DRY-RUN: would copy $SourceDir to $InstallRoot"
      return
    }
    if ((Test-Path $packagePath) -and (-not (Test-Path $nestedPackagePath)) -and (Test-Path (Join-Path $InstallRoot "cli"))) {
      Remove-Item -Recurse -Force (Join-Path $InstallRoot "cli")
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
    Get-CliRoot | Out-Null
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
  $cliRoot = if ($DryRun) { $InstallRoot } else { Get-CliRoot }
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
  Write-Launcher $cmdPath (Get-CliRoot)
}

function Write-Launcher {
  param([string]$LauncherPath, [string]$CliRoot)
  $entry = Join-Path $CliRoot "dist\index.js"
  $rootEntry = Join-Path $InstallRoot "dist\index.js"
  $nestedEntry = Join-Path (Join-Path $InstallRoot "cli") "dist\index.js"
  @"
@echo off
if exist "$entry" node "$entry" %*
if exist "$entry" exit /b %ERRORLEVEL%
if exist "$rootEntry" node "$rootEntry" %*
if exist "$rootEntry" exit /b %ERRORLEVEL%
if exist "$nestedEntry" node "$nestedEntry" %*
if exist "$nestedEntry" exit /b %ERRORLEVEL%
echo apexcn-cli launcher cannot find dist\index.js under $InstallRoot 1>&2
exit /b 127
"@ | Set-Content -Path $LauncherPath -Encoding ASCII
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
  Copy-Item -Force (Get-SkillSourcePath) (Join-Path $skillDir "SKILL.md")
  $script:InstalledAgentSkillDirs += $skillDir
}

function Test-AgentTool {
  param([string]$Name, [string[]]$Markers)
  if (Test-CommandExists $Name) { return $true }
  foreach ($marker in $Markers) {
    if (Test-Path $marker) { return $true }
  }
  return $false
}

function Confirm-AgentSkillInstall {
  param([string]$ToolName, [string]$SkillDir)
  if ($InstallAgentSkills -or $Yes) { return $true }
  try {
    $answer = Read-Host "[apexcn-cli] Detected $ToolName. Install apexcn-cli skill to $SkillDir? [y/N]"
  } catch {
    Write-Step "Detected $ToolName. Re-run with -InstallAgentSkills to install the apexcn-cli skill to $SkillDir."
    return $false
  }
  return $answer -in @("y", "Y", "yes", "YES")
}

function Install-AgentSkillToDir {
  param([string]$ToolName, [string]$SkillDir)
  if (-not (Confirm-AgentSkillInstall $ToolName $SkillDir)) { return }
  Copy-AgentSkillToDir $SkillDir
}

function Test-AgentSkillDirInstalled {
  param([string]$SkillDir)
  return $script:InstalledAgentSkillDirs -contains $SkillDir
}

function Copy-AgentSkillToDir {
  param([string]$SkillDir)
  if (Test-AgentSkillDirInstalled $SkillDir) { return }
  if ($DryRun) {
    Write-Step "DRY-RUN: would install agent skill to $SkillDir"
  } else {
    New-Item -ItemType Directory -Force -Path $SkillDir | Out-Null
    Copy-Item -Force (Get-SkillSourcePath) (Join-Path $SkillDir "SKILL.md")
  }
  $script:InstalledAgentSkillDirs += $SkillDir
}

function Install-CurrentAgentSkillToDir {
  param([string]$SkillDir)
  Copy-AgentSkillToDir $SkillDir
  $script:CurrentAgentSkillInstalled = $true
}

function Normalize-AgentName {
  param([string]$Name)
  $agent = $Name.ToLowerInvariant()
  if ($agent -in @("codex", "claude", "opencode", "workbuddy", "codebuddy", "qcoder", "qoder")) {
    return $agent
  }
  return ""
}

function Test-CurrentAgentOptOut {
  if (-not $env:APEXCN_CLI_CURRENT_AGENT) { return $false }
  $agent = [string]$env:APEXCN_CLI_CURRENT_AGENT
  return ($agent.ToLowerInvariant() -eq "none")
}

function Get-CurrentAgentFromProcessTree {
  $processId = $PID
  for ($depth = 0; $depth -lt 12 -and $processId; $depth++) {
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
    } catch {
      return ""
    }
    $name = [string]$process.Name
    $name = $name.ToLowerInvariant()
    if ($name.Contains("codex")) { return "codex" }
    if ($name.Contains("claude")) { return "claude" }
    if ($name.Contains("opencode")) { return "opencode" }
    if ($name.Contains("workbuddy")) { return "workbuddy" }
    if ($name.Contains("codebuddy")) { return "codebuddy" }
    if ($name.Contains("qcoder")) { return "qcoder" }
    if ($name.Contains("qoder")) { return "qoder" }
    $processId = $process.ParentProcessId
  }
  return ""
}

function Get-CurrentAgentTool {
  if (Test-CurrentAgentOptOut) {
    return ""
  }

  if ($env:APEXCN_CLI_CURRENT_AGENT) {
    $agent = Normalize-AgentName $env:APEXCN_CLI_CURRENT_AGENT
    if ($agent) { return $agent }
  }
  if ($env:CODEX_SHELL -or $env:CODEX_HOME) { return "codex" }
  if ($env:CLAUDE_HOME -or $env:CLAUDECODE -or $env:CLAUDE_CODE) { return "claude" }
  if ($env:OPENCODE_HOME -or $env:OPENCODE) { return "opencode" }
  if ($env:WORKBUDDY_HOME) { return "workbuddy" }
  if ($env:CODEBUDDY_HOME) { return "codebuddy" }
  if ($env:QODER_HOME -or $env:QCODER_HOME) { return "qcoder" }
  return Get-CurrentAgentFromProcessTree
}

function Install-CurrentAgentSkill {
  $agent = Get-CurrentAgentTool
  if (-not $agent) { return }

  Write-Step "Detected current AI tool: $agent. Installing apexcn-cli skill for this user."
  switch ($agent) {
    "codex" {
      $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
      Install-CurrentAgentSkillToDir (Join-Path $codexHome "skills\apexcn-cli")
      Install-CurrentAgentSkillToDir (Join-Path (Join-Path $HOME ".agents") "skills\apexcn-cli")
    }
    "claude" {
      $claudeHome = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME ".claude" }
      Install-CurrentAgentSkillToDir (Join-Path $claudeHome "skills\apexcn-cli")
    }
    "opencode" {
      $configHome = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME ".config" }
      Install-CurrentAgentSkillToDir (Join-Path (Join-Path $configHome "opencode") "skills\apexcn-cli")
    }
    "workbuddy" {
      $workbuddyHome = if ($env:WORKBUDDY_HOME) { $env:WORKBUDDY_HOME } else { Join-Path $HOME ".workbuddy" }
      Install-CurrentAgentSkillToDir (Join-Path $workbuddyHome "skills\apexcn-cli")
    }
    "codebuddy" {
      $codebuddyHome = if ($env:CODEBUDDY_HOME) { $env:CODEBUDDY_HOME } else { Join-Path $HOME ".codebuddy" }
      Install-CurrentAgentSkillToDir (Join-Path $codebuddyHome "skills\apexcn-cli")
    }
    { $_ -in @("qcoder", "qoder") } {
      $qoderHome = if ($env:QODER_HOME) { $env:QODER_HOME } elseif ($env:QCODER_HOME) { $env:QCODER_HOME } else { Join-Path $HOME ".qoder-cn" }
      Install-CurrentAgentSkillToDir (Join-Path $qoderHome "skills\apexcn-cli")
    }
  }
}

function Install-DetectedAgentToolSkill {
  param([string]$ToolName, [string[]]$SkillDirs, [string[]]$Markers)
  if (-not (Test-AgentTool $ToolName $Markers)) { return }
  if ($SkillDirs.Count -eq 0) {
    Write-Step ("Detected {0}, but no known skill directory is configured." -f $ToolName)
    return
  }
  foreach ($skillDir in $SkillDirs) {
    Install-AgentSkillToDir $ToolName $skillDir
  }
}

function Install-AgentSkills {
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
  $claudeHome = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME ".claude" }
  $configHome = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME ".config" }
  $opencodeHome = Join-Path $configHome "opencode"
  $workbuddyHome = Join-Path $HOME ".workbuddy"
  $codebuddyHome = Join-Path $HOME ".codebuddy"
  $qoderHome = Join-Path $HOME ".qoder-cn"

  Install-DetectedAgentToolSkill "codex" @(
    Join-Path $codexHome "skills\apexcn-cli"
    Join-Path (Join-Path $HOME ".agents") "skills\apexcn-cli"
  ) @($codexHome)
  Install-DetectedAgentToolSkill "claude" @(
    Join-Path $claudeHome "skills\apexcn-cli"
  ) @($claudeHome)
  Install-DetectedAgentToolSkill "opencode" @(
    Join-Path $opencodeHome "skills\apexcn-cli"
  ) @($opencodeHome)
  Install-DetectedAgentToolSkill "workbuddy" @(
    Join-Path $workbuddyHome "skills\apexcn-cli"
  ) @($workbuddyHome)
  Install-DetectedAgentToolSkill "codebuddy" @(
    Join-Path $codebuddyHome "skills\apexcn-cli"
  ) @($codebuddyHome)
  if ((Test-AgentTool "qcoder" @($qoderHome)) -or (Test-AgentTool "qoder" @($qoderHome))) {
    Install-AgentSkillToDir "qcoder" (Join-Path $qoderHome "skills\apexcn-cli")
  }
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
    Repair-ShellLauncher
    Test-ShellLauncher
    if ($Token) { Write-Step "DRY-RUN: would run $apexcn me --json" }
    return
  }
  & $apexcn --help | Out-Null
  Repair-ShellLauncher
  Test-ShellLauncher
  if ($Token) {
    & $apexcn auth show --json | Out-Null
    & $apexcn me --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Step "Auth profile saved, but account check failed. Run: apexcn me --json"
    }
  }
}

function Repair-ShellLauncher {
  $expected = Join-Path $BinDir "apexcn.cmd"
  $command = Get-Command "apexcn" -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command "apexcn.cmd" -ErrorAction SilentlyContinue
  }
  if ((-not $command) -or ($command.Source -eq $expected)) { return }
  if ((-not $Yes) -or (Test-LooksLikeApexcnCli $command.Source)) { return }
  if (-not (Test-LauncherFileLooksLikeApexcnCli $command.Source)) { return }

  Write-Step "Replacing shadowing apexcn launcher: $($command.Source)"
  if ($DryRun) {
    Write-Step "DRY-RUN: would replace $($command.Source) with launcher for $(Get-CliRoot)"
    return
  }
  Remove-Item -Force $command.Source
  Write-Launcher $command.Source (Get-CliRoot)
}

function Test-ShellLauncher {
  $expected = Join-Path $BinDir "apexcn.cmd"
  $command = Get-Command "apexcn" -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command "apexcn.cmd" -ErrorAction SilentlyContinue
  }
  if (-not $command) {
    Write-Step "apexcn is not on PATH yet. Add this directory before README examples: $BinDir"
    return
  }
  if (Test-LooksLikeApexcnCli $command.Source) {
    if ($command.Source -ne $expected) {
      Write-Step "Your shell currently resolves apexcn to an existing apexcn-cli launcher: $($command.Source)"
    }
    return
  }
  if ($command.Source -ne $expected) {
    Write-Step "WARNING: your shell currently resolves apexcn to $($command.Source), not $expected."
    Write-Step "Add this directory before README examples: $BinDir"
  }
}

function Test-LooksLikeApexcnCli {
  param([string]$Launcher)
  try {
    $help = & $Launcher --help 2>$null
  } catch {
    return $false
  }
  return (($help -join "`n") -like "*topic|thread*")
}

function Test-LauncherFileLooksLikeApexcnCli {
  param([string]$Launcher)
  if (-not (Test-Path -PathType Leaf $Launcher)) { return $false }
  try {
    $text = Get-Content -Raw -Path $Launcher
  } catch {
    return $false
  }
  return ($text -like "*apexcn-cli*" -and (($text -like "*dist\index.js*") -or ($text -like "*dist/index.js*")))
}

Write-Step "Installing apexcn-cli for AI agent use."
Prepare-Source
Build-Cli
Install-Launcher
Install-CodexSkill
Install-CurrentAgentSkill
if ($InstallAgentSkills -or ((-not (Test-CurrentAgentOptOut)) -and ((-not $CurrentAgentSkillInstalled) -or $Yes))) {
  Install-AgentSkills
}
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
if ($InstalledAgentSkillDirs.Count -gt 0) {
  Write-Host ""
  Write-Host "Agent skill installed under:"
  foreach ($skillDir in $InstalledAgentSkillDirs) {
    Write-Host "  $skillDir"
  }
}
