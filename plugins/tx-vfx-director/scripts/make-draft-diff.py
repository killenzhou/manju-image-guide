from pathlib import Path
import difflib

root = Path(__file__).resolve().parents[1]
old = root / "verification" / "draft-baseline"
files = ["web/src/App.tsx","web/src/FxDraftStudio.tsx","web/src/fx-draft-model.ts","web/src/fx-draft.css","tests/fx-draft.test.ts","scripts/verify-fx-draft.mjs","scripts/check-fx-alpha.py"]
with (root/"release"/"hand-draft"/"手绘草稿.diff").open("w",encoding="utf-8",newline="\n") as out:
    for file in files:
        a = (old/file).read_text(encoding="utf-8-sig").splitlines(keepends=True) if (old/file).exists() else []
        b = (root/file).read_text(encoding="utf-8-sig").splitlines(keepends=True)
        out.writelines(difflib.unified_diff(a,b,"a/"+file if a else "/dev/null","b/"+file))

