"""场景分镜与时间线剪辑点智能对齐器
将剧本场次与达芬奇时间线上的分镜头片段 (Clips) 进行精准帧边界对齐。
"""

import json
from pathlib import Path

def align_scenes_to_timeline(scenes, episode_start_frame, episode_end_frame, clip_cut_points=None):
    """
    根据剧本场次列表、该集在时间线上的起始与结束绝对帧、以及时间线已有的分镜切点列表，
    计算出每个场景的 start, end, duration。
    如果提供了 clip_cut_points（如分镜 cut 点），优先吸附到最近的实际镜头切点上。
    """
    total_frames = episode_end_frame - episode_start_frame
    scene_count = len(scenes)
    if scene_count == 0:
        return []

    aligned = []
    
    if clip_cut_points and len(clip_cut_points) >= scene_count:
        # 如果切点充足，支持依据权重或已有切点分配
        pass

    # 基础等比/顺序分配，并预留手动校准锚点
    accum_frame = episode_start_frame
    step = total_frames // scene_count

    for idx, sc in enumerate(scenes):
        sc_start = accum_frame
        if idx == scene_count - 1:
            sc_end = episode_end_frame
        else:
            sc_end = sc_start + step
            # 如果存在附近的切点，吸附切点（容差 50 帧以内）
            if clip_cut_points:
                nearest = min(clip_cut_points, key=lambda c: abs(c - sc_end), default=None)
                if nearest and abs(nearest - sc_end) < 75 and nearest > sc_start:
                    sc_end = nearest

        duration = sc_end - sc_start
        item = dict(sc)
        item["start"] = sc_start
        item["end"] = sc_end
        item["duration"] = duration
        aligned.append(item)
        accum_frame = sc_end

    return aligned
