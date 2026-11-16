#!/usr/bin/env python3
"""
年轮 AI (nl.nianlunai.com) 参考生图全自动工具 (nl_img_tool.py)
- 自动读取/刷新 nl-workbench token
- 自动按 Layout 底图宽高比匹配模型支持的最近 ratio
- 自动将提示词中的 @图片1..@图片N 转换为画布 Tiptap mention 节点
- 自动创建完整画布节点 (image + text + tool-image-generation + series)
- 提交 /aipc/generateImg，轮询结果并下载成图
"""
import argparse
import json
import random
import re
import string
import subprocess
import time
from pathlib import Path

import requests
from PIL import Image

WORKBENCH_DIR = Path(__file__).resolve().parent
BASE = "https://nl.nianlunai.com/business-center"
DEFAULT_PROJECT_ID = "1784616738985a2731223562"  # 踏星


def gen_id():
    return "u" + "".join(random.choices(string.ascii_letters + string.digits, k=31))


def get_token():
    tf = WORKBENCH_DIR / ".nl-token"
    if not tf.exists():
        subprocess.run(["node", str(WORKBENCH_DIR / "nl.mjs"), "user"], check=True)
    return tf.read_text(encoding="utf-8").strip()


def make_headers(token):
    return {
        "annual-ring-token": token,
        "Origin": "https://nl.nianlunai.com",
        "Referer": "https://nl.nianlunai.com/nlCanvas",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }


def pick_best_ratio(img_path: Path, model_id: str = "GI2.5sunburst", scene: str = "img_to_img", resolution: str = "4K", quality: str = "high") -> str:
    with Image.open(img_path) as im:
        w, h = im.size
    target_ar = w / h

    cache_file = WORKBENCH_DIR / "models_cache.json"
    ratios = ["1:1", "16:9", "21:9", "3:2", "2:3", "3:4", "4:3", "9:16"]
    if cache_file.exists():
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        for m in data.get("data", {}).get("models", []):
            if m.get("modelId") == model_id:
                for p in m.get("params", []):
                    if p.get("modelScene") == scene and p.get("resolution") == resolution and p.get("quality") == quality:
                        if p.get("ratioArray"):
                            ratios = p["ratioArray"]
                        break
                break

    best_r = ratios[0]
    best_diff = 1e9
    for r in ratios:
        if ":" not in r:
            continue
        rw, rh = map(float, r.split(":"))
        diff = abs((rw / rh) - target_ar)
        if diff < best_diff:
            best_diff = diff
            best_r = r
    print(f"[*] Layout {img_path.name} ({w}x{h}, AR={target_ar:.3f}) -> matched ratio: {best_r}")
    return best_r


def prepare_upload_file(filepath: Path, tmp_dir: Path) -> tuple[Path, int, int]:
    with Image.open(filepath) as im:
        w, h = im.size
    if filepath.stat().st_size <= 3 * 1024 * 1024:
        return filepath, w, h
    im = Image.open(filepath).convert("RGB")
    if max(im.size) > 2048:
        im.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    w, h = im.size
    out = tmp_dir / f"_upload_{filepath.stem}.jpg"
    im.save(out, format="JPEG", quality=93)
    print(f"[*] Compressed {filepath.name} -> {out.name} ({w}x{h}, {out.stat().st_size/1024:.0f}KB)")
    return out, w, h


def upload_image(headers: dict, filepath: Path, tmp_dir: Path) -> dict:
    up_path, w, h = prepare_upload_file(filepath, tmp_dir)
    mime = "image/png" if up_path.suffix.lower() == ".png" else "image/jpeg"
    with open(up_path, "rb") as f:
        r = requests.post(
            f"{BASE}/ai/project/manage/saveUploadAsset",
            headers=headers,
            params={"assetDataType": "2", "assetName": up_path.name, "assetType": 1},
            files={"file": (up_path.name, f, mime)},
            timeout=60,
        )
    r.raise_for_status()
    j = r.json()
    if j.get("code") != 200:
        raise RuntimeError(f"Upload failed for {filepath.name}: {j}")
    d = j["data"]
    url = d if isinstance(d, str) else (d.get("url") or d.get("asset") or d.get("coverUrl"))
    aid = None if isinstance(d, str) else (d.get("id") or d.get("assetId"))
    print(f"[+] Uploaded {filepath.name} -> {url} (assetId={aid}, {w}x{h})")
    return {"imgUrl": url, "assetId": aid, "width": w, "height": h}


def build_richtext_with_mentions(prompt: str, img_nodes: list[dict]) -> tuple[dict, str]:
    """将 @图片1/@参考图1.. 转为年轮画布节点文本与标准提交 prompt"""
    pattern = re.compile(r"@(?:图片|参考图)(\d+)")
    content = []
    out_prompt_parts = []
    pos = 0
    for m in pattern.finditer(prompt):
        if m.start() > pos:
            seg = prompt[pos:m.start()]
            content.append({"type": "text", "text": seg})
            out_prompt_parts.append(seg)
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(img_nodes):
            label = img_nodes[idx]["data"]["nodeName"]
            content.append({"type": "text", "text": f"@{label}"})
            out_prompt_parts.append(f"@{label}")
        else:
            content.append({"type": "text", "text": m.group(0)})
            out_prompt_parts.append(m.group(0))
        pos = m.end()
    if pos < len(prompt):
        tail = prompt[pos:]
        content.append({"type": "text", "text": tail})
        out_prompt_parts.append(tail)
    return {"type": "doc", "content": [{"type": "paragraph", "content": content}]}, "".join(out_prompt_parts)


def poll_and_download(headers: dict, task_id: str, out_path: Path, model_id: str = "Tuoliu-gpt-image-2.5-sunburst", canvas_id: str | None = None, series_id: str | None = None) -> tuple[str, int | None]:
    print(f"[*] Polling generationQueue & queryImgTask for task {task_id} (key=img_{model_id})...")
    key = f"img_{model_id}"
    url = None
    asset_id = None
    for i in range(120):
        qr = requests.get(
            f"{BASE}/aipc/query/queryImgTask",
            headers=headers,
            params={"taskId": task_id, "key": key},
            timeout=60,
        ).json()
        d = qr.get("data") or {}
        st = str(d.get("status") or "").lower()
        if st in ("success", "succeeded", "completed") and d.get("tasks"):
            url = d["tasks"][0].get("url") or d["tasks"][0].get("imgUrl") or d["tasks"][0].get("resultUrl")
            asset_id = d["tasks"][0].get("assetId")
            if url:
                break
        q = requests.get(f"{BASE}/aipc/generationQueue", headers=headers, timeout=20).json().get("data") or {}
        active = [x for x in (q.get("runningTasks") or []) + (q.get("waitingTasks") or []) if x.get("taskId") == task_id]
        if active:
            print(f"[{i}] in queue: status={active[0].get('status')} (waiting={len(q.get('waitingTasks') or [])})")
            time.sleep(5)
            continue
        # Left queue: one final check with queryImgTask & assets
        time.sleep(2)
        qr = requests.get(f"{BASE}/aipc/query/queryImgTask", headers=headers, params={"taskId": task_id, "key": key}, timeout=60).json()
        d = qr.get("data") or {}
        if str(d.get("status") or "").lower() in ("success", "succeeded", "completed") and d.get("tasks"):
            url = d["tasks"][0].get("url") or d["tasks"][0].get("imgUrl") or d["tasks"][0].get("resultUrl")
            asset_id = d["tasks"][0].get("assetId")
            break
        ar = requests.get(f"{BASE}/ai/asset/getListByTaskId", headers=headers, params={"id": task_id}, timeout=20).json()
        if ar.get("data"):
            url = ar["data"][0].get("url") or ar["data"][0].get("imgUrl")
            asset_id = ar["data"][0].get("id") or ar["data"][0].get("assetId")
            break
        raise RuntimeError(f"Task {task_id} finished but no URL found: qr={qr}, ar={ar}")

    if not url:
        raise TimeoutError(f"Timed out waiting for task {task_id}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(requests.get(url, timeout=120).content)
    with Image.open(out_path) as im:
        print(f"[+] Downloaded -> {out_path} ({im.size[0]}x{im.size[1]}, {out_path.stat().st_size} bytes)")
    return url, asset_id


def run_generation(
    images: list[Path],
    prompt: str,
    out_path: Path,
    model_id: str = "Tuoliu-gpt-image-2.5-sunburst",
    resolution: str = "4K",
    quality: str = "high",
    ratio: str | None = None,
    canvas_id: str | None = None,
    canvas_name: str = "TX_Auto_出图",
    project_id: str = DEFAULT_PROJECT_ID,
):
    token = get_token()
    headers = make_headers(token)
    tmp_dir = out_path.parent
    tmp_dir.mkdir(parents=True, exist_ok=True)

    if not ratio:
        ratio = pick_best_ratio(images[0], model_id=model_id, scene="img_to_img", resolution=resolution, quality=quality) if images else "21:9"

    uploaded = [upload_image(headers, p, tmp_dir) for p in images]

    if not canvas_id:
        cfg_path = WORKBENCH_DIR / "tx_canvas.json"
        if cfg_path.exists():
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            canvas_id = cfg.get("canvasId")
            canvas_name = cfg.get("canvasName") or canvas_name
            print(f"[*] Using shared TX master canvas: {canvas_id} ({canvas_name})")
        else:
            ts_name = f"{canvas_name}_{int(time.time()) % 100000}"
            cr = requests.post(
                f"{BASE}/ai/project/manage/saveOrUpdate",
                headers={**headers, "Content-Type": "application/json"},
                json={"projectId": project_id, "canvasName": ts_name, "sourceMaterials": {"nodes": [], "edges": []}},
                timeout=20,
            ).json()
            if cr.get("code") != 200:
                raise RuntimeError(f"Create canvas failed: {cr}")
            canvas_id = cr["data"]["id"]
            canvas_name = ts_name
            print(f"[+] Created canvas: {canvas_id} (https://nl.nianlunai.com/nlCanvas?id={canvas_id})")

    # Fetch existing nodes/edges so we append below existing groups instead of overwriting
    existing_nodes, existing_edges = [], []
    detail = requests.get(f"{BASE}/ai/project/manage/canvasDetail", headers=headers, params={"id": canvas_id}, timeout=20).json().get("data") or {}
    sm = detail.get("sourceMaterials")
    if isinstance(sm, str):
        sm = json.loads(sm)
    if isinstance(sm, dict):
        existing_nodes = sm.get("nodes") or []
        existing_edges = sm.get("edges") or []
        canvas_name = detail.get("canvasName") or canvas_name
    max_y = max([n.get("position", {}).get("y", 0) + (n.get("height") or 700) for n in existing_nodes if n.get("type") == "group"], default=-180)
    base_y = max_y + 180 if existing_nodes else 0

    group_id = gen_id()
    text_id = gen_id()
    tool_id = gen_id()
    series_id = gen_id()

    img_nodes = []
    edges = []
    for idx, u in enumerate(uploaded):
        nid = gen_id()
        img_nodes.append({
            "id": nid,
            "type": "image",
            "width": 260,
            "height": 150,
            "position": {"x": 40, "y": 50 + idx * 170},
            "parentNode": group_id,
            "data": {
                "url": u["imgUrl"],
                "assetId": u["assetId"],
                "nodeName": f"参考图{idx+1}",
                "mediaWidth": u["width"],
                "mediaHeight": u["height"],
                "naturalWidth": u["width"],
                "naturalHeight": u["height"],
            },
        })
        edges.append({"id": gen_id(), "type": "custom", "source": nid, "target": tool_id, "data": {"sourceType": "image", "targetType": "tool"}})

    rt_json, resolved_prompt = build_richtext_with_mentions(prompt, img_nodes)
    nodes = [
        {"id": group_id, "type": "group", "width": 1550, "height": max(760, 80 + len(img_nodes) * 170), "position": {"x": 0, "y": base_y}, "data": {"label": f"{canvas_name} ({model_id} {ratio} {resolution})", "autoFocus": False}},
        *img_nodes,
        {
            "id": text_id,
            "type": "text",
            "width": 420,
            "height": 340,
            "position": {"x": 380, "y": 80},
            "draggable": True,
            "parentNode": group_id,
            "data": {
                "nodeName": "文本输入",
                "richTextVersion": 1,
                "currentVersionIndex": 1,
                "versions": [{"richTextJson": rt_json}],
                "richTextJson": rt_json,
            },
        },
        {
            "id": tool_id,
            "type": "tool-image-generation",
            "position": {"x": 860, "y": 180},
            "parentNode": group_id,
            "data": {
                "nodeName": "nlCanvas.contextMenu.toolReferenceToImage",
                "toolType": "image",
                "generationType": "tool-multiple-image-to-image",
                "toolParams": {
                    "aiId": model_id,
                    "ratio": ratio,
                    "number": 1,
                    "clarity": resolution,
                    "quality": quality,
                    "cropImage": False,
                    "useGlobalRatio": False,
                    "isTransparentBackground": False,
                    "generatedNumber": 0,
                },
            },
        },
        {
            "id": series_id,
            "type": "series",
            "position": {"x": 1220, "y": 180},
            "parentNode": group_id,
            "data": {
                "origin": "generated",
                "itemType": "image",
                "nodeName": "生成结果",
                "items": [],
                "taskRuns": [],
            },
        },
    ]
    edges.append({"id": gen_id(), "type": "custom", "source": text_id, "target": tool_id, "data": {"sourceType": "text", "targetType": "tool"}})
    edges.append({"id": gen_id(), "type": "custom", "source": tool_id, "target": series_id, "data": {"sourceType": "tool-multiple-image-to-image", "targetType": "series"}})

    lock_res = requests.post(f"{BASE}/ai/project/manage/canvas/lock/acquire", headers={**headers, "Content-Type": "application/json"}, json={"canvasId": canvas_id}, timeout=15).json()
    print("[*] Lock:", lock_res.get("code"), lock_res.get("data"))

    try:
        sr = requests.post(
            f"{BASE}/ai/project/manage/saveOrUpdate",
            headers={**headers, "Content-Type": "application/json"},
            json={"id": canvas_id, "canvasName": canvas_name, "sourceMaterials": {"nodes": existing_nodes + nodes, "edges": existing_edges + edges}},
            timeout=20,
        ).json()
        if sr.get("code") != 200:
            raise RuntimeError(f"Save canvas failed: {sr}")

        img_assets_payload = [{"imgUrl": u["imgUrl"], "assetId": u["assetId"]} for u in uploaded]
        show_assets = [{"assetsType": 2, "url": u["imgUrl"]} for u in uploaded]
        scene_mode = "img_to_img" if uploaded else "text_to_img"
        gen_scene = "nlCanvas.contextMenu.toolReferenceToImage" if uploaded else "nlCanvas.contextMenu.toolTextToImage"
        gen_payload = {
            "canvasId": canvas_id,
            "modelId": model_id,
            "aiId": model_id,
            "scene": scene_mode,
            "resolution": resolution,
            "ratio": ratio,
            "isTransparentBackground": False,
            "cropImage": False,
            "prompt": resolved_prompt,
            "showPrompt": resolved_prompt,
            "imgAssets": img_assets_payload,
            "showAssets": show_assets,
            "taskNode": series_id,
            "generateScene": gen_scene,
        }
        if quality and quality.lower() != "none":
            gen_payload["quality"] = quality
        # Only include number if model's generationCounts is non-empty
        cache_file = WORKBENCH_DIR / "models_cache.json"
        if cache_file.exists():
            for m in json.loads(cache_file.read_text(encoding="utf-8")).get("data", {}).get("models", []):
                if m.get("modelId") == model_id and m.get("generationCounts"):
                    gen_payload["number"] = 1
                    break
        gr = requests.post(f"{BASE}/aipc/generateImg", headers={**headers, "Content-Type": "application/json"}, json=gen_payload, timeout=30).json()
        print("[*] Submit:", json.dumps(gr, ensure_ascii=False))
        if gr.get("code") != 200:
            raise RuntimeError(f"Submit failed: {gr}")
        task_id = gr["data"]
    finally:
        try:
            requests.post(f"{BASE}/ai/project/manage/canvas/lock/release", headers={**headers, "Content-Type": "application/json"}, json={"canvasId": canvas_id}, timeout=10)
        except Exception:
            pass

    url, asset_id = poll_and_download(headers, task_id, out_path, model_id=model_id, canvas_id=canvas_id, series_id=series_id)
    # Write completed image back into canvas series node so web UI shows the result
    try:
        lr = requests.post(f"{BASE}/ai/project/manage/canvas/lock/acquire", headers={**headers, "Content-Type": "application/json"}, json={"canvasId": canvas_id}, timeout=15).json()
        cd = requests.get(f"{BASE}/ai/project/manage/canvasDetail", headers=headers, params={"id": canvas_id}, timeout=20).json().get("data") or {}
        sm = cd.get("sourceMaterials")
        if isinstance(sm, str):
            sm = json.loads(sm)
        if isinstance(sm, dict):
            for n in sm.get("nodes", []):
                if n.get("id") == series_id:
                    item_id = gen_id()
                    n["data"] = {
                        "items": [{"id": item_id, "url": url, "type": "image", "runId": series_id, "status": "completed", "assetId": asset_id, "nodeName": "生成结果-1", "nameSource": "generated", "data": {"url": url, "status": "completed", "toolId": tool_id, "assetId": asset_id, "toolType": "tool-multiple-image-to-image"}}],
                        "origin": "generated", "itemType": "image", "nodeName": "生成结果",
                        "taskRuns": [{"id": series_id, "kind": "tool", "status": "completed", "taskId": task_id, "itemIds": [item_id], "resultType": "image", "producerNodeId": tool_id}],
                        "coverItemId": item_id, "producerNodeId": tool_id,
                    }
            requests.post(f"{BASE}/ai/project/manage/saveOrUpdate", headers={**headers, "Content-Type": "application/json"}, json={"id": canvas_id, "canvasName": canvas_name, "sourceMaterials": sm}, timeout=20)
        if lr.get("data", {}).get("locked"):
            requests.post(f"{BASE}/ai/project/manage/canvas/lock/release", headers={**headers, "Content-Type": "application/json"}, json={"canvasId": canvas_id}, timeout=10)
    except Exception:
        pass
    return {"canvas_id": canvas_id, "task_id": task_id, "url": url, "out": str(out_path)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brief", help="Path to shot brief JSON")
    ap.add_argument("--out", required=True, help="Output raw image path")
    ap.add_argument("--poll-only", default=None, help="Only poll & download an existing taskId")
    ap.add_argument("--model", default="Tuoliu-gpt-image-2.5-sunburst")
    ap.add_argument("--resolution", default="4K")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--ratio", default=None, help="Override ratio; defaults to auto-match plate")
    ap.add_argument("--canvas-id", default=None)
    ap.add_argument("--canvas-name", default=None)
    ap.add_argument("--t2i", action="store_true", help="Text-to-image only (ignore plate/references)")
    args = ap.parse_args()

    if args.poll_only:
        url = poll_and_download(make_headers(get_token()), args.poll_only, Path(args.out))
        print(json.dumps({"task_id": args.poll_only, "url": url, "out": args.out}, ensure_ascii=False))
        return
    if not args.brief:
        ap.error("--brief is required unless --poll-only is used")

    brief = json.loads(Path(args.brief).read_text(encoding="utf-8"))
    images = [] if args.t2i else ([Path(brief["plate"])] + [Path(r["file"]) for r in brief.get("references", [])])
    cname = args.canvas_name or f"TX_{brief.get('shot', 'shot')}_出图"
    res = run_generation(
        images=images,
        prompt=brief["prompt"],
        out_path=Path(args.out),
        model_id=args.model,
        resolution=args.resolution,
        quality=args.quality,
        ratio=args.ratio,
        canvas_id=args.canvas_id,
        canvas_name=cname,
    )
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
