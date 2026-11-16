from pathlib import Path
import difflib
root=Path(__file__).resolve().parents[1]
old=root/"verification"/"direct-draft-baseline"
paths=("web/src/App.tsx","web/src/FxDraftStudio.tsx","web/src/fx-draft.css","web/src/fx-draft-handoff.ts","server/src/index.ts","scripts/stage-tx-plugin.py","scripts/verify-draft-handoff.mjs","scripts/check-handoff-guides.py")
with (root/"release"/"direct-draft"/"手绘直接出图.diff").open("w",encoding="utf-8",newline="\n") as stream:
    for name in paths:
        path=old/name
        a=path.read_text(encoding="utf-8-sig").splitlines(keepends=True) if path.exists() else []
        b=(root/name).read_text(encoding="utf-8-sig").splitlines(keepends=True)
        stream.writelines(difflib.unified_diff(a,b,"a/"+name if path.exists() else "/dev/null","b/"+name))

