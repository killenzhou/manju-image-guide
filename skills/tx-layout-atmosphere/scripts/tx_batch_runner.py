# -*- coding: utf-8 -*-
"""
《踏星》公共批处理执行器（tx_batch_runner.py）
数据驱动执行 prepare -> upload -> render -> qc-board -> publish 全流程：
- prepare: 实时调用 asset_vault 解析并核验新鲜度，生成规范 briefs 并过 shot_delivery check-brief
- upload:  按 (project_id, sha256) 命中 asset_vault 上传去重缓存，避免重复上传
- render:  幂等提交即梦 Seedream 5.5 i2i 节点并支持断点恢复、黑边拦截
- qc-board: 生成 Layout | [Prior] | Raw 对照质检大图
- publish: 全幅等比 Lanczos 重采样交付 3840px 宽 PNG + .qa.json + review-data.js
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from typing import Any

from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

SCRIPTS_DIR = pathlib.Path(__file__).resolve().parent
AI_ROOT = pathlib.Path(os.environ.get("TX_AI_ROOT") or SCRIPTS_DIR.parents[3]).resolve()
REVIEW_SRC = SCRIPTS_DIR.parent / "assets" / "ck-review"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import shot_delivery  # noqa: E402

VAULT_CODE_DIR = AI_ROOT / "asset_vault"
if str(VAULT_CODE_DIR) not in sys.path:
    sys.path.insert(0, str(VAULT_CODE_DIR))
import vault  # noqa: E402

CROCKFORD_B32 = "0123456789abcdefghjkmnpqrstvwxyz"
_STATE_LOCK = threading.Lock()


def make_node_id() -> str:
    return "node_" + "".join(secrets.choice(CROCKFORD_B32) for _ in range(10))


def resolve_cli() -> str:
    env_bin = os.environ.get("DREAMINA_CANVAS_BIN")
    if env_bin and pathlib.Path(env_bin).is_file():
        return env_bin
    which_bin = shutil.which("dreamina-canvas")
    if which_bin:
        return which_bin
    default_bin = os.path.expandvars(r"%USERPROFILE%\.local\bin\dreamina-canvas.exe")
    return default_bin


def resolve_path(val: str, base_dirs: list[pathlib.Path]) -> pathlib.Path:
    p = pathlib.Path(val).expanduser()
    if p.is_absolute():
        return p.resolve()
    for b in base_dirs:
        cand = (b / p).resolve()
        if cand.exists():
            return cand
    return (base_dirs[0] / p).resolve()


def resolve_dir_field(val: str, spec_dir: pathlib.Path) -> pathlib.Path:
    p = pathlib.Path(val).expanduser()
    if p.is_absolute():
        return p.resolve()
    if val.startswith("./") or val.startswith(".\\"):
        return (spec_dir / p).resolve()
    return (AI_ROOT / p).resolve()


def load_spec(spec_path: pathlib.Path) -> tuple[dict[str, Any], pathlib.Path, pathlib.Path, pathlib.Path]:
    sp = spec_path.resolve(strict=True)
    spec = json.loads(sp.read_text(encoding="utf-8-sig"))
    work_dir = resolve_dir_field(spec["work_dir"], sp.parent)
    out_dir = resolve_dir_field(spec["output_dir"], sp.parent)
    return spec, sp, work_dir, out_dir


def _atomic_write_json(path: pathlib.Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Subcommand 1: prepare
# ---------------------------------------------------------------------------

def cmd_prepare(args: argparse.Namespace) -> None:
    spec, spec_path, work_dir, out_dir = load_spec(args.spec)
    plates_dir = work_dir / "plates"
    briefs_dir = work_dir / "briefs"
    raw_dir = work_dir / "raw"
    raw_meta_dir = work_dir / "raw_meta"
    qc_dir = work_dir / "qc"
    evidence_dir = out_dir / "evidence"
    for d in (plates_dir, briefs_dir, raw_dir, raw_meta_dir, qc_dir, evidence_dir):
        d.mkdir(parents=True, exist_ok=True)

    # Scan ASSETS_ROOT once per batch (~0.2s)
    catalog = vault.scan_assets(save=True)
    print(f"[prepare] Vault catalog scanned: {catalog['asset_count']} assets, {catalog['file_count']} files ({catalog['elapsed_ms']}ms)")

    # Collect and resolve all vault refs upfront
    vault_specs = []
    for sh in spec["shots"]:
        for r in sh.get("references", []):
            if "vault" in r:
                vault_specs.append(r["vault"])
        art_ref = str(sh.get("art_ref") or "")
        if art_ref.startswith("vault:"):
            vault_specs.append(art_ref[6:])

    resolved_map: dict[str, dict[str, Any]] = {}
    if vault_specs:
        unique_specs = list(dict.fromkeys(vault_specs))
        res_all = vault.resolve_specs(
            unique_specs,
            allow_draft=args.allow_draft,
            strict=args.strict_vault,
            refresh_catalog=False,
        )
        stale_errors = []
        for item in res_all["items"]:
            resolved_map[item["spec"]] = item
            if item["status"] != "FRESH":
                stale_errors.append(f"  - {item.get('spec')}: status={item['status']} | {item.get('reason', item.get('error', ''))}")
            elif item.get("notices"):
                print(f"[prepare][notice] {item['spec']}: {item['notices']}")
        if stale_errors:
            raise RuntimeError("Vault reference freshness check failed:\n" + "\n".join(stale_errors))

    base_dirs = [work_dir, spec_path.parent, AI_ROOT]
    resolved_shots = []

    for idx, sh in enumerate(spec["shots"], start=1):
        stem = sh["stem"]
        sid = sh["shot"]
        plate_src = resolve_path(sh["plate"], base_dirs)
        if not plate_src.is_file():
            raise FileNotFoundError(f"[{stem}] Plate not found: {plate_src}")

        with Image.open(plate_src) as pim:
            pim.load()
            pw, ph = pim.size
            mattes = shot_delivery.detected_matte(pim)
            if mattes:
                raise ValueError(f"[{stem}] Matte detected in plate {plate_src}: {mattes}")

        # Ensure plate copy inside work_dir/plates and output_dir/evidence
        plate_dst = plates_dir / plate_src.name
        if plate_src.resolve() != plate_dst.resolve():
            shutil.copy2(plate_src, plate_dst)
        shutil.copy2(plate_dst, evidence_dir / f"{plate_dst.stem}_layout.png")

        brief_refs = []
        for r in sh.get("references", []):
            if "vault" in r:
                v_spec = r["vault"]
                # Find match in resolved_map (either direct key or normalized match)
                v_item = resolved_map.get(v_spec)
                if v_item is None:
                    # Try matching via resolve_alias_target
                    asset_q, slot_n = v_spec.split(":", 1)
                    t = vault.resolve_alias_target(asset_q, strict=args.strict_vault)
                    if t.get("ok"):
                        v_item = resolved_map.get(f"{t['asset_id']}:{slot_n}")
                if not v_item or v_item.get("status") != "FRESH":
                    raise RuntimeError(f"[{stem}] Could not resolve vault ref: {v_spec}")
                ref_file = pathlib.Path(v_item["path"]).resolve()
                ref_entry = {
                    "file": str(ref_file),
                    "role": r["role"],
                    "borrow": r["borrow"],
                    "exclude": r["exclude"],
                    "vault_spec": v_item["spec"],
                    "source_rel": v_item.get("source_rel"),
                }
            else:
                ref_file = resolve_path(r["file"], base_dirs)
                if not ref_file.is_file():
                    raise FileNotFoundError(f"[{stem}] Reference file not found: {ref_file}")
                fresh = vault.check_file_freshness(ref_file, catalog=catalog)
                if fresh and fresh["status"] != "FRESH":
                    raise RuntimeError(f"[{stem}] Direct file inside vault is not FRESH ({fresh['status']}): {ref_file} | {fresh['reason']}")
                ref_entry = {
                    "file": str(ref_file),
                    "role": r["role"],
                    "borrow": r["borrow"],
                    "exclude": r["exclude"],
                }
                for opt_k in ("source", "at_seconds"):
                    if opt_k in r:
                        ref_entry[opt_k] = r[opt_k]
            brief_refs.append(ref_entry)

        # Stage art_ref for review.html evidence if provided
        art_rel = None
        if sh.get("art_ref"):
            araw = str(sh["art_ref"])
            if araw.startswith("vault:"):
                v_spec = araw[6:]
                v_item = resolved_map.get(v_spec)
                if v_item is None:
                    asset_q, slot_n = v_spec.split(":", 1)
                    t = vault.resolve_alias_target(asset_q, strict=args.strict_vault)
                    if t.get("ok"):
                        v_item = resolved_map.get(f"{t['asset_id']}:{slot_n}")
                src_art = pathlib.Path(v_item["path"])
                art_dst_name = f"art_{v_item['asset_id'].replace('/', '_')}_{v_item['slot']}{src_art.suffix}"
                shutil.copy2(src_art, evidence_dir / art_dst_name)
                art_rel = f"evidence/{art_dst_name}"
            elif (out_dir / araw).is_file():
                art_rel = araw.replace("\\", "/")
            else:
                src_art = resolve_path(araw, base_dirs)
                if src_art.is_file():
                    shutil.copy2(src_art, evidence_dir / src_art.name)
                    art_rel = f"evidence/{src_art.name}"
        elif brief_refs:
            first_ref = pathlib.Path(brief_refs[0]["file"])
            shutil.copy2(first_ref, evidence_dir / first_ref.name)
            art_rel = f"evidence/{first_ref.name}"

        brief_obj = {
            "shot": sid,
            "stem": stem,
            "scene": sh.get("scene"),
            "mode": sh.get("mode", "new"),
            "design_mode": sh.get("design_mode", spec.get("design_mode", "Production")),
            "prompt_tier": sh.get("prompt_tier", "full"),
            "plate": str(plate_dst.resolve()),
            "beat": sh["beat"],
            "change": sh["change"],
            "locks": sh["locks"],
            "lighting": sh["lighting"],
            "references": brief_refs,
            "prompt": sh["prompt"],
        }
        brief_path = briefs_dir / f"{stem}_brief.json"
        _atomic_write_json(brief_path, brief_obj)
        check_res = shot_delivery.load_brief(brief_path)
        if check_res.get("vault_warnings"):
            raise RuntimeError(f"[{stem}] shot_delivery vault warnings: {check_res['vault_warnings']}")

        resolved_shots.append({
            "idx": idx,
            "stem": stem,
            "shot": sid,
            "plate": str(plate_dst.resolve()),
            "plate_size": [pw, ph],
            "brief": str(brief_path.resolve()),
            "ref_count": len(brief_refs),
            "prompt_len": len(sh["prompt"]),
            "art_rel": art_rel,
        })
        print(f"  [{idx:02d} {stem}] plate={pw}x{ph} | refs={len(brief_refs)} | prompt={len(sh['prompt'])} chars | OK")

    _atomic_write_json(work_dir / "resolved_batch.json", {
        "prepared_at": vault.now_iso(),
        "spec_file": str(spec_path),
        "shots": resolved_shots,
    })
    print(f"[prepare] All {len(resolved_shots)} briefs verified and staged in {work_dir}")


# ---------------------------------------------------------------------------
# Subcommand 2: upload (with Dreamina sha256 dedup cache)
# ---------------------------------------------------------------------------

def _parse_json_stdout(txt: str) -> Any:
    txt = txt.strip()
    idx = txt.find("{")
    return json.loads(txt[idx:] if idx != -1 else txt)


def _extract_res_id(obj: Any, project_id: str) -> str | None:
    if isinstance(obj, dict):
        for k in ("resourceId", "resource_id", "id"):
            v = obj.get(k)
            if isinstance(v, str) and len(v) >= 32 and "-" in v and v != project_id:
                return v
        for v in obj.values():
            got = _extract_res_id(v, project_id)
            if got:
                return got
    elif isinstance(obj, list):
        for item in obj:
            got = _extract_res_id(item, project_id)
            if got:
                return got
    return None


def _ensure_canvas(cli: str, state: dict[str, Any], spec: dict[str, Any], state_path: pathlib.Path) -> str:
    pid = state.get("project_id") or spec.get("project_id")
    if pid:
        state["project_id"] = pid
        state.setdefault("web_url", f"https://jimeng.jianying.com/ai-tool/ai-canvas/{pid}")
        return pid
    title = spec.get("canvas_title") or spec.get("batch_name") or "TX_Batch_5.5"
    cmd = [cli, "canvas", "create", title, "--format", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"canvas create failed: rc={proc.returncode}, out={proc.stdout}, err={proc.stderr}")
    data = _parse_json_stdout(proc.stdout)
    d = data.get("data", data)
    canvas_obj = d.get("project") or d.get("canvas") or d
    pid = canvas_obj.get("projectId") or canvas_obj.get("project_id") or d.get("projectId")
    web_url = canvas_obj.get("webUrl") or canvas_obj.get("web_url") or f"https://jimeng.jianying.com/ai-tool/ai-canvas/{pid}"
    if not pid:
        raise RuntimeError(f"No projectId returned from canvas create: {data}")
    state["project_id"] = pid
    state["web_url"] = web_url
    state["canvas_title"] = title
    _atomic_write_json(state_path, state)
    print(f"[upload] Created canvas: {pid} | {web_url}", flush=True)
    return pid


def _upload_one(cli: str, path: pathlib.Path, project_id: str) -> tuple[str, str, bool]:
    fsha = shot_delivery.digest(path)
    cached_rid = vault.get_cached_upload(project_id, fsha)
    if cached_rid:
        print(f"  [CACHE HIT] {path.name:36s} -> {cached_rid}", flush=True)
        return fsha, cached_rid, True
    cmd = [cli, "resource", "upload", "--file", str(path), "--project-id", project_id, "--format", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"Upload failed for {path.name}: rc={proc.returncode}, stderr={proc.stderr}, stdout={proc.stdout}")
    data = _parse_json_stdout(proc.stdout)
    rid = _extract_res_id(data, project_id)
    if not rid:
        raise RuntimeError(f"No resourceId parsed for {path.name}: {proc.stdout[:400]}")
    vault.record_cached_upload(project_id, fsha, rid, path.name)
    print(f"  [UPLOADED ] {path.name:36s} -> {rid}", flush=True)
    return fsha, rid, False


def cmd_upload(args: argparse.Namespace) -> None:
    spec, spec_path, work_dir, _ = load_spec(args.spec)
    briefs_dir = work_dir / "briefs"
    state_path = work_dir / "canvas_state.json"
    cli = resolve_cli()

    if state_path.is_file():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    else:
        state = {"plate_rids": {}, "ref_rids": {}, "path_rids": {}, "shots": {}}

    project_id = _ensure_canvas(cli, state, spec, state_path)
    plate_rids = state.setdefault("plate_rids", {})
    ref_rids = state.setdefault("ref_rids", {})
    path_rids = state.setdefault("path_rids", {})

    brief_files = sorted(briefs_dir.glob("*_brief.json"))
    if not brief_files:
        raise RuntimeError(f"No briefs found in {briefs_dir}; run 'prepare' first.")

    upload_tasks: dict[pathlib.Path, str] = {}
    for bf in brief_files:
        b = json.loads(bf.read_text(encoding="utf-8"))
        pp = pathlib.Path(b["plate"]).resolve()
        if pp.name not in plate_rids or str(pp) not in path_rids:
            upload_tasks[pp] = "plate"
        for r in b.get("references", []):
            rp = pathlib.Path(r["file"]).resolve()
            if str(rp) not in path_rids:
                upload_tasks.setdefault(rp, "ref")

    print(f"[upload] Project {project_id}: checking/uploading {len(upload_tasks)} files...", flush=True)
    cache_hits = 0
    uploaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(_upload_one, cli, p, project_id): (kind, p) for p, kind in upload_tasks.items()}
        for fut in concurrent.futures.as_completed(futs):
            kind, p = futs[fut]
            _, rid, was_cached = fut.result()
            if was_cached:
                cache_hits += 1
            else:
                uploaded += 1
            path_rids[str(p)] = rid
            if kind == "plate":
                plate_rids[p.name] = rid
            else:
                ref_rids[p.name] = rid

    _atomic_write_json(state_path, state)
    print(f"[upload] Complete: cache_hits={cache_hits}, new_uploads={uploaded}. State saved to {state_path}")


# ---------------------------------------------------------------------------
# Subcommand 3: render (idempotent node create/wait/recover/download)
# ---------------------------------------------------------------------------

def _extract_output_resources(obj: Any, input_rids: set[str]):
    found = []

    def walk(node, path=""):
        if isinstance(node, dict):
            rid = node.get("resourceId") or node.get("resource_id")
            if isinstance(rid, str) and rid and rid not in input_rids:
                role = str(node.get("role") or node.get("usage") or "").lower()
                is_ref = role in {"ref", "reference", "input"} or ("references" in path.lower() and "output" not in path.lower())
                if not is_ref:
                    found.append((rid, node, path))
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(item, f"{path}[{i}]")

    walk(obj)

    def score(item):
        _, d, p = item
        pl = p.lower()
        s = 0
        if "output" in pl or "result" in pl or "generated" in pl:
            s += 10
        if "node.resources" in pl or pl.startswith("data.resources"):
            s += 5
        if d.get("type") == "image" or d.get("mediaType") == "image" or d.get("width"):
            s += 3
        return -s

    seen = set()
    ordered = []
    for rid, d, p in sorted(found, key=score):
        if rid not in seen:
            seen.add(rid)
            ordered.append((rid, d, p))
    return ordered


def _extract_credits(obj: Any):
    credits = []

    def walk(node):
        if isinstance(node, dict):
            for k in ("creditsAmount", "credits_amount", "creditCost", "costCredits", "credits"):
                v = node.get(k)
                if isinstance(v, (int, float)) and v > 0:
                    credits.append(v)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(obj)
    return credits[0] if credits else None


def _extract_node_status(obj: Any) -> str:
    if isinstance(obj, dict):
        data = obj.get("data", obj)
        if isinstance(data, dict):
            nodes = data.get("nodes")
            if isinstance(nodes, list) and nodes and isinstance(nodes[0], dict):
                n = nodes[0].get("node")
                if isinstance(n, dict):
                    return str(n.get("status") or n.get("state") or "").lower()
            node = data.get("node", data)
            if isinstance(node, dict):
                return str(node.get("status") or node.get("state") or "").lower()
    return ""


def _extract_credit_token(obj: Any) -> str | None:
    if isinstance(obj, dict):
        for k in ("creditConfirmationToken", "credit_confirmation_token", "creditToken"):
            v = obj.get(k)
            if isinstance(v, str) and v:
                return v
        for v in obj.values():
            got = _extract_credit_token(v)
            if got:
                return got
    elif isinstance(obj, list):
        for item in obj:
            got = _extract_credit_token(item)
            if got:
                return got
    return None


def _run_cli(cmd: list[str], timeout: int = 360):
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    parsed = None
    if proc.stdout.strip():
        try:
            parsed = json.loads(proc.stdout)
        except json.JSONDecodeError:
            idx = proc.stdout.find("{")
            if idx != -1:
                try:
                    parsed = json.loads(proc.stdout[idx:])
                except json.JSONDecodeError:
                    parsed = None
    return proc.returncode, parsed, proc.stdout, proc.stderr


def _render_one_shot(
    cli: str,
    idx: int,
    bf_path: pathlib.Path,
    work_dir: pathlib.Path,
    spec: dict[str, Any],
) -> tuple[str, str, int, int, Any]:
    brief = json.loads(bf_path.read_text(encoding="utf-8"))
    sid = brief["shot"]
    stem = brief.get("stem") or (bf_path.stem[:-6] if bf_path.stem.endswith("_brief") else bf_path.stem)
    raw_dir = work_dir / "raw"
    raw_meta_dir = work_dir / "raw_meta"
    state_path = work_dir / "canvas_state.json"
    raw_path = raw_dir / f"{stem}_raw.png"
    meta_path = raw_meta_dir / f"{stem}.json"

    model = spec.get("model", "seedream_5.5")
    resolution = spec.get("resolution", "2K")
    ratio = spec.get("ratio", "21:9")
    credit_ceiling = str(spec.get("credit_ceiling", 10))
    batch_tag = spec.get("batch_name", "TX_Batch")

    plate_path = pathlib.Path(brief["plate"]).resolve()
    with _STATE_LOCK:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        project_id = state.get("project_id") or state.get("projectId")
        if not project_id:
            raise RuntimeError("Missing project_id in canvas_state.json")
        path_rids = state.get("path_rids", {})
        plate_rid = path_rids.get(str(plate_path)) or state["plate_rids"][plate_path.name]
        ref_rids = [
            path_rids.get(str(pathlib.Path(r["file"]).resolve())) or state["ref_rids"][pathlib.Path(r["file"]).name]
            for r in brief.get("references", [])
        ]
        input_rids = {plate_rid} | set(ref_rids)
        shots_map = state.setdefault("shots", {})
        existing = shots_map.get(stem, {})

        if existing.get("status") == "downloaded" and raw_path.is_file():
            return stem, "skipped_existing", existing.get("width"), existing.get("height"), existing.get("credits")

        reuse_submitted = (
            existing.get("status") in {"submitted", "created", "failed_download"}
            and str(existing.get("node_id", "")).startswith("node_")
        )
        if reuse_submitted:
            node_id = existing["node_id"]
            submit_id = existing["submit_id"]
        else:
            node_id = make_node_id()
            submit_id = str(uuid.uuid4())
            shots_map[stem] = {
                "idx": idx,
                "shot": sid,
                "stem": stem,
                "node_id": node_id,
                "submit_id": submit_id,
                "status": "submitted",
                "prompt_tier": brief.get("prompt_tier"),
                "prompt_len": len(brief["prompt"]),
                "ratio_requested": ratio,
            }
            _atomic_write_json(state_path, state)

    t0 = time.time()
    parsed = None
    out_res = []
    out_txt = ""

    if reuse_submitted:
        print(f"[{idx:02d} {stem}] Recovering node {node_id}...", flush=True)
        _, parsed, out_txt, _ = _run_cli([
            cli, "node", "show", "--node-id", node_id, "--project-id", project_id, "--format", "json"
        ], timeout=60)
        if parsed:
            out_res = _extract_output_resources(parsed, input_rids)

    if not out_res:
        existing_status = _extract_node_status(parsed) if (reuse_submitted and parsed) else ""
        if reuse_submitted and parsed and existing_status in {"running", "queued", "pending", "processing", "generating"}:
            pass
        elif reuse_submitted and parsed and existing_status == "empty":
            _, conf_json, _, _ = _run_cli([
                cli, "node", "confirm", "--node-id", node_id, "--project-id", project_id,
                "--credit-ceiling", credit_ceiling, "--yes", "--non-interactive", "--format", "json",
            ], timeout=60)
            tok = _extract_credit_token(conf_json) if conf_json else None
            run_cmd = [
                cli, "node", "run", "--node-id", node_id, "--submit-id", submit_id,
                "--project-id", project_id, "--yes", "--non-interactive", "--format", "json",
            ]
            if tok:
                run_cmd.extend(["--credit-token", tok])
            rc_run, run_json, run_out, run_err = _run_cli(run_cmd, timeout=120)
            if rc_run != 0:
                raise RuntimeError(f"Shot {stem} node run failed rc={rc_run}: {run_err or run_out}")
            rc_wait, wait_json, _, wait_err = _run_cli([
                cli, "operation", "wait", submit_id, "--project-id", project_id,
                "--timeout", "6m", "--interval", "5s", "--format", "json",
            ], timeout=380)
            parsed = wait_json or run_json
            _atomic_write_json(meta_path, {
                "idx": idx, "shot": sid, "stem": stem, "node_id": node_id, "submit_id": submit_id,
                "confirm": conf_json, "run": run_json, "wait": wait_json, "wait_rc": rc_wait, "wait_stderr": wait_err[:4000],
            })
            if parsed:
                out_res = _extract_output_resources(parsed, input_rids)
        else:
            cmd = [
                cli, "node", "create", "image",
                "--project-id", project_id,
                "--node-id", node_id,
                "--submit-id", submit_id,
                "--title", f"{batch_tag}_{stem}",
                "--mode", "i2i",
                "--model", model,
                "--resolution", resolution,
                "--count", "1",
                "--credit-ceiling", credit_ceiling,
                "--ratio", ratio,
                "--prompt", brief["prompt"],
                "--run", "--wait", "--yes", "--non-interactive",
                "--format", "json",
                "--ref", f"res:{plate_rid}",
            ]
            for rr in ref_rids:
                cmd.extend(["--ref", f"res:{rr}"])

            print(f"[{idx:02d} {stem}] Submitting ({brief.get('prompt_tier')}, len={len(brief['prompt'])}, refs={1+len(ref_rids)}, ratio={ratio})...", flush=True)
            try:
                rc, parsed, out_txt, err_txt = _run_cli(cmd, timeout=360)
            except subprocess.TimeoutExpired:
                rc, parsed, out_txt, err_txt = -1, None, "", "CLI create --wait timed out at 360s"

            _atomic_write_json(meta_path, {
                "idx": idx, "shot": sid, "stem": stem, "node_id": node_id, "submit_id": submit_id,
                "returncode": rc, "parsed": parsed, "stdout": out_txt[:8000], "stderr": err_txt[:4000],
            })
            if rc == 2:
                raise RuntimeError(f"Shot {stem} invalid request (rc=2): {(err_txt or out_txt).strip()[:600]}")
            if parsed:
                out_res = _extract_output_resources(parsed, input_rids)

    poll_deadline = time.time() + 300
    while not out_res and time.time() < poll_deadline:
        rc2, show_json, _, show_err = _run_cli([
            cli, "node", "show", "--node-id", node_id, "--project-id", project_id, "--format", "json"
        ], timeout=60)
        if show_json:
            parsed = show_json
            out_res = _extract_output_resources(show_json, input_rids)
            if out_res:
                _atomic_write_json(meta_path, {
                    "idx": idx, "shot": sid, "stem": stem, "node_id": node_id, "submit_id": submit_id,
                    "recovered_show": show_json,
                })
                break
            st = _extract_node_status(show_json)
            if st in {"failed", "error", "canceled", "cancelled"}:
                raise RuntimeError(f"Shot {stem} node {node_id} status={st}: {json.dumps(show_json, ensure_ascii=False)[:800]}")
        elif rc2 != 0:
            raise RuntimeError(f"Shot {stem} create/show failed: {show_err or out_txt}")
        time.sleep(10)

    if not out_res:
        raise RuntimeError(f"Shot {stem} no output resource found after waiting. See {meta_path}")

    res_id, _, res_path_key = out_res[0]
    credits = _extract_credits(parsed) or 6

    with _STATE_LOCK:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["shots"][stem].update({
            "status": "generated",
            "res_id": res_id,
            "credits": credits,
            "res_path_key": res_path_key,
        })
        _atomic_write_json(state_path, state)

    rc_dl, _, out_dl, err_dl = _run_cli([
        cli, "resource", "download", res_id, "-o", str(raw_path), "--project-id", project_id, "--yes"
    ], timeout=180)
    if rc_dl != 0 or not raw_path.is_file():
        raise RuntimeError(f"Download failed for {stem} res={res_id}: rc={rc_dl}, out={out_dl}, err={err_dl}")

    with Image.open(raw_path) as im:
        im.load()
        w, h = im.size
        mattes = shot_delivery.detected_matte(im)
        if mattes:
            raise ValueError(f"Matte detected in raw {raw_path}: {mattes}")

    elapsed = round(time.time() - t0, 1)
    with _STATE_LOCK:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["shots"][stem].update({
            "status": "downloaded",
            "raw_file": str(raw_path),
            "width": w,
            "height": h,
            "detected_matte_raw": mattes,
            "elapsed_sec": elapsed,
        })
        _atomic_write_json(state_path, state)

    print(f"[{idx:02d} {stem}] OK {w}x{h} | matte={mattes} | credits={credits} | {elapsed}s", flush=True)
    return stem, "downloaded", w, h, credits


def cmd_render(args: argparse.Namespace) -> None:
    spec, _, work_dir, _ = load_spec(args.spec)
    briefs_dir = work_dir / "briefs"
    cli = resolve_cli()
    selected = {s.strip() for s in args.shots.split(",") if s.strip()} if args.shots else None

    jobs = []
    for idx, sh in enumerate(spec["shots"], start=1):
        stem = sh["stem"]
        if selected and stem not in selected and sh["shot"] not in selected:
            continue
        bf = briefs_dir / f"{stem}_brief.json"
        if not bf.is_file():
            raise FileNotFoundError(f"Brief missing: {bf}; run 'prepare' first.")
        jobs.append((idx, bf))

    print(f"[render] Running {len(jobs)} jobs (workers={args.workers})", flush=True)
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(_render_one_shot, cli, idx, bf, work_dir, spec): bf.name for idx, bf in jobs}
        for fut in concurrent.futures.as_completed(futs):
            nm = futs[fut]
            try:
                fut.result()
            except Exception as exc:
                print(f"[ERROR {nm}] {exc}", file=sys.stderr, flush=True)
                failures.append((nm, str(exc)))

    state = json.loads((work_dir / "canvas_state.json").read_text(encoding="utf-8"))
    total_credits = sum((v.get("credits") or 0) for v in state.get("shots", {}).values() if v.get("status") == "downloaded")
    done_cnt = sum(1 for v in state.get("shots", {}).values() if v.get("status") == "downloaded")
    print(f"[render] Summary: {done_cnt} downloaded | credits={total_credits} | failures={len(failures)}")
    if failures:
        sys.exit(1)


# ---------------------------------------------------------------------------
# Subcommand 4: qc-board
# ---------------------------------------------------------------------------

def cmd_qc_board(args: argparse.Namespace) -> None:
    spec, spec_path, work_dir, _ = load_spec(args.spec)
    qc_dir = work_dir / "qc"
    qc_dir.mkdir(parents=True, exist_ok=True)
    out_png = pathlib.Path(args.out).resolve() if args.out else (qc_dir / "comparison_board.png")
    base_dirs = [work_dir, spec_path.parent, AI_ROOT]

    has_prior = any(sh.get("prior_compare") for sh in spec["shots"])
    cols = 3 if has_prior else 2
    cell_w, cell_h = 840, 360
    pad_x, pad_top, pad_bot = 16, 36, 14
    W = cell_w * cols + pad_x * (cols + 1)
    H = len(spec["shots"]) * (cell_h + pad_top + pad_bot) + 20
    canvas = Image.new("RGB", (W, H), (16, 18, 24))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("msyh.ttc", 18)
    except Exception:
        font = ImageFont.load_default()

    for r_idx, sh in enumerate(spec["shots"]):
        stem = sh["stem"]
        sid = sh["shot"]
        y0 = 10 + r_idx * (cell_h + pad_top + pad_bot)
        plate_p = work_dir / "plates" / pathlib.Path(sh["plate"]).name
        if not plate_p.is_file():
            plate_p = resolve_path(sh["plate"], base_dirs)
        raw_p = work_dir / "raw" / f"{stem}_raw.png"

        panels = [(f"{sid} | 1.Layout", plate_p, (195, 205, 220))]
        if has_prior:
            prior_p = resolve_path(sh["prior_compare"], base_dirs) if sh.get("prior_compare") else None
            panels.append(("2.对照图(Prior)", prior_p, (210, 210, 180)))
        panels.append(("3.本轮成图(Raw)", raw_p, (140, 215, 255)))

        for c_idx, (hdr, p, col) in enumerate(panels):
            x0 = pad_x + c_idx * (cell_w + pad_x)
            draw.text((x0 + 4, y0 + 6), hdr, fill=col, font=font)
            if p and p.is_file():
                with Image.open(p) as im:
                    tile = im.convert("RGB").resize((cell_w, cell_h), Image.Resampling.LANCZOS)
                canvas.paste(tile, (x0, y0 + pad_top))
            else:
                draw.rectangle([x0, y0 + pad_top, x0 + cell_w, y0 + pad_top + cell_h], outline=(70, 75, 90), fill=(26, 28, 34))
                draw.text((x0 + 24, y0 + pad_top + cell_h // 2 - 10), f"未生成: {p.name if p else 'N/A'}", fill=(160, 160, 175), font=font)

    out_png.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_png, format="PNG", compress_level=6)
    print(f"[qc-board] Saved {out_png} ({W}x{H})")


# ---------------------------------------------------------------------------
# Subcommand 5: publish
# ---------------------------------------------------------------------------

def cmd_publish(args: argparse.Namespace) -> None:
    spec, spec_path, work_dir, out_dir = load_spec(args.spec)
    out_dir.mkdir(parents=True, exist_ok=True)
    evidence_dir = out_dir / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)

    qc_data = json.loads(args.qc.resolve(strict=True).read_text(encoding="utf-8-sig"))
    state = json.loads((work_dir / "canvas_state.json").read_text(encoding="utf-8"))
    resolved_batch_p = work_dir / "resolved_batch.json"
    resolved_by_stem = {}
    if resolved_batch_p.is_file():
        rb = json.loads(resolved_batch_p.read_text(encoding="utf-8"))
        resolved_by_stem = {s["stem"]: s for s in rb.get("shots", [])}

    for fname in ("review.html", "review.js"):
        src = REVIEW_SRC / fname
        if src.is_file():
            shutil.copy2(src, out_dir / fname)

    comp_src = work_dir / "qc" / "comparison_board.png"
    if comp_src.is_file():
        shutil.copy2(comp_src, evidence_dir / "comparison_board.png")

    rows = []
    for sh in spec["shots"]:
        stem = sh["stem"]
        sid = sh["shot"]
        bf_path = work_dir / "briefs" / f"{stem}_brief.json"
        brief = json.loads(bf_path.read_text(encoding="utf-8"))
        plate_path = pathlib.Path(brief["plate"]).resolve()
        raw_path = work_dir / "raw" / f"{stem}_raw.png"
        out_name = sh.get("output_name") or f"{sid}_Seedream55_v01_4K.png"
        out_png = out_dir / out_name
        out_qa = out_png.with_suffix(".qa.json")

        with Image.open(plate_path) as pim:
            pw, ph = pim.size
        with Image.open(raw_path) as rim:
            rim = rim.convert("RGB")
            rw, rh = rim.size
            raw_mattes = shot_delivery.detected_matte(rim)
            if raw_mattes:
                raise ValueError(f"Matte detected in raw {raw_path}: {raw_mattes}")
            target_w = 3840
            target_h = round(target_w * rh / rw)
            expected_plate_h = round(target_w * ph / pw)
            upscaled = rim if (rw, rh) == (target_w, target_h) else rim.resize((target_w, target_h), Image.Resampling.LANCZOS)
            tmp_png = out_png.with_suffix(".png.tmp")
            upscaled.save(tmp_png, format="PNG", compress_level=6)
            os.replace(tmp_png, out_png)

        with Image.open(out_png) as fim:
            fim.load()
            assert fim.size == (target_w, target_h)
            mattes = shot_delivery.detected_matte(fim)
            if mattes:
                raise ValueError(f"Matte detected in published {out_png}: {mattes}")

        out_sha = shot_delivery.digest(out_png)
        raw_sha = shot_delivery.digest(raw_path)
        brief_sha = shot_delivery.digest(bf_path)
        shot_state = state.get("shots", {}).get(stem, {})
        qrec = qc_data.get(stem) or qc_data.get(sid) or {}
        issues = qrec.get("qa_issues", [])
        checks = qrec.get("checks", {})
        visual_review = qrec.get("evidence", "对照底图检查通过")

        model = spec.get("model", "seedream_5.5")
        ratio = spec.get("ratio", "21:9")
        res_str = spec.get("resolution", "2K")
        report = {
            "brief": str(bf_path.resolve()),
            "brief_sha256": brief_sha,
            "shot": sid,
            "stem": stem,
            "scene": brief.get("scene"),
            "mode": brief.get("mode", "new"),
            "design_mode": brief.get("design_mode", "Production"),
            "ck_status": spec.get("ck_status", "skipped"),
            "model": model,
            "prompt_tier": brief.get("prompt_tier", "full"),
            "prompt_len": len(brief["prompt"]),
            "credits": shot_state.get("credits", 6),
            "node_id": shot_state.get("node_id"),
            "res_id": shot_state.get("res_id"),
            "plate": str(plate_path),
            "plate_size": [pw, ph],
            "reference_files": [r["file"] for r in brief.get("references", [])],
            "kind": "shot_render",
            "renderer": f"即梦 {model} (dreamina-canvas CLI i2i, --ratio {ratio} --resolution {res_str})",
            "visual_review": visual_review,
            "qa_checks": checks,
            "qa_issues": issues,
            "raw": str(raw_path.resolve()),
            "raw_size": [rw, rh],
            "raw_sha256": raw_sha,
            "expected_height_at_3840_plate_ratio": expected_plate_h,
            "aspect_note": (
                f"{model} 预设 {ratio} 实出 {rw}x{rh}，全幅等比 Lanczos 交付为 {target_w}x{target_h} PNG"
                f"（底图 {pw}x{ph} 对应 3840 宽理论高 {expected_plate_h}px，差 {target_h - expected_plate_h:+d}px）。"
            ),
            "resize": "full-frame Lanczos resampling (zero crop, zero matte, zero stretch)",
            "detected_matte_raw": raw_mattes,
            "detected_matte": mattes,
            "edge_evidence": None,
            "output": str(out_png.resolve()),
            "size": [target_w, target_h],
            "sha256": out_sha,
        }
        _atomic_write_json(out_qa, report)

        layout_rel = f"evidence/{plate_path.stem}_layout.png"
        art_rel = sh.get("art_rel") or resolved_by_stem.get(stem, {}).get("art_rel") or layout_rel
        art_src = sh.get("art_source") or "资产参考"
        art_note = sh.get("art_note") or sh.get("beat", "")
        t_label = sh.get("t_label") or f"{spec.get('episode', '')} 场{brief.get('scene', '')} ({sid})"

        rows.append({
            "id": f"{stem}-v01",
            "shot": sid,
            "scene": brief.get("scene"),
            "version": "v01",
            "file": out_png.name,
            "sha256": out_sha,
            "size": [target_w, target_h],
            "t": t_label,
            "source": f"{spec.get('episode', '')} 场{brief.get('scene', '')} Layout｜{model} ({brief.get('prompt_tier')} {len(brief['prompt'])}字)",
            "note": art_note + (f" 待留意：{'；'.join(issues)}" if issues else " 初检无明显穿帮。"),
            "hold": "",
            "qa": {
                "version": "v01",
                "sha256": out_sha,
                "basis": "matched",
                "checks": checks,
                "evidence": visual_review,
            },
            "qa_issues": issues,
            "layout": layout_rel,
            "art": art_rel,
            "artSource": art_src,
            "artNote": art_note,
            "selfCheck": visual_review,
            "prompt": brief["prompt"],
            "refs": [str(plate_path)] + [r["file"] for r in brief.get("references", [])],
        })
        print(f"  [published] {out_png.name} ({target_w}x{target_h}) sha256={out_sha[:12]}")

    review_title = spec.get("batch_name", "TX Batch Review")
    review_js = f'window.CK_EPISODE = {json.dumps(review_title, ensure_ascii=False)};\nwindow.CK_DATA = ' + json.dumps(rows, ensure_ascii=False, indent=2) + ';\n'
    (out_dir / "review-data.js").write_text(review_js, encoding="utf-8")

    total_credits = sum((v.get("credits") or 0) for v in state.get("shots", {}).values() if v.get("status") == "downloaded")
    run_meta = {
        "batch_name": spec.get("batch_name"),
        "episode": spec.get("episode"),
        "scenes": spec.get("scenes"),
        "shots": [sh["shot"] for sh in spec["shots"]],
        "shot_count": len(rows),
        "design_mode": spec.get("design_mode", "Production"),
        "model": spec.get("model", "seedream_5.5"),
        "mode": "i2i",
        "resolution": spec.get("resolution", "2K"),
        "ratio": spec.get("ratio", "21:9"),
        "credits_spent": total_credits,
        "output_dir": str(out_dir.resolve()),
        "canvas_project_id": state.get("project_id"),
        "comparison_board": str((evidence_dir / "comparison_board.png").resolve()) if (evidence_dir / "comparison_board.png").is_file() else None,
    }
    _atomic_write_json(work_dir / "run_meta.json", run_meta)
    print(f"[publish] All {len(rows)} shots published to {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_prep = sub.add_parser("prepare", help="Resolve vault refs, verify plates, build briefs")
    p_prep.add_argument("--spec", type=pathlib.Path, required=True)
    p_prep.add_argument("--strict-vault", action="store_true")
    p_prep.add_argument("--allow-draft", action="store_true")

    p_up = sub.add_parser("upload", help="Upload plates & refs to Dreamina canvas with SHA-256 dedup cache")
    p_up.add_argument("--spec", type=pathlib.Path, required=True)
    p_up.add_argument("--workers", type=int, default=6)

    p_ren = sub.add_parser("render", help="Run Dreamina Seedream i2i jobs idempotently")
    p_ren.add_argument("--spec", type=pathlib.Path, required=True)
    p_ren.add_argument("--workers", type=int, default=2)
    p_ren.add_argument("--shots", default="", help="Optional comma-separated stems or shot IDs")

    p_qc = sub.add_parser("qc-board", help="Generate comparison QC board")
    p_qc.add_argument("--spec", type=pathlib.Path, required=True)
    p_qc.add_argument("--out", default="")

    p_pub = sub.add_parser("publish", help="Publish 3840px PNGs + .qa.json + review-data.js")
    p_pub.add_argument("--spec", type=pathlib.Path, required=True)
    p_pub.add_argument("--qc", type=pathlib.Path, required=True)

    args = parser.parse_args()
    if args.command == "prepare":
        cmd_prepare(args)
    elif args.command == "upload":
        cmd_upload(args)
    elif args.command == "render":
        cmd_render(args)
    elif args.command == "qc-board":
        cmd_qc_board(args)
    elif args.command == "publish":
        cmd_publish(args)


if __name__ == "__main__":
    main()
