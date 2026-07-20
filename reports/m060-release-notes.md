# apexcn-cli v0.60.0

## 可审计内容操作

- 新增 topic 与 reply 的 create、update、delete workflow：preview、approval、execute、verify、diff、audit、export、expiry、policy 和恢复状态均落盘可核查。
- approval 与 canonical preview hash、目标环境和请求 payload 强绑定；stale、tamper、target mismatch、过期审批和重复完成会在写入前阻断。
- 内容 draft/review 在 API preview 前检查正文质量、隐私和疑似密钥。
- MCP 继续保持 preview-only；所有内容预览工具返回 `willExecute=false`，没有 `execute-write` 能力。

## 安全与验收

- 真实写仅在最小权限的隔离 DEV surface 上验证，没有生产社区写入。
- 独立 R32 novice validator 对冻结候选完成 30/30 baseline、6/6 dynamic、20/20 首次写和 20/20 双证据验收。
- 所有写回视觉证据都来自系统 Google Chrome 打开的 apexcn forums 现有 DEV app 102 / Page 14；未新建 APEX 页面，也未使用专用 `/visual` endpoint 代替真实应用页面。
- 4 个 topic、3 个 reply、20 条 idempotency 和 20 条 SUCCESS audit 均按 current-round exact key 清至零。

## 完整性

- R32 report SHA-256：`43461f693a27a08abad915700d3de7450f921d8738dd5525d3373feec41c1718`
- R32 `SHA256SUMS` SHA-256：`b70312247317506a98b8578b2e1e4fe1b2557ac27b361da3881ee523e8182c2d`
- 独立验证候选的 `dist/`、`agent-skill/` 和 `package.json` 与最终 release artifact 对应内容逐字节一致。

0.5 仍保持 blocked/unreleased；本 Release 仅闭环 roadmap 0.6。
