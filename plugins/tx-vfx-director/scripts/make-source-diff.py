from pathlib import Path
import difflib

root = Path(__file__).resolve().parents[1]
original = Path.home() / ".codex/plugins/cache/personal/vfx-director/0.2.0+codex.20260801084313"
paths = ("package.json","package-lock.json","web/index.html","web/src/App.tsx","web/src/tx-pilot.css","web/src/tx-pilot.tsx","web/src/tx-skills.ts","scripts/prepare-tx-references.py","server/src/index.ts","tests/mcp.test.ts","scripts/probe-mcp.mjs","scripts/stage-tx-plugin.py","scripts/verify-tx-browser.mjs")
with (root/"TX-pilot-source.diff").open("w",encoding="utf-8",newline="\n") as f:
    for name in paths:
        old = original/name
        a = old.read_text(encoding="utf-8-sig").splitlines(keepends=True) if old.exists() else []
        b = (root/name).read_text(encoding="utf-8-sig").splitlines(keepends=True)
        f.writelines(difflib.unified_diff(a,b,"a/"+name if old.exists() else "/dev/null","b/"+name))

