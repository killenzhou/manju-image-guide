"""达芬奇时间线场景标记应用与同步核心脚本
支持写入时间线范围标记 (Timeline Range Markers)、片段标记 (Clip Markers)，
具备幂等更新、安全验证、自定义标识隔离与无损回滚机制。
"""

import sys
import json
import argparse
from pathlib import Path
from resolve_env import get_resolve_context

def apply_markers_to_timeline(manifest_items, mode="apply", marker_color="Cyan", custom_prefix="TX_SCENE_GUIDE_V1", include_clip_markers=False):
    ctx = get_resolve_context()
    proj = ctx["project"]
    t = ctx["timeline"]
    
    if not t:
        raise RuntimeError("未激活任何时间线。")

    start_frame = t.GetStartFrame()
    pool = proj.GetMediaPool()
    
    md = {m["id"]: m for m in manifest_items}
    existing_markers = t.GetMarkers() or {}
    
    # 获取底层视频轨 1 的 Clips，用于添加 Clip Markers
    v1_items = t.GetItemListInTrack("video", 1) or []

    plan = []
    applied_count = 0
    removed_count = 0

    print(f"当前时间线: {t.GetName()} (起始帧: {start_frame})")
    print(f"执行模式: {mode} | 目标场次数: {len(manifest_items)}")

    # 1. 处理时间线标记 (Timeline Markers)
    for m in manifest_items:
        m_id = m["id"]
        cdata = f"{custom_prefix}:{m_id}"
        
        # 换算相对于时间线起始帧的帧位置
        # 注意: 如果 m["start"] 已经是绝对帧，则相对帧 = m["start"] - start_frame
        pos = m["start"] - start_frame if m["start"] >= start_frame else m["start"]
        dur = m.get("duration", 1)
        name = m.get("marker_name") or f"{m_id}｜{m.get('slugline', '')}"
        
        note_lines = [
            f"【剧情概要】{m.get('story', '')}",
            f"【设计参考】{m.get('asset', '无')}",
            f"【时段依据】{m.get('basis', m.get('lighting_basis', '剧本/人工设定'))}"
        ]
        note = "\n".join(note_lines)

        plan.append({
            "action": "timeline_marker",
            "frame": pos,
            "duration": dur,
            "name": name,
            "color": marker_color,
            "customData": cdata
        })

        if mode == "apply":
            # 检查是否已存在同 customData 的标记
            old_frame = next((int(k) for k, v in (t.GetMarkers() or {}).items() if v.get("customData") == cdata), None)
            if old_frame is not None:
                t.DeleteMarkerAtFrame(old_frame)
            
            # 写入新标记
            ok = t.AddMarker(pos, marker_color, name, note, dur, cdata)
            if not ok:
                # 冲突避让微调
                pos += 1
                dur -= 1
                ok = t.AddMarker(pos, marker_color, name, note, dur, cdata)
            if ok:
                applied_count += 1
        elif mode == "rollback":
            old_frame = next((int(k) for k, v in (t.GetMarkers() or {}).items() if v.get("customData") == cdata), None)
            if old_frame is not None:
                t.DeleteMarkerAtFrame(old_frame)
                removed_count += 1

    # 2. 同步片段标记 (Clip Markers) 到底层轨道片段 (已根据用户规范默认关闭)
    if include_clip_markers and v1_items and mode in ["apply", "rollback"]:
        for m in manifest_items:
            m_id = m["id"]
            cdata_clip = f"{custom_prefix}:{m_id}"
            m_start = m["start"]
            m_end = m["end"]
            
            for clip in v1_items:
                c_start = clip.GetStart()
                c_end = clip.GetEnd()
                # 找交集区间
                overlap_a = max(m_start, c_start)
                overlap_b = min(m_end, c_end)
                if overlap_a >= overlap_b:
                    continue
                
                # 计算在 clip 内的相对帧
                clip_pos = int(clip.GetLeftOffset() + overlap_a - c_start)
                clip_dur = int(overlap_b - overlap_a)
                clip_cdata = f"{cdata_clip}:{int(c_start)}"
                
                clip_markers = clip.GetMarkers() or {}
                found = next((int(k) for k, v in clip_markers.items() if v.get("customData") == clip_cdata), None)
                
                if mode == "apply":
                    if found is not None:
                        clip.DeleteMarkerAtFrame(found)
                    name = m.get("marker_name") or f"{m_id}｜{m.get('slugline', '')}"
                    clip.AddMarker(clip_pos, marker_color, name, note, clip_dur, clip_cdata)
                elif mode == "rollback":
                    if found is not None:
                        clip.DeleteMarkerAtFrame(found)

    if mode == "apply":
        ctx["pm"].SaveProject()
        print(f"标记应用完成！已成功写入 {applied_count} 个时间线范围标记（片段标记已遵照规范跳过）。工程已保存。")
    elif mode == "rollback":
        ctx["pm"].SaveProject()
        print(f"回滚完成！已清理 {removed_count} 个带有 {custom_prefix} 标识的标记。原有手工标记完好。")
    else:
        print(f"[Dry Run] 计划更新 {len(plan)} 个标记，未对工程进行实质写入。")

    return {
        "mode": mode,
        "timeline": t.GetName(),
        "applied": applied_count,
        "removed": removed_count,
        "plan_count": len(plan)
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="达芬奇场景标记批量写入工具")
    parser.add_argument("--manifest", required=True, help="场景清单 manifest.json 路径")
    parser.add_argument("--mode", choices=["dry-run", "apply", "rollback"], default="dry-run", help="运行模式")
    parser.add_argument("--color", default="Cyan", help="Marker 颜色 (默认 Cyan)")
    args = parser.parse_args()

    m_path = Path(args.manifest)
    if not m_path.exists():
        print(f"错误: manifest 文件不存在: {args.manifest}")
        sys.exit(1)

    items = json.loads(m_path.read_text(encoding="utf-8"))
    apply_markers_to_timeline(items, mode=args.mode, marker_color=args.color)
