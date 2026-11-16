"""剧本场次与剧情提取解析器
用于从分集剧本（如《踏星》第X集【剧本定稿】.txt）解析出场次号、场景名、内外景、昼夜、剧情摘要。
"""

import re
import json
import argparse
from pathlib import Path

def parse_script_scenes(script_text, episode_num=None):
    """解析剧本文字，返回结构化场次列表。"""
    lines = script_text.splitlines()
    scenes = []
    current_scene = None
    
    # 典型场次标题正则模式：
    # 模式1: △1  大佛悬崖  夜  外 或 △1-1  大佛悬崖  夜  外
    # 模式2: 1  星陨点·大佛悬崖  夜  外
    # 模式3: 【场景1】大佛悬崖 (外景·夜)
    # 模式4: 场1：大佛悬崖 / 外景 / 夜
    scene_header_pat = re.compile(
        r'^(?:[△▲\s]*)'
        r'(?:场|第)?\s*([0-9]{1,3}(?:-[0-9]{1,3})?)\s*'
        r'[:：\.\s、\t]+'
        r'([^\r\n]+)$'
    )
    
    def finalize_scene(sc):
        if not sc:
            return
        # 提炼一句话剧情
        content = " ".join(sc["raw_lines"])
        # 过滤括号说明，抽取前两条有意义的行为对白
        actions = []
        for line in sc["raw_lines"]:
            line_str = line.strip()
            if not line_str or line_str.startswith("【") or line_str.startswith("（"):
                continue
            if len(line_str) > 6:
                actions.append(line_str)
            if len(actions) >= 2:
                break
        
        summary = "；".join(actions) if actions else content[:80]
        if len(summary) > 70:
            summary = summary[:67] + "..."
        sc["story"] = sc["story"] or summary
        scenes.append(sc)

    for line in lines:
        raw_line = line.strip()
        m = scene_header_pat.match(raw_line)
        if m:
            finalize_scene(current_scene)
            scene_idx = m.group(1)
            rest = m.group(2).strip()
            
            # 解析 rest 里的场景名、内外景、昼夜
            tokens = [t.strip() for t in re.split(r'[\s/／·|｜\-]+', rest) if t.strip()]
            
            setting = "外景"
            daypart = "日"
            name_parts = []
            
            for t in tokens:
                if t in ["外", "外景"]:
                    setting = "外景"
                elif t in ["内", "内景"]:
                    setting = "内景"
                elif t in ["异空间", "幻境", "功法幻境"]:
                    setting = "异空间"
                elif t in ["日", "白天", "晨", "早"]:
                    daypart = "日"
                elif t in ["夜", "夜晚", "夜景"]:
                    daypart = "夜"
                elif t in ["黄昏", "傍晚"]:
                    daypart = "黄昏"
                elif t in ["黎明", "清晨"]:
                    daypart = "黎明"
                elif t in ["无昼夜", "全天"]:
                    daypart = "无昼夜"
                else:
                    name_parts.append(t)
            
            scene_name = "·".join(name_parts) if name_parts else rest
            slugline = f"{setting} · {scene_name} · {daypart}"
            
            ep_tag = f"EP{episode_num:03d}_" if episode_num else ""
            sc_id = f"{ep_tag}{int(scene_idx.split('-')[0]):02d}"
            
            current_scene = {
                "id": sc_id,
                "scene_index": scene_idx,
                "scene_name": scene_name,
                "setting": setting,
                "daypart": daypart,
                "slugline": slugline,
                "story": "",
                "raw_lines": []
            }
        else:
            if current_scene:
                current_scene["raw_lines"].append(raw_line)
                
    finalize_scene(current_scene)
    return scenes

def parse_script_file(file_path, episode_num=None):
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(f"剧本文件不存在: {file_path}")
    text = p.read_text(encoding="utf-8", errors="replace")
    return parse_script_scenes(text, episode_num=episode_num)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="分集剧本场次解析工具")
    parser.add_argument("--input", required=True, help="剧本 txt 文件路径")
    parser.add_argument("--ep", type=int, default=None, help="集数，如 2")
    parser.add_argument("--output", help="输出 json 路径")
    args = parser.parse_args()

    scenes = parse_script_file(args.input, episode_num=args.ep)
    print(f"成功解析出 {len(scenes)} 个场次：")
    for s in scenes:
        print(f"  - [{s['id']}] {s['slugline']}")
        print(f"    剧情: {s['story']}")

    if args.output:
        Path(args.output).write_text(json.dumps(scenes, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已保存至: {args.output}")
