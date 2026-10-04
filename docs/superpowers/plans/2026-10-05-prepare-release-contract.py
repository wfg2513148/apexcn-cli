from pathlib import Path
import json
repo = Path(__file__).resolve().parents[3]
source = repo / "qualification/releases/1.1.6"
destination = repo / "qualification/releases/1.2.0"
destination.mkdir(parents=True, exist_ok=False)
ids = {"category.list", "stats.category", "search", "topic.list", "topic.recent", "topic.view", "me.dashboard", "me.search", "me.topics", "me.replies", "me.favorites", "me.subscriptions", "research", "rag.retrieve", "collection.build", "collection.favorites"}
surface = json.loads((source / "public-surface-v1.json").read_text())
surface["frozenForVersion"] = "1.2.0"
for command in surface["commandManifest"]["commands"]:
    if command.get("id") in ids:
        command["options"].append("--lang <language>")
contract = json.loads((source / "qualification-contract-v1.json").read_text().replace("qualification/releases/1.1.6/", "qualification/releases/1.2.0/"))
contract["targetVersion"] = "1.2.0"
contract["contractVersion"] = "COMMUNITY-I18N-QUALIFICATION-1"
contract["independentValidation"]["cwd"] = "/Users/kwang/Documents/Codex/2026-10-04/apexcn-cli-test-r5"
contract["contentLanguage"] = {"supported": ["zh-cn", "en"], "default": "zh-cn", "replyPolicy": "original", "unknownVersionPolicy": "fail-closed"}
for name, value in [("public-surface-v1.json", surface), ("qualification-contract-v1.json", contract)]:
    (destination / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
(destination / "tasks-v1.jsonl").write_bytes((source / "tasks-v1.jsonl").read_bytes())
print("Prepared 1.2.0 public contract; immutable 1.1.6 files unchanged.")
