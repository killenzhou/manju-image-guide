"""达芬奇当前时间线与分镜标记巡检工具
用于分析时间线结构、剪辑点、分集标记分布，并支持静态帧抓取。
"""

import sys
import json
import argparse
from pathlib import Path
from resolve_env import get_resolve_context

def inspect_timeline(target_timeline_name=None, export_frame_tc=None, export_img_path=None):
    ctx = get_resolve_context()
    proj = ctx["project"]
    current_tl = ctx["timeline"]
    
    if target_timeline_name:
        found = None
        for i in range(1, proj.GetTimelineCount() + 1):
            tl = proj.GetTimelineByIndex(i)
            if tl and tl.GetName() == target_timeline_name:
                found = tl
                break
        if not found:
            raise ValueError(f"未找到时间线: {target_timeline_name}")
        proj.SetCurrentTimeline(found)
        current_tl = found

    if not current_tl:
        raise RuntimeError("未激活任何时间线。")

    tl_name = current_tl.GetName()
    start_frame = current_tl.GetStartFrame()
    v_tracks = current_tl.GetTrackCount("video")
    a_tracks = current_tl.GetTrackCount("audio")
    current_tc = current_tl.GetCurrentTimecode()

    # 汇总轨道片段
    tracks_info = []
    for t in range(1, v_tracks + 1):
        tname = current_tl.GetTrackName("video", t)
        items = current_tl.GetItemListInTrack("video", t) or []
        clips = []
        for it in items:
            clips.append({
                "name": it.GetName(),
                "start": it.GetStart(),
                "end": it.GetEnd(),
                "duration": it.GetDuration(),
                "media_path": it.GetMediaPoolItem().GetClipProperty("File Path") if it.GetMediaPoolItem() else ""
            })
        tracks_info.append({
            "index": t,
            "name": tname,
            "clip_count": len(items),
            "clips": clips
        })

    # 汇总 Markers
    markers = current_tl.GetMarkers() or {}
    marker_list = []
    for f, m in markers.items():
        frame_idx = int(float(f))
        marker_list.append({
            "frame": frame_idx,
            "abs_frame": start_frame + frame_idx,
            "color": m.get("color"),
            "name": m.get("name"),
            "note": m.get("note"),
            "duration": m.get("duration"),
            "customData": m.get("customData")
        })
    marker_list.sort(key=lambda x: x["frame"])

    # 分集统计（以 EP00X 开头）
    by_ep = {}
    for m in marker_list:
        name = m["name"] or ""
        if name.startswith("EP"):
            ep_tag = name.split("_")[0] if "_" in name else name[:5]
            by_ep.setdefault(ep_tag, []).append(m)

    result = {
        "project": proj.GetName(),
        "timeline": tl_name,
        "start_frame": start_frame,
        "current_timecode": current_tc,
        "video_track_count": v_tracks,
        "audio_track_count": a_tracks,
        "tracks": tracks_info,
        "total_markers": len(marker_list),
        "episodes_summary": {k: len(v) for k, v in by_ep.items()},
        "markers": marker_list
    }

    # 导出单帧截图
    if export_frame_tc and export_img_path:
        current_tl.SetCurrentTimecode(export_frame_tc)
        out_p = Path(export_img_path).resolve()
        out_p.parent.mkdir(parents=True, exist_ok=True)
        ok = current_tl.ExportCurrentFrameAsStill(str(out_p))
        result["exported_frame"] = {
            "timecode": export_frame_tc,
            "path": str(out_p),
            "success": ok
        }

    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="达芬奇时间线与标记检查工具")
    parser.add_argument("--timeline", help="指定时间线名称（默认当前）")
    parser.add_argument("--export-tc", help="要导出的时间码，例如 01:22:10:21")
    parser.add_argument("--export-img", help="导出静帧的图片保存路径")
    parser.add_argument("--output-json", help="输出完整元数据 JSON 路径")
    args = parser.parse_args()

    res = inspect_timeline(
        target_timeline_name=args.timeline,
        export_frame_tc=args.export_tc,
        export_img_path=args.export_img
    )

    print(f"=== 时间线巡检报告 ===")
    print(f"工程: {res['project']} | 时间线: {res['timeline']}")
    print(f"视频轨数: {res['video_track_count']} | 总标记数: {res['total_markers']}")
    print(f"分集标记分布: {res['episodes_summary']}")
    for t in res["tracks"]:
        print(f"  轨道 {t['index']} [{t['name']}]: {t['clip_count']} 个片段")
        for c in t["clips"][:3]:
            print(f"    - {c['name']} ({c['start']} -> {c['end']}, 时长: {c['duration']})")
        if t["clip_count"] > 3:
            print(f"    ... 共 {t['clip_count']} 个片段")

    if args.output_json:
        Path(args.output_json).write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"详细报告已输出至: {args.output_json}")
