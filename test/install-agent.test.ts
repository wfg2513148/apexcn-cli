import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const repoRoot = join(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('agent one-click installer assets', () => {
  test('macOS/Linux installer supports agent-safe automation', () => {
    const script = readRepoFile('scripts/install-agent.sh');

    expect(script).toContain('--dry-run');
    expect(script).toContain('--install-codex-skill');
    expect(script).toContain('--install-agent-skills');
    expect(script).toContain('APEXCN_API_KEY');
    expect(script).toContain('https://oracleapex.cn/ords/api');
    expect(script).toContain('https://github.com/wfg2513148/apexcn-cli/releases/latest/download/apexcn-cli.tgz');
    expect(script).toContain('--package-url');
    expect(script).toContain('Downloading apexcn-cli package');
    expect(script).toContain('cli_root');
    expect(script).toContain('check_shell_launcher');
    expect(script).toContain('repair_shell_launcher');
    expect(script).toContain('auth set-token');
    expect(script).toContain('npm run build');
    expect(script).toContain('use_git=1');
    expect(script).not.toContain('feature/apexcn-cli-ords-api');
  });

  test('macOS/Linux installer can copy the skill into detected AI agent tools', () => {
    const script = readRepoFile('scripts/install-agent.sh');

    expect(script).toContain('detect_agent_tool');
    expect(script).toContain('install_agent_skills');
    expect(script).toContain('install_current_agent_skill');
    expect(script).toContain('APEXCN_CLI_CURRENT_AGENT');
    expect(script).not.toContain('Optional current AI agent override: codex');
    expect(script).toContain('prompt_install_agent_skill');
    expect(script).toContain('codex');
    expect(script).toContain('claude');
    expect(script).toContain('opencode');
    expect(script).toContain('workbuddy');
    expect(script).toContain('qcoder');
    expect(script).toContain('$HOME/.agents/skills/apexcn-cli');
    expect(script).toContain('CLAUDE_HOME:-$HOME/.claude');
    expect(script).toContain('${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/apexcn-cli');
    expect(script).toContain('$HOME/.workbuddy/skills/apexcn-cli');
    expect(script).toContain('$HOME/.codebuddy/skills/apexcn-cli');
    expect(script).toContain('$HOME/.qoder-cn/skills/apexcn-cli');
  });

  test('Windows installer supports agent-safe automation', () => {
    const script = readRepoFile('scripts/install-agent.ps1');

    expect(script).toContain('DryRun');
    expect(script).toContain('InstallCodexSkill');
    expect(script).toContain('InstallAgentSkills');
    expect(script).toContain('APEXCN_API_KEY');
    expect(script).toContain('https://oracleapex.cn/ords/api');
    expect(script).toContain('https://github.com/wfg2513148/apexcn-cli/releases/latest/download/apexcn-cli.tgz');
    expect(script).toContain('PackageUrl');
    expect(script).toContain('Downloading apexcn-cli package');
    expect(script).toContain('Get-CliRoot');
    expect(script).toContain('Test-ShellLauncher');
    expect(script).toContain('auth set-token');
    expect(script).toContain('npm run build');
    expect(script).toContain('else { "main" }');
    expect(script).not.toContain('feature/apexcn-cli-ords-api');
  });

  test('Windows installer can copy the skill into detected AI agent tools', () => {
    const script = readRepoFile('scripts/install-agent.ps1');

    expect(script).toContain('Test-AgentTool');
    expect(script).toContain('Install-AgentSkills');
    expect(script).toContain('Install-CurrentAgentSkill');
    expect(script).toContain('APEXCN_CLI_CURRENT_AGENT');
    expect(script).toContain('Confirm-AgentSkillInstall');
    expect(script).toContain('codex');
    expect(script).toContain('claude');
    expect(script).toContain('opencode');
    expect(script).toContain('workbuddy');
    expect(script).toContain('qcoder');
    expect(script).toContain('.agents');
    expect(script).toContain('.claude');
    expect(script).toContain('opencode');
    expect(script).toContain('.workbuddy');
    expect(script).toContain('.codebuddy');
    expect(script).toContain('.qoder-cn');
  });

  test('macOS/Linux installer defaults skill installation to the current AI tool', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'apexcn-agent-install-'));
    const home = join(tempRoot, 'home');
    mkdirSync(home);

    try {
      const output = execFileSync(
        'bash',
        [
          join(repoRoot, 'scripts/install-agent.sh'),
          '--source-dir',
          repoRoot,
          '--install-root',
          join(tempRoot, 'install'),
          '--bin-dir',
          join(tempRoot, 'bin'),
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            APEXCN_CLI_DRY_RUN: '1',
            CODEX_SHELL: '1',
            HOME: home,
          },
          encoding: 'utf8',
        },
      );

      expect(output).toContain('Detected current AI tool: codex');
      expect(output).toContain(join(home, '.codex/skills/apexcn-cli'));
      expect(output).toContain(join(home, '.agents/skills/apexcn-cli'));
      expect(output).not.toContain('Re-run with --install-agent-skills');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('macOS/Linux installer warns when another apexcn command shadows the launcher', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'apexcn-shadow-install-'));
    const fakeBin = join(tempRoot, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeApexcn = join(fakeBin, 'apexcn');
    writeFileSync(fakeApexcn, '#!/usr/bin/env sh\nexit 0\n');
    chmodSync(fakeApexcn, 0o755);

    try {
      const output = execFileSync(
        'bash',
        [
          join(repoRoot, 'scripts/install-agent.sh'),
          '--source-dir',
          repoRoot,
          '--install-root',
          join(tempRoot, 'install'),
          '--bin-dir',
          join(tempRoot, 'bin'),
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            APEXCN_CLI_DRY_RUN: '1',
            PATH: `${fakeBin}:${process.env.PATH}`,
          },
          encoding: 'utf8',
        },
      );

      expect(output).toContain('WARNING: your shell currently resolves apexcn to');
      expect(output).toContain('Run this before README examples');
      expect(output).toContain(`export PATH="${join(tempRoot, 'bin')}:$PATH"`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('macOS/Linux installer can replace a shadowing apexcn symlink with --yes', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'apexcn-shadow-repair-'));
    const fakeBin = join(tempRoot, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeTarget = join(fakeBin, 'apex-cli');
    writeFileSync(fakeTarget, '#!/usr/bin/env sh\nexit 0\n');
    chmodSync(fakeTarget, 0o755);
    symlinkSync(fakeTarget, join(fakeBin, 'apexcn'));

    try {
      const output = execFileSync(
        'bash',
        [
          join(repoRoot, 'scripts/install-agent.sh'),
          '--source-dir',
          repoRoot,
          '--install-root',
          join(tempRoot, 'install'),
          '--bin-dir',
          join(tempRoot, 'bin'),
          '--yes',
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            APEXCN_CLI_DRY_RUN: '1',
            PATH: `${fakeBin}:${process.env.PATH}`,
          },
          encoding: 'utf8',
        },
      );

      expect(output).toContain('Replacing shadowing apexcn launcher');
      expect(output).toContain('DRY-RUN: would replace');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('macOS/Linux installer keeps the auth profile when account check fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'apexcn-auth-install-'));
    const home = join(tempRoot, 'home');
    mkdirSync(home, { recursive: true });

    try {
      const output = execFileSync(
        'bash',
        [
          join(repoRoot, 'scripts/install-agent.sh'),
          '--source-dir',
          repoRoot,
          '--install-root',
          join(tempRoot, 'install'),
          '--bin-dir',
          join(tempRoot, 'bin'),
          '--yes',
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: home,
            APEXCN_API_KEY: 'abcdefghijklmnopqrstuvwxyz',
            APEXCN_CLI_BASE_URL: 'http://127.0.0.1:9',
          },
          encoding: 'utf8',
        },
      );

      expect(output).toContain('Configuring apexcn auth profile');
      expect(output).toContain('Auth profile saved, but account check failed');

      const auth = execFileSync(join(tempRoot, 'bin', 'apexcn'), ['auth', 'show', '--json'], {
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      });
      expect(JSON.parse(auth)).toMatchObject({
        profile: 'agent-prod',
        baseUrl: 'http://127.0.0.1:9',
        token: 'abcd...wxyz',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('Codex skill tells agents how to use the installed CLI safely', () => {
    const skill = readRepoFile('agent-skill/SKILL.md');

    expect(skill).toContain('apexcn auth show --json');
    expect(skill).toContain('--json');
    expect(skill).toContain('不要输出完整 API key');
    expect(skill).toContain('apexcn-cli');
  });

  test('quickstart exposes one-line AI agent installation as the primary path', () => {
    const doc = readRepoFile('docs/quickstart.md');

    expect(doc).toContain('给 AI agent 的一行命令');
    expect(doc).toContain('install-agent.sh');
    expect(doc).toContain('install-agent.ps1');
    expect(doc).toContain('apexcn-cli.tgz');
    expect(doc).toContain('APEXCN_API_KEY');
    expect(doc).toContain('APEXCN_CLI_INSTALL_AGENT_SKILLS');
    expect(doc).toContain('--install-agent-skills');
    expect(doc).toContain('当前用户运行该命令的 AI 工具全局 Skills 目录');
    expect(doc).toContain('https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh');
    expect(doc).toContain('https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1');
    expect(doc).not.toContain('wfg2513148/apexcn-forums/main/cli/install-agent.sh');
    expect(doc).not.toContain('wfg2513148/apexcn-forums/main/cli/install-agent.ps1');
    expect(doc).not.toContain('feature/apexcn-cli-ords-api');
  });

  test('README gives beginner-friendly AI and manual install paths', () => {
    const doc = readRepoFile('README.md');

    expect(doc).toContain('把 APEX 中文社区装进终端和本地 AI 工具里');
    expect(doc).toContain('能帮你做什么');
    expect(doc).toContain('让 AI 帮你');
    expect(doc).toContain('AI 工具里安装');
    expect(doc).toContain('普通用户自己安装');
    expect(doc).toContain('APEXCN_CLI_INSTALL_AGENT_SKILLS');
    expect(doc).toContain('apexcn auth show --json');
    expect(doc).toContain('command -v apexcn');
    expect(doc).toContain('如果 shell 找不到 `apexcn`');
    expect(doc).not.toContain('APEXCN_CLI_CURRENT_AGENT');
    expect(doc).not.toContain('可选值');
    expect(doc).not.toContain('如果安装脚本没有认出当前 AI 工具');
    expect(doc).not.toContain('不是数据库直连工具');
    expect(doc).not.toContain('管理员后门');
    expect(doc).not.toContain('不能绕过');
    expect(doc).not.toContain('不能删除或编辑');
    expect(doc).not.toContain('只用于识别当前账号');
    expect(doc).not.toContain('APEXCN_CLI_INSTALL_CODEX_SKILL=1');
  });
});
