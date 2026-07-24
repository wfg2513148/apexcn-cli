# Local-AI RAG Retrieval Evaluation

This frozen dataset qualifies the CLI-owned `rag retrieve` path. It is separate
from App 100's existing `/api/v1/ask` knowledge-answer path.

The runner:

- executes only `auth audit` and `rag retrieve`;
- requires the production `oracleapex.cn` ORDS base URL;
- checks Top-5 expected-topic recall, marked-correct-answer evidence, source
  identity, URLs, unanswerable behavior, and endpoint isolation;
- fails if the evidence bundle reports an App 100 RAG call.

Run it with an explicit, permission-restricted config:

```bash
npm run eval:agent-rag -- \
  --config /path/to/config.json \
  --environment oracleapex.cn-readonly \
  --strict \
  --output reports/agent-rag-live.json
```

The config path and a hash of the non-secret environment identity are recorded.
The API key itself is never included in the report.
