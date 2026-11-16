from pathlib import Path
import difflib
root=Path(__file__).resolve().parents[1]
old=root/"verification"/"depth-baseline"
paths=("web/src/FxDraftStudio.tsx","web/src/fx-draft-model.ts","web/src/fx-draft.css","web/src/FxLookShelf.tsx","web/src/fx-depth-geometry.ts","web/src/fx-depth-presets.ts","web/src/fx-depth-render.ts","tests/fx-depth.test.ts","scripts/verify-fx-depth.mjs","scripts/check-depth-art.py","scripts/stage-tx-plugin.py","server/src/index.ts")
with (root/"release"/"brush-depth"/"笔刷与透视.diff").open("w",encoding="utf-8",newline="\n") as stream:
    for name in paths:
        path=old/name
        a=path.read_text(encoding="utf-8-sig").splitlines(keepends=True) if path.exists() else []
        b=(root/name).read_text(encoding="utf-8-sig").splitlines(keepends=True)
        stream.writelines(difflib.unified_diff(a,b,"a/"+name if path.exists() else "/dev/null","b/"+name))

