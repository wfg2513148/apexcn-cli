# apexcn-cli v0.70.0

## 可复现本地知识资产

- 新增 collection sync、增量 index、完整性检查、来源与陈旧状态跟踪，并对未变化文档进行复用。
- 新增确定性 export、verify-bundle、import 和 restore；篡改、缺失 hash 与路径穿越会在写入前失败关闭。
- 新增只读 automation plan/run 与重复输出抑制；离线执行保持网络请求和无人值守写请求均为零。
- 新增收藏主题一键转 collection，保留正文、URL、topicId、时间和 provenance。

## 规模与独立验证

- 冻结 10,000 文档语料（57 条真实 DEV 只读主题、9,943 条唯一合成主题）和 50 条自然语言排名 oracle。
- 独立 R02 fresh-novice validator 完成 baseline 8/8、AC001-AC010 10/10、50/50 离线任务首次通过；未发现 CLI 产品问题。
- 独立测量：cold index 1,834ms、查询 P95 117.555ms、1% 增量/完整中位耗时 9.89%、Top-10 期望引用命中率 100%。
- 离线网络请求 0、无人值守写请求 0；收藏 fidelity 100%，只发生两次允许的认证 GET，API 写请求 0。

## 服务端边界与清理

- apexcn-forums 提供只读 `0.7.0-candidate` 收藏导出 contract；匿名请求为 401，认证分页、正文、URL 与 provenance 通过。
- validator 使用的唯一 DEV 收藏关系已按 exact ID 删除，API 与表级残留均为 0；未访问生产、未新建服务端对象。
- MCP 仍未开放 execute-write，本版本没有生产社区真实写。

0.5 仍保持 blocked/unreleased；本 Release 仅闭环 roadmap 0.7。
