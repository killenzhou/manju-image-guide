# -*- coding: utf-8 -*-
"""
《踏星》标准化净图资产库（TX Asset Ref Vault）
- 只读扫描 Y:\\TX\\Assets，绝不写入美术源目录
- 按需沉淀标准化单格净图（Character / Scence / Pro / VFX）
- 三层源图新鲜度检测：源图修改(SHA-256) / Shading升档 / 同目录新增提示
- 统一裁切配方 + 无黑边门禁 + 旧版自动归档 + 即梦画布 resourceId 去重缓存
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
import os
import pathlib
import shutil
import sys
import threading
import time
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

VAULT_DIR = pathlib.Path(os.environ.get("TX_VAULT_DIR") or pathlib.Path(__file__).resolve().parent).resolve()
CODE_VAULT_DIR = pathlib.Path(__file__).resolve().parent
AI_ROOT = pathlib.Path(os.environ.get("TX_AI_ROOT") or CODE_VAULT_DIR.parent).resolve()
ASSETS_ROOT = pathlib.Path(os.environ.get("TX_ASSETS_ROOT") or (AI_ROOT.parent / "Assets")).resolve()

LIBRARY_DIR = VAULT_DIR / "library"
CACHE_DIR = VAULT_DIR / "cache"
ALIASES_PATH = VAULT_DIR / "aliases.json"
CATALOG_PATH = VAULT_DIR / "source_catalog.json"
INDEX_PATH = VAULT_DIR / "vault_index.json"
UPLOAD_CACHE_PATH = CACHE_DIR / "dreamina_uploads.json"

SKILL_SCRIPTS = AI_ROOT / ".agents" / "skills" / "tx-layout-atmosphere" / "scripts"
if str(SKILL_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SKILL_SCRIPTS))
import shot_delivery  # noqa: E402

CATEGORIES = ("Character", "Scence", "Pro", "其他设计")
VAULT_CATEGORIES = ("Character", "Scence", "Pro", "VFX")
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_DIRS = {
    "texture", "textures", "贴图", "modeling", "rig", "hair", "dyn",
    "maya", "ue", "xgen", "fbx", "abc", "sourceimages", ".mayaswatches",
    "资料", "参考",
}
SKIP_FILE_KEYWORDS = ("微信", "参考")

_UPLOAD_CACHE_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def ensure_vault_dirs() -> None:
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def atomic_write_json(path: pathlib.Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: pathlib.Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def to_source_rel(src_path: pathlib.Path) -> str:
    resolved = src_path.resolve()
    try:
        return resolved.relative_to(ASSETS_ROOT).as_posix()
    except ValueError:
        pass
    try:
        return "AI:/" + resolved.relative_to(AI_ROOT).as_posix()
    except ValueError:
        pass
    return resolved.as_posix()


def from_source_rel(source_rel: str) -> pathlib.Path:
    if source_rel.startswith("AI:/"):
        return (AI_ROOT / source_rel[4:]).resolve()
    p = pathlib.Path(source_rel)
    if p.is_absolute():
        return p.resolve()
    return (ASSETS_ROOT / source_rel).resolve()


def normalize_asset_id(asset_id: str) -> str:
    parts = [p for p in asset_id.replace("\\", "/").split("/") if p]
    if len(parts) != 2:
        raise ValueError(f"Asset ID must be '<Category>/<AssetName>', got: {asset_id}")
    cat, name = parts
    # Normalize common category typos / aliases
    cat_map = {
        "character": "Character",
        "scence": "Scence",
        "scene": "Scence",
        "pro": "Pro",
        "prop": "Pro",
        "vfx": "VFX",
        "其他设计": "VFX",
    }
    norm_cat = cat_map.get(cat.lower(), cat)
    if norm_cat not in VAULT_CATEGORIES:
        raise ValueError(f"Unsupported vault category '{cat}'. Expected one of {VAULT_CATEGORIES}")
    return f"{norm_cat}/{name}"


def infer_source_asset_id(source_rel: str) -> str | None:
    if source_rel.startswith("AI:/"):
        return None
    parts = [p for p in source_rel.split("/") if p]
    if len(parts) >= 2 and parts[0] in CATEGORIES:
        cat = "VFX" if parts[0] == "其他设计" else parts[0]
        return f"{cat}/{parts[1]}"
    return None


def infer_tier_from_rel(source_rel: str) -> str:
    low = source_rel.lower()
    if source_rel.startswith("AI:/"):
        if ".vfx/approved_anchors" in low:
            return "approved_anchor"
        return "local_override"
    parts = [p.lower() for p in source_rel.split("/")]
    for seg in parts[2:]:
        if "shad" in seg:
            return "shading"
        if "design" in seg or "设计" in seg:
            return "design"
    return "root"


def scan_assets(save: bool = True) -> dict[str, Any]:
    """Read-only fast scan of ASSETS_ROOT (~0.1s) producing source_catalog.json."""
    t0 = time.perf_counter()
    assets: dict[str, dict[str, Any]] = {}
    total_files = 0

    for cat in CATEGORIES:
        cat_dir = ASSETS_ROOT / cat
        if not cat_dir.is_dir():
            continue
        vault_cat = "VFX" if cat == "其他设计" else cat
        for asset_dir in sorted(cat_dir.iterdir(), key=lambda p: p.name.lower()):
            if not asset_dir.is_dir():
                continue
            asset_id = f"{vault_cat}/{asset_dir.name}"
            files: list[dict[str, Any]] = []

            # 1. Direct files in asset root
            for child in asset_dir.iterdir():
                if child.is_file() and child.suffix.lower() in IMG_EXTS:
                    if any(k in child.name for k in SKIP_FILE_KEYWORDS):
                        continue
                    st = child.stat()
                    files.append({
                        "rel": f"{cat}/{asset_dir.name}/{child.name}",
                        "size": st.st_size,
                        "mtime_ns": st.st_mtime_ns,
                        "tier": "root",
                    })
                elif child.is_dir():
                    sn = child.name.lower()
                    if sn in SKIP_DIRS:
                        continue
                    if "shad" in sn:
                        tier = "shading"
                    elif "design" in sn or "设计" in sn:
                        tier = "design"
                    else:
                        continue
                    for dp, dns, fns in os.walk(child):
                        dns[:] = sorted(d for d in dns if d.lower() not in SKIP_DIRS)
                        for fn in sorted(fns):
                            if any(k in fn for k in SKIP_FILE_KEYWORDS):
                                continue
                            if os.path.splitext(fn)[1].lower() not in IMG_EXTS:
                                continue
                            fp = pathlib.Path(dp) / fn
                            st = fp.stat()
                            rel = fp.relative_to(ASSETS_ROOT).as_posix()
                            files.append({
                                "rel": rel,
                                "size": st.st_size,
                                "mtime_ns": st.st_mtime_ns,
                                "tier": tier,
                            })

            if files:
                has_shading = any(f["tier"] == "shading" for f in files)
                has_design = any(f["tier"] == "design" for f in files)
                assets[asset_id] = {
                    "source_category": cat,
                    "asset_name": asset_dir.name,
                    "has_shading": has_shading,
                    "has_design": has_design,
                    "files": files,
                }
                total_files += len(files)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    catalog = {
        "scanned_at": now_iso(),
        "assets_root": str(ASSETS_ROOT),
        "elapsed_ms": elapsed_ms,
        "asset_count": len(assets),
        "file_count": total_files,
        "assets": assets,
    }
    if save:
        ensure_vault_dirs()
        atomic_write_json(CATALOG_PATH, catalog)
    return catalog


def load_aliases() -> dict[str, Any]:
    return read_json(ALIASES_PATH, {})


def load_index() -> dict[str, Any]:
    return read_json(INDEX_PATH, {"version": 1, "updated_at": None, "assets": {}})


def save_index(index: dict[str, Any]) -> None:
    index["updated_at"] = now_iso()
    atomic_write_json(INDEX_PATH, index)


def load_asset_meta(asset_id: str) -> dict[str, Any]:
    meta_path = LIBRARY_DIR / asset_id / "meta.json"
    return read_json(meta_path, {"asset_id": asset_id, "slots": {}})


def save_asset_meta(asset_id: str, meta: dict[str, Any]) -> None:
    meta_path = LIBRARY_DIR / asset_id / "meta.json"
    atomic_write_json(meta_path, meta)


def sync_index_entry(asset_id: str, meta: dict[str, Any]) -> None:
    index = load_index()
    slots_summary = {}
    for slot_name, rec in meta.get("slots", {}).items():
        slots_summary[slot_name] = {
            "file": str((LIBRARY_DIR / asset_id / rec["output"]["file"]).resolve()),
            "rel_file": f"library/{asset_id}/{rec['output']['file']}",
            "tier": rec.get("tier"),
            "source_rel": rec.get("source_rel"),
            "source_asset_id": rec.get("source_asset_id"),
            "source_sha256": rec.get("source_sha256"),
            "source_size_bytes": rec.get("source_size_bytes"),
            "source_mtime_ns": rec.get("source_mtime_ns"),
            "known_shading_siblings": rec.get("known_shading_siblings", []),
            "pin_design": rec.get("pin_design", False),
            "status": rec.get("status", "draft"),
            "view_desc": rec.get("view_desc", ""),
            "dims": rec["output"].get("dims"),
            "sha256": rec["output"].get("sha256"),
            "kind": rec.get("recipe", {}).get("kind"),
            "updated_at": rec.get("updated_at"),
        }
    index.setdefault("assets", {})[asset_id] = {
        "asset_id": asset_id,
        "slots": slots_summary,
    }
    save_index(index)


def resolve_alias_target(query: str, strict: bool = False) -> dict[str, Any]:
    """
    Resolve an input asset identifier (either 'Category/AssetName' or Chinese alias)
    and return resolution metadata including variant warnings.
    """
    q = query.strip()
    aliases = load_aliases()
    index = load_index()
    catalog = read_json(CATALOG_PATH, None)
    if catalog is None:
        catalog = scan_assets(save=True)

    # Direct '<Category>/<AssetName>' lookup
    if "/" in q or "\\" in q:
        norm_id = normalize_asset_id(q)
        # Check if there is an alias entry pointing to this to surface sibling variants
        variants = [norm_id]
        note = ""
        for ainfo in aliases.values():
            vlist = ainfo.get("variants") or []
            if norm_id in vlist:
                variants = vlist
                note = ainfo.get("note", "")
                break
        return {
            "ok": True,
            "query": q,
            "asset_id": norm_id,
            "variants_available": variants,
            "variant_note": note,
        }

    # Exact alias match (case-insensitive)
    alias_hit = None
    for k, v in aliases.items():
        if k.lower() == q.lower() or q.lower() in [a.lower() for a in v.get("aliases", [])]:
            alias_hit = (k, v)
            break

    if alias_hit:
        k, v = alias_hit
        variants = v.get("variants") or []
        default_id = v.get("default")
        note = v.get("note", "")
        require_explicit = bool(v.get("require_explicit", False))
        if (strict or require_explicit) and len(variants) > 1 and not default_id:
            return {
                "ok": False,
                "error": "AMBIGUOUS_VARIANT",
                "query": q,
                "variants_available": variants,
                "variant_note": note or "该角色/资产存在多个服装或伤态版本，请显式指定 <Category>/<AssetName>。",
            }
        if strict and len(variants) > 1:
            return {
                "ok": False,
                "error": "AMBIGUOUS_VARIANT",
                "query": q,
                "default": default_id,
                "variants_available": variants,
                "variant_note": note or "strict 模式下存在多个版本，请显式指定版本。",
            }
        target_id = default_id or (variants[0] if variants else None)
        if target_id:
            return {
                "ok": True,
                "query": q,
                "matched_alias": k,
                "asset_id": target_id,
                "variants_available": variants,
                "variant_note": note,
            }

    # Fallback: exact AssetName match in vault index or catalog
    candidates = []
    all_ids = sorted(set(index.get("assets", {}).keys()) | set(catalog.get("assets", {}).keys()))
    for aid in all_ids:
        _, aname = aid.split("/", 1)
        if aname.lower() == q.lower():
            candidates.append(aid)
    if len(candidates) == 1:
        return {
            "ok": True,
            "query": q,
            "asset_id": candidates[0],
            "variants_available": candidates,
            "variant_note": "",
        }
    if len(candidates) > 1:
        return {
            "ok": False,
            "error": "AMBIGUOUS_ASSET_NAME",
            "query": q,
            "variants_available": candidates,
            "variant_note": "存在多个同名资产，请带分类前缀指定。",
        }

    # Fuzzy substring candidates
    fuzzy = [aid for aid in all_ids if q.lower() in aid.lower()]
    return {
        "ok": False,
        "error": "ASSET_NOT_FOUND",
        "query": q,
        "suggestions": fuzzy[:10],
    }


def evaluate_slot_freshness(
    asset_id: str,
    slot_name: str,
    rec: dict[str, Any],
    catalog: dict[str, Any],
    allow_draft: bool = False,
) -> dict[str, Any]:
    out_file = LIBRARY_DIR / asset_id / rec["output"]["file"]
    source_rel = rec.get("source_rel", "")
    src_path = from_source_rel(source_rel) if source_rel else None
    notices: list[str] = []

    if not out_file.is_file():
        return {
            "status": "STALE_OUTPUT_MISSING",
            "reason": f"净图实体文件缺失: {out_file}",
            "notices": notices,
        }

    if src_path is None or not src_path.is_file():
        return {
            "status": "STALE_SOURCE_MISSING",
            "reason": f"绑定的源图已不存在: {source_rel}",
            "notices": notices,
        }

    st = src_path.stat()
    size_changed = st.st_size != rec.get("source_size_bytes")
    mtime_changed = st.st_mtime_ns != rec.get("source_mtime_ns")
    if size_changed or mtime_changed:
        cur_sha = shot_delivery.digest(src_path)
        if cur_sha != rec.get("source_sha256"):
            return {
                "status": "STALE_SOURCE_MODIFIED",
                "reason": f"源图内容已变更 ({source_rel}): old={str(rec.get('source_sha256', ''))[:12]} new={cur_sha[:12]}",
                "new_source_sha256": cur_sha,
                "new_source_size_bytes": st.st_size,
                "new_source_mtime_ns": st.st_mtime_ns,
                "notices": notices,
            }
        notices.append("NOTICE_SOURCE_TOUCHED_SAME_HASH")

    # Check Shading upgrade / sibling additions on the source asset
    src_asset_id = rec.get("source_asset_id") or infer_source_asset_id(source_rel) or asset_id
    cat_entry = catalog.get("assets", {}).get(src_asset_id) or catalog.get("assets", {}).get(asset_id)
    if cat_entry:
        shading_files = [f["rel"] for f in cat_entry.get("files", []) if f.get("tier") == "shading"]
        if rec.get("tier") == "design" and not rec.get("pin_design", False) and shading_files:
            return {
                "status": "STALE_SHADING_UPGRADED",
                "reason": f"资产 {src_asset_id} 已新增 Shading 正式预览图，可确认升级替代当前 Design 裁切",
                "shading_candidates": shading_files,
                "notices": notices,
            }
        if rec.get("tier") == "shading":
            known = set(rec.get("known_shading_siblings") or [])
            if known:
                new_siblings = [r for r in shading_files if r not in known]
                if new_siblings:
                    notices.append("NOTICE_NEW_SIBLING: " + ", ".join(new_siblings))

    slot_status = rec.get("status", "draft")
    if slot_status != "verified":
        if allow_draft:
            notices.append(f"STATUS_IS_{slot_status.upper()}")
        else:
            return {
                "status": "NEEDS_REVIEW",
                "reason": f"当前槽位状态为 '{slot_status}'，尚未人工 verify 确认",
                "notices": notices,
            }

    return {
        "status": "FRESH",
        "reason": "源图与净图校验一致",
        "notices": notices,
    }


def _trim_black_edges(im: Image.Image, max_trim: int = 8) -> Image.Image:
    arr = np.array(im.convert("L"))
    h, w = arr.shape
    top, bot, left, right = 0, h, 0, w
    for _ in range(max_trim):
        if bot - top <= 32 or right - left <= 32:
            break
        changed = False
        if top < h // 10 and np.percentile(arr[top, left:right], 95) <= 12:
            top += 1
            changed = True
        if bot > h * 9 // 10 and np.percentile(arr[bot - 1, left:right], 95) <= 12:
            bot -= 1
            changed = True
        if left < w // 10 and np.percentile(arr[top:bot, left], 95) <= 12:
            left += 1
            changed = True
        if right > w * 9 // 10 and np.percentile(arr[top:bot, right - 1], 95) <= 12:
            right -= 1
            changed = True
        if not changed:
            break
    if (left, top, right, bot) != (0, 0, w, h):
        return im.crop((left, top, right, bot))
    return im


def _mask_spheres(im: Image.Image) -> Image.Image:
    """
    Paint out the 3 PBR calibration spheres on bottom-right corner of Shading sheets
    by smoothly matching adjacent left studio background rows.
    """
    arr = np.array(im.convert("RGB"))
    ch, cw = arr.shape[:2]
    sx0, sx1 = max(0, int(cw * 0.76)), max(1, int(cw * 0.80))
    sy0, sy1 = int(ch * 0.55), ch
    global_bg = np.median(arr[int(ch * 0.44):int(ch * 0.52), int(cw * 0.82):int(cw * 0.94)], axis=(0, 1)).astype(np.uint8)
    x_start = int(cw * 0.80)
    for y in range(sy0, sy1):
        row_strip = arr[y, sx0:sx1]
        if row_strip.size and float(np.std(row_strip)) < 8.0:
            fill = np.median(row_strip, axis=0).astype(np.uint8)
        else:
            fill = global_bg
        arr[y, x_start:] = fill
    return Image.fromarray(arr)


def _mask_tl_label(im: Image.Image) -> Image.Image:
    """Mask out top-left text badge on sheets like ChangJian_BaiXue_Pro."""
    arr = np.array(im.convert("RGB"))
    ch, cw = arr.shape[:2]
    bg_patch = np.median(arr[:int(ch * 0.06), int(cw * 0.70):int(cw * 0.95)], axis=(0, 1)).astype(np.uint8)
    arr[:int(ch * 0.048), :int(cw * 0.30)] = bg_patch
    return Image.fromarray(arr)


def _archive_existing(asset_id: str, slot_name: str, out_path: pathlib.Path) -> str | None:
    if not out_path.is_file():
        return None
    arch_dir = LIBRARY_DIR / asset_id / "_archive"
    arch_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    arch_path = arch_dir / f"{slot_name}_{stamp}.png"
    counter = 1
    while arch_path.exists():
        arch_path = arch_dir / f"{slot_name}_{stamp}_{counter}.png"
        counter += 1
    shutil.copy2(out_path, arch_path)
    return str(arch_path.relative_to(LIBRARY_DIR / asset_id).as_posix())


def _write_slot_qc(
    asset_id: str,
    slot_name: str,
    src_im: Image.Image,
    out_im: Image.Image,
    box_pct: list[float] | None,
    info_line: str,
) -> pathlib.Path:
    qc_dir = LIBRARY_DIR / asset_id / "_qc"
    qc_dir.mkdir(parents=True, exist_ok=True)
    qc_path = qc_dir / f"{slot_name}_qc.jpg"

    panel_w, panel_h = 640, 480
    pad = 16
    top_bar = 44
    canvas = Image.new("RGB", (panel_w * 2 + pad * 3, panel_h + top_bar + pad), (18, 20, 26))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("msyh.ttc", 16)
    except Exception:
        font = ImageFont.load_default()

    draw.text((pad, 10), f"{asset_id}:{slot_name} | {info_line}", fill=(120, 225, 255), font=font)

    # Left: source overview + red crop box
    sw, sh = src_im.size
    left_im = src_im.copy()
    left_im.thumbnail((panel_w, panel_h), Image.Resampling.LANCZOS)
    lw, lh = left_im.size
    lx0 = pad + (panel_w - lw) // 2
    ly0 = top_bar + (panel_h - lh) // 2
    canvas.paste(left_im, (lx0, ly0))
    if box_pct is not None:
        rx0 = lx0 + int(round(box_pct[0] * lw))
        ry0 = ly0 + int(round(box_pct[1] * lh))
        rx1 = lx0 + int(round(box_pct[2] * lw))
        ry1 = ly0 + int(round(box_pct[3] * lh))
        draw.rectangle([rx0, ry0, rx1, ry1], outline=(255, 60, 60), width=3)

    # Right: cropped clean output
    right_im = out_im.copy()
    right_im.thumbnail((panel_w, panel_h), Image.Resampling.LANCZOS)
    rw, rh = right_im.size
    rx_pos = pad * 2 + panel_w + (panel_w - rw) // 2
    ry_pos = top_bar + (panel_h - rh) // 2
    canvas.paste(right_im, (rx_pos, ry_pos))
    draw.rectangle([rx_pos, ry_pos, rx_pos + rw, ry_pos + rh], outline=(80, 220, 140), width=2)

    canvas.save(qc_path, format="JPEG", quality=90)
    return qc_path


def _default_max_side(asset_id: str) -> int:
    return 1920 if asset_id.startswith("Scence/") else 1600


def _collect_shading_siblings(asset_id: str, src_asset_id: str | None, catalog: dict[str, Any]) -> list[str]:
    key = src_asset_id or asset_id
    entry = catalog.get("assets", {}).get(key) or {}
    return sorted(f["rel"] for f in entry.get("files", []) if f.get("tier") == "shading")


def crop_and_register(
    asset_id: str,
    slot_name: str,
    source: str | pathlib.Path,
    box_pct: list[float] | None = None,
    box_px: list[int] | None = None,
    post_ops: list[str] | None = None,
    max_side: int | None = None,
    view_desc: str = "",
    pin_design: bool = False,
    verify: bool = False,
    allow_dark_edge_reason: str = "",
) -> dict[str, Any]:
    ensure_vault_dirs()
    asset_id = normalize_asset_id(asset_id)
    src_path = pathlib.Path(source).resolve()
    if not src_path.is_file():
        raise FileNotFoundError(f"Source image not found: {src_path}")
    if box_pct is not None and box_px is not None:
        raise ValueError("Provide either box_pct or box_px, not both")

    ops = list(post_ops) if post_ops is not None else ["trim_black_edges"]
    if max_side is None:
        max_side = _default_max_side(asset_id)

    src_stat = src_path.stat()
    src_sha = shot_delivery.digest(src_path)
    source_rel = to_source_rel(src_path)
    src_asset_id = infer_source_asset_id(source_rel)
    tier = infer_tier_from_rel(source_rel)

    with Image.open(src_path) as raw_im:
        src_rgb = raw_im.convert("RGB")
        sw, sh = src_rgb.size

        computed_box_pct: list[float] | None = None
        if box_px is not None:
            x0, y0, x1, y1 = [int(v) for v in box_px]
            if not (0 <= x0 < x1 <= sw and 0 <= y0 < y1 <= sh):
                raise ValueError(f"Invalid box_px {box_px} for image {sw}x{sh}")
            computed_box_pct = [round(x0 / sw, 6), round(y0 / sh, 6), round(x1 / sw, 6), round(y1 / sh, 6)]
            work_im = src_rgb.crop((x0, y0, x1, y1))
        elif box_pct is not None:
            bx0, by0, bx1, by1 = [float(v) for v in box_pct]
            if not (0.0 <= bx0 < bx1 <= 1.0 and 0.0 <= by0 < by1 <= 1.0):
                raise ValueError(f"Invalid box_pct {box_pct}")
            computed_box_pct = [round(bx0, 6), round(by0, 6), round(bx1, 6), round(by1, 6)]
            px = (int(round(bx0 * sw)), int(round(by0 * sh)), int(round(bx1 * sw)), int(round(by1 * sh)))
            work_im = src_rgb.crop(px)
        else:
            work_im = src_rgb.copy()

        for op in ops:
            if op == "trim_black_edges":
                work_im = _trim_black_edges(work_im, max_trim=8)
            elif op == "mask_spheres":
                work_im = _mask_spheres(work_im)
            elif op == "mask_tl_label":
                work_im = _mask_tl_label(work_im)
            elif op:
                raise ValueError(f"Unknown post-op: {op}")

        cw, ch = work_im.size
        if max_side > 0 and max(cw, ch) > max_side:
            scale = max_side / max(cw, ch)
            work_im = work_im.resize((round(cw * scale), round(ch * scale)), Image.Resampling.LANCZOS)

        mattes = shot_delivery.detected_matte(work_im)
        if mattes and not allow_dark_edge_reason.strip():
            raise ValueError(
                f"Detected dark matte in cropped {asset_id}:{slot_name}: {mattes}. "
                "Adjust crop box or pass --allow-dark-edge-reason if genuinely dark border."
            )

        out_dir = LIBRARY_DIR / asset_id
        out_dir.mkdir(parents=True, exist_ok=True)
        out_name = f"{slot_name}.png"
        out_path = out_dir / out_name
        archived_rel = _archive_existing(asset_id, slot_name, out_path)

        tmp_out = out_path.with_suffix(".png.tmp")
        work_im.save(tmp_out, format="PNG", compress_level=6)
        os.replace(tmp_out, out_path)

        ow, oh = work_im.size
        qc_path = _write_slot_qc(
            asset_id, slot_name, src_rgb, work_im, computed_box_pct,
            f"{ow}x{oh} | tier={tier} | matte={mattes}"
        )

    out_sha = shot_delivery.digest(out_path)
    catalog = read_json(CATALOG_PATH, None)
    if catalog is None:
        catalog = scan_assets(save=True)
    known_siblings = _collect_shading_siblings(asset_id, src_asset_id, catalog) if tier == "shading" else []

    meta = load_asset_meta(asset_id)
    rec = {
        "asset_id": asset_id,
        "slot": slot_name,
        "tier": tier,
        "pin_design": bool(pin_design),
        "view_desc": view_desc,
        "source_rel": source_rel,
        "source_asset_id": src_asset_id,
        "source_sha256": src_sha,
        "source_size_bytes": src_stat.st_size,
        "source_mtime_ns": src_stat.st_mtime_ns,
        "source_dims": [sw, sh],
        "known_shading_siblings": known_siblings,
        "recipe": {
            "kind": "crop" if computed_box_pct is not None else "full_clean",
            "box_pct": computed_box_pct,
            "box_px_input": list(box_px) if box_px is not None else None,
            "post_ops": ops,
            "max_side": max_side,
        },
        "output": {
            "file": out_name,
            "dims": [ow, oh],
            "sha256": out_sha,
            "detected_matte": mattes,
            "edge_evidence": allow_dark_edge_reason.strip() or None,
        },
        "qc_image": str(qc_path.relative_to(LIBRARY_DIR / asset_id).as_posix()),
        "last_archived": archived_rel,
        "status": "verified" if verify else "draft",
        "updated_at": now_iso(),
    }
    meta.setdefault("slots", {})[slot_name] = rec
    save_asset_meta(asset_id, meta)
    sync_index_entry(asset_id, meta)
    return {
        "asset_id": asset_id,
        "slot": slot_name,
        "file": str(out_path.resolve()),
        "dims": [ow, oh],
        "tier": tier,
        "status": rec["status"],
        "detected_matte": mattes,
        "qc_image": str(qc_path.resolve()),
    }


def register_existing_file(
    asset_id: str,
    slot_name: str,
    clean_file: str | pathlib.Path,
    source: str | pathlib.Path,
    kind: str = "manual_override",
    view_desc: str = "",
    pin_design: bool = False,
    verify: bool = False,
    allow_dark_edge_reason: str = "",
) -> dict[str, Any]:
    ensure_vault_dirs()
    asset_id = normalize_asset_id(asset_id)
    if kind not in ("manual_override", "approved_anchor"):
        raise ValueError("kind must be manual_override or approved_anchor")

    clean_path = pathlib.Path(clean_file).resolve()
    src_path = pathlib.Path(source).resolve()
    if not clean_path.is_file():
        raise FileNotFoundError(f"Clean file not found: {clean_path}")
    if not src_path.is_file():
        raise FileNotFoundError(f"Source file not found: {src_path}")

    src_stat = src_path.stat()
    src_sha = shot_delivery.digest(src_path)
    source_rel = to_source_rel(src_path)
    src_asset_id = infer_source_asset_id(source_rel)
    tier = "approved_anchor" if kind == "approved_anchor" else infer_tier_from_rel(source_rel)

    with Image.open(src_path) as s_im:
        sw, sh = s_im.size
        src_rgb = s_im.convert("RGB")
    with Image.open(clean_path) as c_im:
        out_rgb = c_im.convert("RGB")
        ow, oh = out_rgb.size
        mattes = shot_delivery.detected_matte(out_rgb)
        if mattes and not allow_dark_edge_reason.strip():
            raise ValueError(f"Detected matte in registered clean file {clean_path}: {mattes}")

        out_dir = LIBRARY_DIR / asset_id
        out_dir.mkdir(parents=True, exist_ok=True)
        out_name = f"{slot_name}.png"
        out_path = out_dir / out_name
        archived_rel = _archive_existing(asset_id, slot_name, out_path)
        tmp_out = out_path.with_suffix(".png.tmp")
        out_rgb.save(tmp_out, format="PNG", compress_level=6)
        os.replace(tmp_out, out_path)
        qc_path = _write_slot_qc(
            asset_id, slot_name, src_rgb, out_rgb, None,
            f"{ow}x{oh} | kind={kind} | matte={mattes}"
        )

    out_sha = shot_delivery.digest(out_path)
    catalog = read_json(CATALOG_PATH, None)
    if catalog is None:
        catalog = scan_assets(save=True)
    known_siblings = _collect_shading_siblings(asset_id, src_asset_id, catalog) if tier == "shading" else []

    meta = load_asset_meta(asset_id)
    rec = {
        "asset_id": asset_id,
        "slot": slot_name,
        "tier": tier,
        "pin_design": bool(pin_design),
        "view_desc": view_desc,
        "source_rel": source_rel,
        "source_asset_id": src_asset_id,
        "source_sha256": src_sha,
        "source_size_bytes": src_stat.st_size,
        "source_mtime_ns": src_stat.st_mtime_ns,
        "source_dims": [sw, sh],
        "known_shading_siblings": known_siblings,
        "recipe": {
            "kind": kind,
            "registered_from": str(clean_path),
        },
        "output": {
            "file": out_name,
            "dims": [ow, oh],
            "sha256": out_sha,
            "detected_matte": mattes,
            "edge_evidence": allow_dark_edge_reason.strip() or None,
        },
        "qc_image": str(qc_path.relative_to(LIBRARY_DIR / asset_id).as_posix()),
        "last_archived": archived_rel,
        "status": "verified" if verify else "draft",
        "updated_at": now_iso(),
    }
    meta.setdefault("slots", {})[slot_name] = rec
    save_asset_meta(asset_id, meta)
    sync_index_entry(asset_id, meta)
    return {
        "asset_id": asset_id,
        "slot": slot_name,
        "file": str(out_path.resolve()),
        "dims": [ow, oh],
        "tier": tier,
        "status": rec["status"],
        "detected_matte": mattes,
        "qc_image": str(qc_path.resolve()),
    }


def verify_slot(asset_id: str, slot_name: str) -> dict[str, Any]:
    asset_id = normalize_asset_id(asset_id)
    meta = load_asset_meta(asset_id)
    rec = meta.get("slots", {}).get(slot_name)
    if not rec:
        raise KeyError(f"Slot not found: {asset_id}:{slot_name}")
    rec["status"] = "verified"
    rec["verified_at"] = now_iso()
    save_asset_meta(asset_id, meta)
    sync_index_entry(asset_id, meta)
    return {"asset_id": asset_id, "slot": slot_name, "status": "verified"}


def resolve_specs(
    specs: list[str],
    allow_draft: bool = False,
    strict: bool = False,
    refresh_catalog: bool = True,
) -> dict[str, Any]:
    catalog = scan_assets(save=True) if refresh_catalog else (read_json(CATALOG_PATH, None) or scan_assets(save=True))
    results = []
    all_fresh = True

    for spec in specs:
        if ":" in spec:
            asset_query, slot_csv = spec.split(":", 1)
            requested_slots = [s.strip() for s in slot_csv.split(",") if s.strip()]
        else:
            asset_query = spec
            requested_slots = []

        target = resolve_alias_target(asset_query, strict=strict)
        if not target.get("ok"):
            all_fresh = False
            results.append({
                "spec": spec,
                "status": target.get("error", "MISSING"),
                **target,
            })
            continue

        asset_id = target["asset_id"]
        meta = load_asset_meta(asset_id)
        slots_map = meta.get("slots", {})
        if not requested_slots:
            requested_slots = sorted(slots_map.keys())
        if not requested_slots:
            all_fresh = False
            results.append({
                "spec": spec,
                "asset_id": asset_id,
                "slot": None,
                "status": "MISSING",
                "reason": f"资产 {asset_id} 尚未入库任何净图槽位",
                "variants_available": target.get("variants_available", []),
                "variant_note": target.get("variant_note", ""),
            })
            continue

        for slot_name in requested_slots:
            rec = slots_map.get(slot_name)
            if not rec:
                all_fresh = False
                results.append({
                    "spec": f"{asset_id}:{slot_name}",
                    "asset_id": asset_id,
                    "slot": slot_name,
                    "status": "MISSING",
                    "available_slots": sorted(slots_map.keys()),
                    "variants_available": target.get("variants_available", []),
                    "variant_note": target.get("variant_note", ""),
                })
                continue

            fresh = evaluate_slot_freshness(asset_id, slot_name, rec, catalog, allow_draft=allow_draft)
            if fresh["status"] != "FRESH":
                all_fresh = False
            out_path = (LIBRARY_DIR / asset_id / rec["output"]["file"]).resolve()
            item = {
                "spec": f"{asset_id}:{slot_name}",
                "asset_id": asset_id,
                "slot": slot_name,
                "path": str(out_path),
                "tier": rec.get("tier"),
                "dims": rec["output"].get("dims"),
                "sha256": rec["output"].get("sha256"),
                "view_desc": rec.get("view_desc", ""),
                "source_rel": rec.get("source_rel"),
                "variants_available": target.get("variants_available", []),
                "variant_note": target.get("variant_note", ""),
                **fresh,
            }
            results.append(item)

    return {
        "checked_at": now_iso(),
        "catalog_elapsed_ms": catalog.get("elapsed_ms"),
        "all_fresh": all_fresh,
        "items": results,
    }


def check_file_freshness(file_path: pathlib.Path, catalog: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Used by shot_delivery.py to check whether a referenced file inside vault is stale."""
    resolved = file_path.resolve()
    try:
        rel = resolved.relative_to(LIBRARY_DIR.resolve())
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) < 3:
        return None
    asset_id = f"{parts[0]}/{parts[1]}"
    slot_name = pathlib.Path(parts[2]).stem
    meta = load_asset_meta(asset_id)
    rec = meta.get("slots", {}).get(slot_name)
    if not rec:
        return None
    if catalog is None:
        catalog = scan_assets(save=False)
    fresh = evaluate_slot_freshness(asset_id, slot_name, rec, catalog, allow_draft=False)
    return {"asset_id": asset_id, "slot": slot_name, "file": str(resolved), **fresh}


def audit_vault(refresh_catalog: bool = True) -> dict[str, Any]:
    catalog = scan_assets(save=True) if refresh_catalog else (read_json(CATALOG_PATH, None) or scan_assets(save=True))
    index = load_index()
    entries = []
    counts: dict[str, int] = {}

    for asset_id in sorted(index.get("assets", {}).keys()):
        meta = load_asset_meta(asset_id)
        for slot_name in sorted(meta.get("slots", {}).keys()):
            rec = meta["slots"][slot_name]
            fresh = evaluate_slot_freshness(asset_id, slot_name, rec, catalog, allow_draft=False)
            st = fresh["status"]
            counts[st] = counts.get(st, 0) + 1
            entries.append({
                "asset_id": asset_id,
                "slot": slot_name,
                "tier": rec.get("tier"),
                "source_rel": rec.get("source_rel"),
                "dims": rec["output"].get("dims"),
                **fresh,
            })

    return {
        "audited_at": now_iso(),
        "catalog_elapsed_ms": catalog.get("elapsed_ms"),
        "total_slots": len(entries),
        "counts": counts,
        "entries": entries,
    }


def rebuild_slot(asset_id: str, slot_name: str, dry_run: bool = False) -> dict[str, Any]:
    asset_id = normalize_asset_id(asset_id)
    meta = load_asset_meta(asset_id)
    rec = meta.get("slots", {}).get(slot_name)
    if not rec:
        raise KeyError(f"Slot not found: {asset_id}:{slot_name}")

    recipe = rec.get("recipe", {})
    kind = recipe.get("kind")
    if kind == "manual_override" or kind == "approved_anchor":
        raise RuntimeError(
            f"{asset_id}:{slot_name} 为 {kind} 人工精修/锚点图，禁止自动覆盖，请人工核对后使用 register-file 或 crop 更新。"
        )

    src_path = from_source_rel(rec["source_rel"])
    if not src_path.is_file():
        raise FileNotFoundError(f"Source image missing: {src_path}")

    with Image.open(src_path) as im:
        new_w, new_h = im.size
    old_w, old_h = rec.get("source_dims", [new_w, new_h])
    old_ar = old_w / max(1, old_h)
    new_ar = new_w / max(1, new_h)
    ar_diff = abs(new_ar - old_ar) / max(1e-9, old_ar)
    if ar_diff > 0.02:
        raise RuntimeError(
            f"源图宽高比变化 {ar_diff*100:.2f}% (>2%): {old_w}x{old_h} -> {new_w}x{new_h}，版式可能已改，拒绝盲目重裁，请人工重新指定裁切框。"
        )

    if dry_run:
        return {
            "dry_run": True,
            "asset_id": asset_id,
            "slot": slot_name,
            "old_source_dims": [old_w, old_h],
            "new_source_dims": [new_w, new_h],
            "aspect_diff_pct": round(ar_diff * 100, 3),
            "box_pct": recipe.get("box_pct"),
            "post_ops": recipe.get("post_ops"),
        }

    old_out = LIBRARY_DIR / asset_id / rec["output"]["file"]
    old_copy = None
    if old_out.is_file():
        with Image.open(old_out) as oim:
            old_copy = oim.convert("RGB")

    res = crop_and_register(
        asset_id=asset_id,
        slot_name=slot_name,
        source=src_path,
        box_pct=recipe.get("box_pct"),
        post_ops=recipe.get("post_ops"),
        max_side=recipe.get("max_side"),
        view_desc=rec.get("view_desc", ""),
        pin_design=rec.get("pin_design", False),
        verify=False,
        allow_dark_edge_reason=(rec.get("output", {}).get("edge_evidence") or ""),
    )
    # Mark explicitly as needs_review until human verifies rebuild
    meta2 = load_asset_meta(asset_id)
    meta2["slots"][slot_name]["status"] = "needs_review"
    save_asset_meta(asset_id, meta2)
    sync_index_entry(asset_id, meta2)
    res["status"] = "needs_review"

    if old_copy is not None:
        new_out = pathlib.Path(res["file"])
        with Image.open(new_out) as nim:
            new_rgb = nim.convert("RGB")
        diff_path = LIBRARY_DIR / asset_id / "_qc" / f"{slot_name}_rebuild_diff.jpg"
        cw, ch = 640, 480
        canvas = Image.new("RGB", (cw * 2 + 48, ch + 60), (18, 20, 26))
        d = ImageDraw.Draw(canvas)
        try:
            font = ImageFont.truetype("msyh.ttc", 16)
        except Exception:
            font = ImageFont.load_default()
        d.text((16, 12), f"OLD {asset_id}:{slot_name} ({old_copy.size[0]}x{old_copy.size[1]})", fill=(255, 190, 120), font=font)
        d.text((cw + 32, 12), f"NEW REBUILD ({new_rgb.size[0]}x{new_rgb.size[1]}) [needs_review]", fill=(120, 235, 160), font=font)
        old_copy.thumbnail((cw, ch), Image.Resampling.LANCZOS)
        new_rgb.thumbnail((cw, ch), Image.Resampling.LANCZOS)
        canvas.paste(old_copy, (16 + (cw - old_copy.width) // 2, 46 + (ch - old_copy.height) // 2))
        canvas.paste(new_rgb, (cw + 32 + (cw - new_rgb.width) // 2, 46 + (ch - new_rgb.height) // 2))
        canvas.save(diff_path, format="JPEG", quality=90)
        res["diff_image"] = str(diff_path.resolve())

    return res


def build_contact_sheet(out_path: pathlib.Path, cols: int = 5) -> dict[str, Any]:
    index = load_index()
    catalog = read_json(CATALOG_PATH, None) or scan_assets(save=False)
    items = []
    for asset_id in sorted(index.get("assets", {}).keys()):
        meta = load_asset_meta(asset_id)
        for slot_name in sorted(meta.get("slots", {}).keys()):
            rec = meta["slots"][slot_name]
            fp = LIBRARY_DIR / asset_id / rec["output"]["file"]
            if fp.is_file():
                fresh = evaluate_slot_freshness(asset_id, slot_name, rec, catalog, allow_draft=True)
                items.append((asset_id, slot_name, fp, rec, fresh["status"]))

    if not items:
        raise RuntimeError("Vault has no slots to render contact sheet")

    tw, th = 360, 320
    pad_top = 42
    rows = math.ceil(len(items) / cols)
    canvas = Image.new("RGB", (cols * tw, rows * (th + pad_top) + 20), (16, 18, 22))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("msyh.ttc", 14)
        font_sm = ImageFont.truetype("msyh.ttc", 12)
    except Exception:
        font = ImageFont.load_default()
        font_sm = font

    for idx, (aid, sl, fp, rec, st) in enumerate(items):
        r, c = divmod(idx, cols)
        x0 = c * tw
        y0 = 10 + r * (th + pad_top)
        with Image.open(fp) as im:
            rgb = im.convert("RGB")
            dims = rgb.size
            rgb.thumbnail((tw - 16, th - 12), Image.Resampling.LANCZOS)
        color = (110, 235, 160) if st == "FRESH" else (255, 200, 90)
        draw.text((x0 + 8, y0 + 2), f"{aid}:{sl}", fill=color, font=font)
        draw.text((x0 + 8, y0 + 20), f"{dims[0]}x{dims[1]} | {rec.get('tier')} | {st}", fill=(190, 200, 215), font=font_sm)
        px = x0 + (tw - rgb.width) // 2
        py = y0 + pad_top + (th - 12 - rgb.height) // 2
        canvas.paste(rgb, (px, py))
        draw.rectangle([x0 + 4, y0, x0 + tw - 4, y0 + th + pad_top - 4], outline=(42, 46, 56), width=1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, format="JPEG", quality=90)
    return {"out": str(out_path.resolve()), "count": len(items), "size": list(canvas.size)}


# --- Dreamina upload deduplication cache ---

def get_cached_upload(project_id: str, file_sha256: str) -> str | None:
    with _UPLOAD_CACHE_LOCK:
        cache = read_json(UPLOAD_CACHE_PATH, {})
        proj = cache.get(project_id, {})
        rec = proj.get(file_sha256)
        if isinstance(rec, dict):
            return rec.get("resource_id")
        if isinstance(rec, str):
            return rec
        return None


def record_cached_upload(project_id: str, file_sha256: str, resource_id: str, filename: str) -> None:
    with _UPLOAD_CACHE_LOCK:
        ensure_vault_dirs()
        cache = read_json(UPLOAD_CACHE_PATH, {})
        proj = cache.setdefault(project_id, {})
        proj[file_sha256] = {
            "resource_id": resource_id,
            "filename": filename,
            "cached_at": now_iso(),
        }
        atomic_write_json(UPLOAD_CACHE_PATH, cache)


def _list_cmd(args: argparse.Namespace) -> None:
    catalog = read_json(CATALOG_PATH, None) or scan_assets(save=True)
    index = load_index()
    q = (args.query or "").strip().lower()
    cat_filter = args.category

    alias_target = None
    if q:
        res = resolve_alias_target(q, strict=False)
        if res.get("ok"):
            alias_target = res["asset_id"].lower()

    if args.sources:
        hits = []
        for aid, entry in sorted(catalog.get("assets", {}).items()):
            if cat_filter and not aid.lower().startswith(cat_filter.lower() + "/"):
                continue
            if q and q not in aid.lower() and (not alias_target or aid.lower() != alias_target):
                continue
            hits.append({"asset_id": aid, "has_shading": entry["has_shading"], "files": entry["files"]})
        print(json.dumps({"count": len(hits), "assets": hits}, ensure_ascii=False, indent=2))
        return

    hits = []
    for aid, ainfo in sorted(index.get("assets", {}).items()):
        if cat_filter and not aid.lower().startswith(cat_filter.lower() + "/"):
            continue
        if q and q not in aid.lower() and (not alias_target or aid.lower() != alias_target):
            continue
        meta = load_asset_meta(aid)
        slots_out = {}
        for sname, rec in meta.get("slots", {}).items():
            fresh = evaluate_slot_freshness(aid, sname, rec, catalog, allow_draft=True)
            if args.stale_only and fresh["status"] == "FRESH":
                continue
            slots_out[sname] = {
                "path": str((LIBRARY_DIR / aid / rec["output"]["file"]).resolve()),
                "tier": rec.get("tier"),
                "dims": rec["output"].get("dims"),
                "view_desc": rec.get("view_desc", ""),
                "freshness": fresh["status"],
                "slot_status": rec.get("status"),
            }
        if slots_out:
            hits.append({"asset_id": aid, "slots": slots_out})
    print(json.dumps({"count": len(hits), "assets": hits}, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("scan", help="Scan Y:\\TX\\Assets (read-only) and update source_catalog.json")

    p_list = sub.add_parser("list", help="List vaulted assets or source files")
    p_list.add_argument("--category", help="Character | Scence | Pro | VFX")
    p_list.add_argument("--query", help="Asset ID, Chinese alias, or substring")
    p_list.add_argument("--sources", action="store_true", help="List source files from catalog")
    p_list.add_argument("--stale-only", action="store_true", help="Show only non-FRESH slots")

    p_res = sub.add_parser("resolve", help="Resolve <asset>:<slot1,slot2> specs with real-time freshness checks")
    p_res.add_argument("specs", nargs="+", help="e.g. '陆隐:front,back,face' or 'Character/LuYin_Xin:front'")
    p_res.add_argument("--json", action="store_true", help="Print JSON output (default JSON)")
    p_res.add_argument("--allow-draft", action="store_true", help="Allow draft/needs_review slots")
    p_res.add_argument("--strict", action="store_true", help="Require explicit version when multiple variants exist")
    p_res.add_argument("--no-scan", action="store_true", help="Use cached source_catalog.json instead of rescanning")

    p_crop = sub.add_parser("crop", help="Crop a clean single-panel ref into the vault")
    p_crop.add_argument("--asset", required=True, help="e.g. Character/ZhangDingTian")
    p_crop.add_argument("--slot", required=True, help="e.g. front, back, face, gorge")
    p_crop.add_argument("--source", required=True, help="Source image path")
    p_crop.add_argument("--box-pct", nargs=4, type=float, metavar=("X0", "Y0", "X1", "Y1"))
    p_crop.add_argument("--box-px", nargs=4, type=int, metavar=("X0", "Y0", "X1", "Y1"))
    p_crop.add_argument("--post-ops", default="trim_black_edges", help="Comma-separated: trim_black_edges,mask_spheres,mask_tl_label")
    p_crop.add_argument("--max-side", type=int, default=None)
    p_crop.add_argument("--view-desc", default="")
    p_crop.add_argument("--pin-design", action="store_true")
    p_crop.add_argument("--verify", action="store_true")
    p_crop.add_argument("--allow-dark-edge-reason", default="")

    p_reg = sub.add_parser("register-file", help="Register an externally cleaned/approved PNG bound to its source")
    p_reg.add_argument("--asset", required=True)
    p_reg.add_argument("--slot", required=True)
    p_reg.add_argument("--file", required=True)
    p_reg.add_argument("--source", required=True)
    p_reg.add_argument("--kind", default="manual_override", choices=["manual_override", "approved_anchor"])
    p_reg.add_argument("--view-desc", default="")
    p_reg.add_argument("--pin-design", action="store_true")
    p_reg.add_argument("--verify", action="store_true")
    p_reg.add_argument("--allow-dark-edge-reason", default="")

    p_ver = sub.add_parser("verify", help="Mark a slot as verified")
    p_ver.add_argument("--asset", required=True)
    p_ver.add_argument("--slot", required=True)

    p_aud = sub.add_parser("audit", help="Audit all vaulted slots against current source files")
    p_aud.add_argument("--json", action="store_true")
    p_aud.add_argument("--no-scan", action="store_true")

    p_reb = sub.add_parser("rebuild", help="Rebuild a STALE_SOURCE_MODIFIED crop slot using its saved box_pct")
    p_reb.add_argument("--asset", required=True)
    p_reb.add_argument("--slot", required=True)
    p_reb.add_argument("--dry-run", action="store_true")

    p_cs = sub.add_parser("contact-sheet", help="Render contact sheet of all vaulted slots")
    p_cs.add_argument("--out", default=str(VAULT_DIR / "vault_contact_sheet.jpg"))
    p_cs.add_argument("--cols", type=int, default=5)

    args = parser.parse_args()
    if args.command == "scan":
        cat = scan_assets(save=True)
        print(json.dumps({
            "scanned_at": cat["scanned_at"],
            "assets_root": cat["assets_root"],
            "elapsed_ms": cat["elapsed_ms"],
            "asset_count": cat["asset_count"],
            "file_count": cat["file_count"],
            "catalog": str(CATALOG_PATH),
        }, ensure_ascii=False, indent=2))
    elif args.command == "list":
        _list_cmd(args)
    elif args.command == "resolve":
        res = resolve_specs(args.specs, allow_draft=args.allow_draft, strict=args.strict, refresh_catalog=not args.no_scan)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        if not res["all_fresh"]:
            sys.exit(2)
    elif args.command == "crop":
        ops = [x.strip() for x in args.post_ops.split(",") if x.strip()]
        out = crop_and_register(
            asset_id=args.asset,
            slot_name=args.slot,
            source=args.source,
            box_pct=args.box_pct,
            box_px=args.box_px,
            post_ops=ops,
            max_side=args.max_side,
            view_desc=args.view_desc,
            pin_design=args.pin_design,
            verify=args.verify,
            allow_dark_edge_reason=args.allow_dark_edge_reason,
        )
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif args.command == "register-file":
        out = register_existing_file(
            asset_id=args.asset,
            slot_name=args.slot,
            clean_file=args.file,
            source=args.source,
            kind=args.kind,
            view_desc=args.view_desc,
            pin_design=args.pin_design,
            verify=args.verify,
            allow_dark_edge_reason=args.allow_dark_edge_reason,
        )
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif args.command == "verify":
        print(json.dumps(verify_slot(args.asset, args.slot), ensure_ascii=False, indent=2))
    elif args.command == "audit":
        res = audit_vault(refresh_catalog=not args.no_scan)
        if args.json:
            print(json.dumps(res, ensure_ascii=False, indent=2))
        else:
            print(f"Vault audit ({res['catalog_elapsed_ms']}ms scan): total={res['total_slots']} | counts={res['counts']}")
            for e in res["entries"]:
                if e["status"] != "FRESH" or e["notices"]:
                    print(f"  [{e['status']}] {e['asset_id']}:{e['slot']} | {e['reason']} | notices={e['notices']}")
    elif args.command == "rebuild":
        res = rebuild_slot(args.asset, args.slot, dry_run=args.dry_run)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.command == "contact-sheet":
        res = build_contact_sheet(pathlib.Path(args.out), cols=args.cols)
        print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
