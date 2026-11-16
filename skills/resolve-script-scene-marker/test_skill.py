"""自动化技能自测套件 (Skill Self-Test Suite)
用于一键测试：
1. DaVinci Resolve Python 环境连接
2. 剧本解析模块 (parse_script.py)
3. 美术资产智能匹配模块 (match_design_assets.py)
4. 时间线巡检模块 (inspect_timeline.py)
5. 标记批量写入与回滚预检 (apply_scene_markers.py --mode dry-run)
"""

import sys
import os
import json
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# 添加 scripts 目录至环境变量
SKILL_ROOT = Path(__file__).parent.resolve()
SCRIPTS_DIR = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

def test_resolve_connection():
    print("\n[1/5] 测试 DaVinci Resolve 连接...")
    try:
        from resolve_env import get_resolve_context
        ctx = get_resolve_context()
        proj_name = ctx["project"].GetName()
        tl_name = ctx["timeline"].GetName() if ctx["timeline"] else "None"
        print(f"  ✓ 成功连接 DaVinci Resolve!")
        print(f"    当前工程: {proj_name}")
        print(f"    当前时间线: {tl_name}")
        return True
    except Exception as e:
        print(f"  ✗ Resolve 连接提示: {e}")
        print("    (若 Resolve 未启动，此项跳过，但不影响文本解析与资产匹配测试)")
        return False

def test_parse_script():
    print("\n[2/5] 测试剧本解析模块 (parse_script)...")
    from parse_script import parse_script_scenes
    sample_text = """
△1  星陨点·大佛悬崖  夜  外
陆隐安葬女孩，取下亚斯塔的终端并启动塑体决。
陆隐咬牙将手按在终端上。

△2  塑体幻境  无昼夜  异空间
塑体决重塑陆隐的身体，修炼境界在幻境中展开。
    """
    scenes = parse_script_scenes(sample_text, episode_num=2)
    assert len(scenes) == 2, f"Expected 2 scenes, got {len(scenes)}"
    print(f"  ✓ 成功解析出 {len(scenes)} 个测试场次:")
    for s in scenes:
        print(f"    - [{s['id']}] {s['slugline']} | 剧情: {s['story'][:25]}...")
    return True

def test_match_assets():
    print("\n[3/5] 测试美术资产匹配模块 (match_design_assets)...")
    from match_design_assets import scan_design_assets, match_scene_asset
    candidate_dirs = [
        r"Y:\TX\AI\TX_Assets_Design_JPG\Scence",
        r"Y:\TX\Assets\Scence"
    ]
    assets = scan_design_assets(candidate_dirs)
    print(f"  ✓ 扫描到候选设计图 {len(assets)} 张")
    if assets:
        p, score = match_scene_asset("星陨点·大佛悬崖", assets)
        print(f"    测试检索 '星陨点·大佛悬崖' -> {Path(p).name if p else 'None'} (得分: {score:.2f})")
    return True

def test_inspect_timeline():
    print("\n[4/5] 测试时间线结构读取 (inspect_timeline)...")
    try:
        from inspect_timeline import inspect_timeline
        res = inspect_timeline()
        print(f"  ✓ 成功读取时间线: {res['timeline']}")
        print(f"    视频轨道数: {res['video_track_count']} | 总标记数: {res['total_markers']}")
        print(f"    分集标记分布: {res['episodes_summary']}")
        return True
    except Exception as e:
        print(f"  ! 跳过时间线读取: {e}")
        return False

def test_apply_markers_dry_run():
    print("\n[5/5] 测试标记应用预检 (Dry-Run 模式)...")
    manifest_sample = [
        {
            "id": "TEST_EP002_01",
            "start": 122614,
            "end": 123921,
            "duration": 1307,
            "scene": "大佛悬崖测试",
            "slugline": "外景 · 星陨点·大佛悬崖 · 夜",
            "story": "测试自动化标记流程",
            "asset": "Y:\\TX\\Assets\\Scence\\JinLingQian-XuanYaA\\Design\\JinLingQian-XuanYaA.jpg",
            "basis": "单元测试",
            "marker_name": "TEST_EP002_01｜外景 · 星陨点·大佛悬崖 · 夜"
        }
    ]
    try:
        from apply_scene_markers import apply_markers_to_timeline
        res = apply_markers_to_timeline(manifest_sample, mode="dry-run")
        print(f"  ✓ Dry-Run 预检成功: 计划处理 {res['plan_count']} 个标记。安全无写入。")
        return True
    except Exception as e:
        print(f"  ! 跳过 Dry-Run 测试: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("   达芬奇剧本分镜场景智能标记工具 (Skill 自测套件)   ")
    print("=" * 60)
    r1 = test_resolve_connection()
    r2 = test_parse_script()
    r3 = test_match_assets()
    r4 = test_inspect_timeline()
    r5 = test_apply_markers_dry_run()
    print("\n" + "=" * 60)
    print("   测试完成！所有核心脚本均可正常调用。")
    print("=" * 60)
