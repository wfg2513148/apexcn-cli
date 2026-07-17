# RAG Quality

## 目标

RAG 输出必须基于 APEX 中文社区资料，不应在资料不足时编造答案。第一版 eval 用于建立 baseline，而不是追求一次性高分。

## Eval 数据与命令

- `eval/rag/questions.zh.jsonl`：中文问题集，至少 30 条。
- `eval/rag/expected-references.jsonl`：期望命中主题或标签。
- `scripts/eval-rag.mjs`：离线 baseline runner。

```bash
npm run eval:rag
node scripts/eval-rag.mjs --report
node scripts/eval-rag.mjs --strict
node scripts/eval-rag.mjs --output reports/rag-eval.json
```

`--report` 是 report-only，适合 CI。`--strict` 会按当前 baseline 阈值失败；没有真实 API key 时仍使用离线 fixture/baseline 数据，不应访问真实写接口。

## 覆盖范围

- APEX 安装与版本
- ORDS 配置
- REST API
- 认证与权限
- APEX_MAIL
- Interactive Grid
- Dynamic Action
- JSON_TABLE
- SQL/PLSQL 与 APEX 结合
- 常见错误排查

## 指标

| 指标 | 说明 |
|---|---|
| answerability | 是否能基于社区资料回答 |
| citationCoverage | 回答中可被引用支撑的比例 |
| referenceHitRate | 是否命中期望参考资料 |
| lowConfidenceBehavior | 资料不足时是否拒答或说明限制 |

当前 `offline-fixture` 模式只测 fixture 完整性和期望引用覆盖，不调用 live API，也不测真实模型答案正确率、实时检索质量或 unsupported claim rate。报告中的 `notMeasured.unsupportedClaimRate` 会明确标记该指标未测量，避免把硬编码数值误读为真实低幻觉率。

## Live readonly 检索评测

`eval/retrieval/questions.zh.jsonl` 包含至少 50 个可回答问题和 10 个不可回答问题。每个可回答问题至少要求在标题、摘要、标签或分类等用户可见字段中命中两个期望引用词，避免仅因结果中出现泛化的 `APEX`，或服务端自报 `matchedTerms`，就被判定为相关。`ask` 和 `research` 的引用覆盖率还要求实际 provenance source 的标题或标签命中同一组期望引用词，只有合法 URL 但内容无关的来源不会计为通过。该评测只调用公开只读 CLI，不执行任何社区写操作，并要求显式提供隔离的 dev 配置：

```bash
node scripts/eval-retrieval.mjs \
  --config /path/to/dev-config.json \
  --environment dev@oci \
  --report \
  --output reports/retrieval-eval.json

node scripts/eval-retrieval.mjs \
  --config /path/to/dev-config.json \
  --environment dev@oci \
  --strict
```

未同时提供 `--config`（或 `APEXCN_LIVE_EVAL_CONFIG`）和 `--environment dev@oci` 时，脚本输出 `mode: "live-readonly-unavailable"`，不会读取默认生产 profile，也不会尝试联网。即使显式提供配置，脚本也会拒绝非 `https://oracleapex.cn/ords/dev` 基地址。报告只记录配置文件名和 token presence，不记录配置绝对路径或 token。

真实评测会在首次 `ask` 前保守等待 61 秒，并在后续 `ask` 之间保持至少 31 秒、`research` 之间保持至少 5.5 秒。服务端在请求完成后写入限流记录，因此 ask 间隔必须同时覆盖模型生成耗时，而不能只按 3 次/分钟机械地使用 20 秒。节流等待不计入单次命令延迟，避免前序测试占用服务端滑动窗口而产生伪 429，同时不美化 P95。

严格门禁包括：Top-5 期望引用命中率不低于 85%、整体引用覆盖率不低于 90%、`ask` 引用覆盖率为 100%、`research` 引用覆盖率不低于 90%、10 个不可回答问题全部正确限制或拒答、连续 5 页 cursor 无重复或丢失、search P95 不超过 5 秒、合并 RAG P95、`ask` P95 和 `research` P95 均不超过 15 秒，以及结果 provenance 覆盖率 100%。拆分 ask/research 子指标可防止大量快速 research 样本掩盖 ask 失败。

## 低置信策略

当检索结果不足、引用缺失或问题超出社区资料时，应明确说明资料不足，并建议用户补充错误信息、版本、日志或相关链接。
