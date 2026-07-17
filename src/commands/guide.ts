import { Argument, Command } from "commander";
import type { CommandIo } from "./auth.js";
import {
  outputFormat,
  parseOutputFormat,
  printData,
  validateFormatOptions,
  type FormatOption
} from "../output.js";

const GUIDE_VIEWS = ["learning", "compatibility", "deployment", "security", "performance"] as const;
type GuideView = typeof GUIDE_VIEWS[number];

type GuideOptions = FormatOption & {
  apexVersion?: string;
  ordsVersion?: string;
};

export type NoviceGuide = {
  kind: "novice-guide";
  schemaVersion: 1;
  view: GuideView;
  title: string;
  summary: string;
  context: {
    apexVersion: string | null;
    ordsVersion: string | null;
  };
  steps: Array<{
    id: string;
    title: string;
    outcome: string;
    commands: string[];
    checks: string[];
  }>;
  limitations: string[];
  nextActions: string[];
};

export function createGuideCommand(io: CommandIo): Command {
  return new Command("guide")
    .description("show a curated novice task guide")
    .addArgument(new Argument("<view>", "guide view").choices([...GUIDE_VIEWS]))
    .option("--apex-version <version>", "APEX version context")
    .option("--ords-version <version>", "ORDS version context")
    .option("--format <format>", "output format: json, pretty, or text", parseOutputFormat)
    .option("--json", "pretty-print JSON")
    .action((view: GuideView, options: GuideOptions) => {
      if (!validateFormatOptions(io, options)) {
        return;
      }
      const guide = buildGuide(view, options);
      printData(io, guide, outputFormat(options), (data) => formatGuideText(data as NoviceGuide));
    });
}

export function buildGuide(view: GuideView, options: Pick<GuideOptions, "apexVersion" | "ordsVersion"> = {}): NoviceGuide {
  const context = {
    apexVersion: cleanVersion(options.apexVersion),
    ordsVersion: cleanVersion(options.ordsVersion)
  };
  const base = guideContent(view, context);
  return {
    kind: "novice-guide",
    schemaVersion: 1,
    view,
    title: base.title,
    summary: base.summary,
    context,
    steps: base.steps,
    limitations: [
      "This guide is a curated task path, not an Oracle support statement or compatibility certification.",
      "Verify version-specific behavior against official Oracle documentation and the target environment.",
      "Commands that read community content may require an authenticated apexcn profile."
    ],
    nextActions: base.nextActions
  };
}

function guideContent(
  view: GuideView,
  context: NoviceGuide["context"]
): Pick<NoviceGuide, "title" | "summary" | "steps" | "nextActions"> {
  if (view === "learning") {
    return {
      title: "APEX 中文社区学习路径",
      summary: "从安装和认证开始，逐步掌握社区检索、证据化问答、本地知识集和安全内容工作流。",
      steps: [
        step("install", "安装与自检", "获得可运行且来源可信的 apexcn CLI。", [
          "curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash",
          "apexcn --version",
          "apexcn doctor snapshot --json"
        ], ["安装入口不含固定版本号", "版本命令可运行", "诊断快照不泄露密钥"]),
        step("auth", "认证与 Profile", "建立最小权限、可审计的社区身份。", [
          "apexcn auth set-token --profile learning --token \"$APEXCN_API_KEY\"",
          "apexcn auth audit --json"
        ], ["活动 profile 正确", "token 仅显示脱敏结果"]),
        step("discover", "检索与阅读", "找到相关帖子并保留真实来源。", [
          "apexcn search \"ORDS 401\" --page-size 5 --json",
          "apexcn topic view <topic-id> --json"
        ], ["结果包含真实 topic URL", "分页信息可继续使用"]),
        step("answer", "证据化问答", "基于社区引用回答问题并识别资料不足。", [
          "apexcn ask \"ORDS 返回 401 如何排查？\" --top-k 3 --json",
          "apexcn research \"ORDS 401\" --limit 5 --json"
        ], ["回答包含来源", "低置信时明确限制"]),
        step("reuse", "本地知识复用", "构建可验证、可离线查询的资料集合。", [
          "apexcn collection build --query \"ORDS 401\" --output-dir ./collection --json",
          "apexcn collection index --dir ./collection --json",
          "apexcn collection query --dir ./collection \"认证失败\" --json"
        ], ["collection verify 通过", "离线查询返回来源"]),
        step("contribute", "安全贡献内容", "先草拟、审查和预览，不绕过 workflow approval。", [
          "apexcn draft question --title \"标题\" --problem \"问题描述\" --json",
          "apexcn workflow plan --goal ask-question --json"
        ], ["草稿不自动发布", "真实写入仍需用户审批"])
      ],
      nextActions: ["先完成 install、auth 和 discover 三步。", "遇到错误时运行 apexcn doctor --json。"]
    };
  }

  if (view === "compatibility") {
    const versionQuery = compatibilityQuery(context);
    return {
      title: "版本兼容性核对",
      summary: "把运行时、APEX、ORDS 和目标环境信息转化为可验证的兼容性检查，不猜测未提供的版本。",
      steps: [
        step("runtime", "确认本地运行时", "确认 CLI 与 Node.js 基线。", [
          "node --version",
          "apexcn --version",
          "apexcn doctor snapshot --json"
        ], ["Node.js 版本满足 package engines", "CLI 与安装资产版本一致"]),
        step("versions", "记录目标版本", "明确 APEX、ORDS、数据库和浏览器版本。", [
          `apexcn search ${shellQuote(versionQuery)} --page-size 10 --json`,
          `apexcn ask ${shellQuote(`${versionQuery} 有哪些兼容性注意事项？`)} --top-k 5 --json`
        ], ["查询包含精确版本", "结论附带来源和发布日期"]),
        step("verify", "交叉验证", "区分社区经验、官方支持范围和本地实测。", [
          `apexcn research ${shellQuote(versionQuery)} --limit 5 --json`
        ], ["官方文档另行核对", "目标环境 smoke test 已记录"])
      ],
      nextActions: ["缺少版本时使用 --apex-version 和 --ords-version 重新生成。", "不要把单篇社区帖子当作官方认证矩阵。"]
    };
  }

  if (view === "deployment") {
    return {
      title: "APEX 部署检查清单",
      summary: "按部署前、执行、验证和回滚四个阶段组织社区检索与本地检查。",
      steps: [
        step("prepare", "部署前盘点", "记录源/目标版本、依赖、凭据、静态文件和回滚点。", [
          "apexcn search \"APEX 应用 导出 导入 部署\" --page-size 10 --json",
          "apexcn research \"APEX 部署检查清单\" --limit 5 --json"
        ], ["源目标版本已记录", "依赖对象和静态文件已列出", "已准备备份和回滚方案"]),
        step("execute", "受控执行", "使用团队批准的导出与导入流程，并保存执行日志。", [], [
          "生产凭据不进入脚本或日志",
          "变更窗口和负责人已确认",
          "执行命令来自项目 runbook"
        ]),
        step("validate", "部署后验证", "从最终用户角度检查页面、授权、REST、作业和关键流程。", [
          "apexcn search \"APEX 部署后 验证 授权 ORDS\" --page-size 10 --json"
        ], ["关键页面可访问", "授权和 REST 契约正常", "日志无新增严重错误"]),
        step("rollback", "回滚判定", "在超出恢复窗口前执行预先验证的回滚方案。", [], [
          "回滚触发条件明确", "恢复资产可用", "回滚后重新执行 smoke test"
        ])
      ],
      nextActions: ["把本清单与项目自己的 runbook 合并。", "生产部署前必须由项目负责人确认。"]
    };
  }

  if (view === "security") {
    return {
      title: "APEX 安全检查路径",
      summary: "围绕认证、授权、ORDS、密钥、输入输出和审计证据组织检查。",
      steps: [
        step("identity", "认证与授权", "核对应用认证方案、授权方案和最小权限。", [
          "apexcn search \"APEX 认证 授权 最小权限\" --page-size 10 --json"
        ], ["匿名访问面已列出", "高权限角色已复核"]),
        step("ords", "ORDS 与 REST", "核对 privilege、role、OAuth/API key 和错误边界。", [
          "apexcn ask \"ORDS REST API 权限应该如何检查？\" --top-k 5 --json"
        ], ["401 与 403 行为明确", "敏感字段不进入错误输出"]),
        step("evidence", "审计与复验", "保留不含密钥的诊断和验证证据。", [
          "apexcn doctor snapshot --json",
          "apexcn auth audit --json"
        ], ["证据不含 token、Cookie 或密码", "修复后重新执行负向测试"])
      ],
      nextActions: ["把发现按认证、授权、数据暴露和审计分类。", "高风险问题先停止发布并升级处理。"]
    };
  }

  return {
    title: "APEX 性能排查路径",
    summary: "先建立可重复基线，再分层检查浏览器、APEX 页面、SQL/PLSQL、ORDS 和数据库。",
    steps: [
      step("baseline", "建立基线", "记录慢场景、时间窗、数据量和可重复步骤。", [
        "apexcn search \"APEX 性能 基线 调试\" --page-size 10 --json"
      ], ["至少重复执行三次", "记录中位数和最慢样本"]),
      step("layers", "分层定位", "区分网络、页面渲染、AJAX/ORDS、SQL 和数据库等待。", [
        "apexcn research \"APEX 页面 性能 SQL ORDS\" --limit 5 --json"
      ], ["每层都有证据", "未凭单次耗时直接归因"]),
      step("verify", "验证优化", "在相同数据与环境下比较前后结果并检查功能回归。", [], [
        "使用同一测试集", "保存前后指标", "功能和权限回归通过"
      ])
    ],
    nextActions: ["优先优化证据最强的瓶颈。", "避免在没有基线时同时改动多个层。"]
  };
}

function step(
  id: string,
  title: string,
  outcome: string,
  commands: string[],
  checks: string[]
): NoviceGuide["steps"][number] {
  return { id, title, outcome, commands, checks };
}

function compatibilityQuery(context: NoviceGuide["context"]): string {
  const versions = [
    context.apexVersion ? `APEX ${context.apexVersion}` : "APEX 目标版本",
    context.ordsVersion ? `ORDS ${context.ordsVersion}` : "ORDS 目标版本"
  ];
  return `${versions.join(" ")} 兼容性`;
}

function cleanVersion(value: string | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function shellQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function formatGuideText(guide: NoviceGuide): string {
  const lines = [guide.title, guide.summary];
  for (const [index, item] of guide.steps.entries()) {
    lines.push("", `${index + 1}. ${item.title}`, `   ${item.outcome}`);
    for (const command of item.commands) {
      lines.push(`   $ ${command}`);
    }
    for (const check of item.checks) {
      lines.push(`   - ${check}`);
    }
  }
  lines.push("", "限制：", ...guide.limitations.map((item) => `- ${item}`));
  return lines.join("\n");
}
