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
| unsupportedClaimRate | 未被证据支持的断言比例 |
| lowConfidenceBehavior | 资料不足时是否拒答或说明限制 |

## 低置信策略

当检索结果不足、引用缺失或问题超出社区资料时，应明确说明资料不足，并建议用户补充错误信息、版本、日志或相关链接。
