import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    expect(script).toContain('APEXCN_API_KEY');
    expect(script).toContain('https://oracleapex.cn/ords/api');
    expect(script).toContain('https://oracleapex.cn/cli/apexcn-cli.tgz');
    expect(script).toContain('--package-url');
    expect(script).toContain('Downloading apexcn-cli package');
    expect(script).toContain('auth set-token');
    expect(script).toContain('npm run build');
    expect(script).toContain('use_git=1');
    expect(script).not.toContain('feature/apexcn-cli-ords-api');
  });

  test('Windows installer supports agent-safe automation', () => {
    const script = readRepoFile('scripts/install-agent.ps1');

    expect(script).toContain('DryRun');
    expect(script).toContain('InstallCodexSkill');
    expect(script).toContain('APEXCN_API_KEY');
    expect(script).toContain('https://oracleapex.cn/ords/api');
    expect(script).toContain('https://oracleapex.cn/cli/apexcn-cli.tgz');
    expect(script).toContain('PackageUrl');
    expect(script).toContain('Downloading apexcn-cli package');
    expect(script).toContain('auth set-token');
    expect(script).toContain('npm run build');
    expect(script).toContain('else { "main" }');
    expect(script).not.toContain('feature/apexcn-cli-ords-api');
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
    expect(doc).toContain('https://oracleapex.cn/cli/install-agent.sh');
    expect(doc).toContain('https://oracleapex.cn/cli/install-agent.ps1');
    expect(doc).not.toContain('wfg2513148/apexcn-forums/main/cli/install-agent.sh');
    expect(doc).not.toContain('wfg2513148/apexcn-forums/main/cli/install-agent.ps1');
    expect(doc).not.toContain('feature/apexcn-cli-ords-api');
  });
});
