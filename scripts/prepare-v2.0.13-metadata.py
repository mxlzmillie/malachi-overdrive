import json
from pathlib import Path

OLD = "2.0.12"
NEW = "2.0.13"

for name in ("package.json", "package-lock.json"):
    path = Path(name)
    data = json.loads(path.read_text())
    data["version"] = NEW
    if name == "package-lock.json":
        data["packages"][""]["version"] = NEW
    path.write_text(json.dumps(data, indent=2) + "\n")

manifest_path = Path("extension/manifest.json")
manifest = json.loads(manifest_path.read_text())
manifest["version"] = NEW
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

version_path = Path("src/main/version.ts")
version_source = version_path.read_text()
needle = f"APP_VERSION = '{OLD}'"
if version_source.count(needle) != 1:
    raise SystemExit(f"Expected exactly one {needle}")
version_path.write_text(version_source.replace(needle, f"APP_VERSION = '{NEW}'"))

changelog_path = Path("CHANGELOG.md")
changelog = changelog_path.read_text()
marker = "## Unreleased\n"
entry = """
## [2.0.13] — 2026-09-14

- Carries the complete 2.0.12 stability-only runtime forward unchanged while keeping the unpublished `v2.0.12` tag immutable.
- Replaced the Windows ARM64 release gate's short wall-clock polling assumptions with the existing Goal and PluginManager lifecycle events. The tests still require the same state transitions, ready-peer isolation, real tool call, and process shutdown; they no longer confuse a slow hosted ARM runner with a runtime failure.
- Preserves the 24/7 safeguards already validated in 2.0.12: fresh account-proven explicit worker admission, exact model/reasoning proof through Send and revival, absolute browser command leases, bounded restart recovery, serialized durable spawn admission, and retention of unread worker results.

See [the full release notes](docs/release-notes/v2.0.13.md).
"""
if changelog.count(marker) != 1:
    raise SystemExit("Expected one Unreleased marker")
changelog_path.write_text(changelog.replace(marker, marker + entry, 1))

source_notes = Path("docs/release-notes/v2.0.12.md").read_text()
source_notes = source_notes.replace(
    "## 2.0.12 — MALACHI OVERDRIVE model-truth stability",
    "## 2.0.13 — MALACHI OVERDRIVE model-truth stability",
    1,
)
intro = "This is a **stability-only patch** for long-running / overnight / 24-7 multi-agent work. It does not add a new product surface, visual redesign, endless Loop behavior, or the separate macOS Developer ID signing work.\n"
addition = "\n- Windows ARM64 release verification now synchronizes on the real Goal and PluginManager lifecycle events instead of assuming those asynchronous transitions finish inside a one-second polling window. The assertions remain strict: a slow credential startup must stay blocked while its ready peer becomes usable, the peer must execute a real tool call, and shutdown must retire its process.\n"
if source_notes.count(intro) != 1:
    raise SystemExit("Release-note intro not found exactly once")
source_notes = source_notes.replace(intro, intro + addition, 1)
source_notes = source_notes.replace("publisher-unsigned and unnotarized in 2.0.12", "publisher-unsigned and unnotarized in 2.0.13", 1)
Path("docs/release-notes/v2.0.13.md").write_text(source_notes)
