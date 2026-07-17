# 迁移到 0.30.x

`0.30.x` 对应 roadmap `0.3` 的社区知识检索里程碑。现有命令名、安装方式和
`schemaVersion: 1` 保持兼容；新增字段均为 additive change。

## JSON 输出变化

- `search`、`topic list/recent/view`、`ask`、`research` 增加稳定的 `kind`、
  `schemaVersion` 和 `provenance`。
- `provenance.requestIds` 汇总真实 API request ID。
- `provenance.sources` 提供主题 ID、标题、真实 URL 和可用的来源元数据。
- `research` 增加 `answerable`、`sources`、`searchAttempts`；无可信资料时返回
  `fallback` 和可执行的缩小查询建议。

脚本应继续按所需字段解析 JSON，并允许出现新增字段。不要依赖对象字段顺序。

## 搜索排序

服务端支持时，默认搜索按相关性排序。需要严格按时间浏览时显式传入：

```bash
apexcn search "ORDS 认证" --sort recent --json
```

旧服务端仍可继续使用；CLI 保留兼容行为，但相关性、可解释匹配证据和性能门禁以
roadmap 指定的 `dev@oci` API contract 为验收基准。

## RAG 与安全边界

- `ask` 和 `research` 仍是只读能力。
- 资料不足时返回低置信说明或拒答，不应把 fallback 当作事实答案。
- 真实写操作仍必须通过 CLI preview/workflow approval；MCP execute-write 继续禁用。

升级后建议执行：

```bash
apexcn doctor
apexcn search "ORDS 认证" --page-size 5 --json
apexcn research "APEX 调用 REST API" --limit 5 --json
```
