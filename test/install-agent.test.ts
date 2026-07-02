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
    expect(script).toContain('https://github.com/wfg2513148/apexcn-cli/releases/download/v0.1.4/apexcn-cli.tgz');
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
    expect(script).toContain('https://github.com/wfg2513148/apexcn-cli/releases/download/v0.1.4/apexcn-cli.tgz');
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

  test('macOS/Linux installer writes a compact launcher for the resolved CLI root', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'apexcn-launcher-install-'));

    try {
      execFileSync(
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
          env: { ...process.env, HOME: join(tempRoot, 'home') },
          encoding: 'utf8',
        },
      );

      const launcher = readFileSync(join(tempRoot, 'bin', 'apexcn'), 'utf8');
      expect(launcher.match(/exec node/g)).toHaveLength(1);
      expect(launcher).not.toContain('/cli/dist/index.js');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('macOS/Linux installer can install the npm package tarball layout', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'apexcn-package-install-'));

    try {
      execFileSync('npm', ['pack', '--pack-destination', tempRoot], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      const archive = join(tempRoot, 'apexcn-cli-0.1.4.tgz');

      execFileSync(
        'bash',
        [
          join(repoRoot, 'scripts/install-agent.sh'),
          '--package-url',
          `file://${archive}`,
          '--install-root',
          join(tempRoot, 'install'),
          '--bin-dir',
          join(tempRoot, 'bin'),
          '--yes',
        ],
        {
          cwd: repoRoot,
          env: { ...process.env, HOME: join(tempRoot, 'home') },
          encoding: 'utf8',
        },
      );

      const version = execFileSync(join(tempRoot, 'bin', 'apexcn'), ['--version'], {
        env: { ...process.env, HOME: join(tempRoot, 'home') },
        encoding: 'utf8',
      });
      expect(version).toBe('0.1.4\n');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

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
    expect(skill).toContain('real URL');
    expect(skill).toContain('originalUrl');
    expect(skill).toContain('不要输出完整 API key');
    expect(skill).toContain('apexcn-cli');
  });

  test('Codex skill description includes natural community trigger keywords', () => {
    const skill = readRepoFile('agent-skill/SKILL.md');
    const description = /^description: (.+)$/m.exec(skill)?.[1] ?? '';

    expect(description).toMatch(/^Use when/);
    expect(description.length).toBeLessThan(500);
    expect(description).toContain('APEX 中文社区');
    expect(description).toContain('oracleapex.cn');
    expect(description).toContain('APEX Chinese Community');
    expect(description).toContain('community-content access intent');
    expect(description).not.toContain('community posts/topics');
    expect(description).not.toContain('forum search');
    expect(skill).toContain('## Trigger Keywords');
    expect(skill).toContain('APEX社区 when paired with actions');
    expect(skill).toContain('在 APEX 中文社区搜索');
    expect(skill).toContain('发布到 APEX 中文社区');
    expect(skill).toContain('Do not use this skill for:');
    expect(skill).toContain('without APEX Chinese Community or oracleapex.cn context');
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
    expect(doc).toContain('https://github.com/wfg2513148/apexcn-cli/releases/download/v0.1.4/install-agent.sh');
    expect(doc).toContain('https://github.com/wfg2513148/apexcn-cli/releases/download/v0.1.4/install-agent.ps1');
    expect(doc).not.toContain('wfg2513148/apexcn-forums/main/cli/install-agent.sh');
    expect(doc).not.toContain('wfg2513148/apexcn-forums/main/cli/install-agent.ps1');
    expect(doc).not.toContain('feature/apexcn-cli-ords-api');
  });

  test('split manuals cover beginner and terminal usage in Chinese and English', () => {
    const userDocs = [
      readRepoFile('docs/user-guide.zh.md'),
      readRepoFile('docs/user-guide.en.md'),
    ];
    const terminalDocs = [
      readRepoFile('docs/cli-manual.zh.md'),
      readRepoFile('docs/cli-manual.en.md'),
    ];

    for (const doc of userDocs) {
      expect(doc).toContain('AI');
      expect(doc).toContain('apexcn-cli');
      expect(doc).toMatch(/搜索|Search/);
      expect(doc).toMatch(/发布|Publish/);
      expect(doc).toMatch(/回复|Reply/);
      expect(doc).toMatch(/收藏|Favorite/);
      expect(doc).toMatch(/订阅|Subscribe/);
      expect(doc).not.toContain('```');
      expect(doc).not.toContain('apexcn ');
      expect(doc).not.toContain('curl ');
      expect(doc).not.toContain('PowerShell');
      expect(doc).not.toContain('APEXCN_API_KEY=');
    }

    for (const doc of terminalDocs) {
      expect(doc).toContain('apexcn auth set-token');
      expect(doc).toContain('apexcn auth show');
      expect(doc).toContain('apexcn auth logout');
      expect(doc).toContain('apexcn me');
      expect(doc).toContain('apexcn category list');
      expect(doc).toContain('apexcn search');
      expect(doc).toContain('apexcn topic view');
      expect(doc).toContain('apexcn topic create');
      expect(doc).toContain('apexcn topic delete');
      expect(doc).toContain('apexcn reply create');
      expect(doc).toContain('apexcn reply delete');
      expect(doc).toContain('apexcn favorite add');
      expect(doc).toContain('apexcn favorite remove');
      expect(doc).toContain('apexcn subscription add');
      expect(doc).toContain('apexcn subscription remove');
      expect(doc).toContain('apexcn ask');
    }

    expect(userDocs[0]).toContain('小白用户手册');
    expect(userDocs[1]).toContain('Beginner Guide');
    expect(terminalDocs[0]).toContain('命令行终端手册');
    expect(terminalDocs[1]).toContain('Terminal Manual');
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
    expect(doc).toContain('docs/user-guide.zh.md');
    expect(doc).toContain('docs/user-guide.en.md');
    expect(doc).toContain('docs/cli-manual.zh.md');
    expect(doc).toContain('docs/cli-manual.en.md');
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
