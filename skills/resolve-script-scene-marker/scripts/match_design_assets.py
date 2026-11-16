"""美术场景设计图智能匹配工具
从项目资产库中检索与剧本场景相符的概念设计图 (Design JPG/PNG)。
"""

import os
import difflib
from pathlib import Path

# 针对《踏星》特化及通用的场景关键词别名映射
DEFAULT_SCENE_SYNONYMS = {
    "大佛悬崖": ["JinLingQian-XuanYaA", "XuanYa", "DaFo", "悬崖", "大佛"],
    "飞船残骸": ["JinLingQian-XuanYaA", "FeiChuan", "残骸"],
    "星陨点": ["JinLingQian-XuanYaA", "XingYunDian"],
    "塑体幻境": ["SuTiHuanJing", "塑体", "幻境"],
    "指挥中心": ["ZhiHuiZhongXinNei", "ZhiHuiZhongXinWai", "指挥中心"],
    "军事区": ["ZhiHuiZhongXinWai", "JunShiQu"],
    "营区": ["ZhiHuiZhongXinWai", "YingQu"],
    "陆隐营帐": ["LuYinZhangPengNei", "ZhangPeng"],
    "天星功": ["TianXingGong", "天星"],
    "尸潮战场": ["ShiChaoZhanChang", "战场", "ShiChao"],
    "楼房废墟": ["LouFangFeiXuNei", "FeiXu"],
    "矿坑": ["FeiQiKuangKeng", "KuangKeng", "矿"],
    "加油站": ["JiaYouZhan", "加油站"],
    "防空洞": ["FangKongDong", "避难所", "防空洞"],
    "荒野": ["HuangYe", "KuangYe", "荒野"],
    "京城华营": ["JingChengHuaYing", "ChengMenWai", "HuaYing", "华营"],
    "京城外": ["JingChengWai", "HuangYe"],
    "科技院": ["KeJiYuan", "JingCheng_KeJiYuanNei", "科技院"],
    "城西战场": ["JingChengHuaYing_ChengXi", "ChengXi"],
    "山顶": ["JingChengWai_ShanDing", "ShanDing"],
}

def scan_design_assets(assets_dirs):
    """扫描指定资产目录中的所有设计图文件。"""
    asset_files = []
    exts = {".jpg", ".jpeg", ".png", ".webp"}
    for ad in assets_dirs:
        p = Path(ad)
        if not p.exists():
            continue
        for root, _, files in os.walk(p):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in exts:
                    full_p = Path(root) / f
                    asset_files.append(full_p)
    return asset_files

def match_scene_asset(scene_name, asset_files, custom_mapping=None):
    """为指定场景名匹配最佳美术设计图路径。"""
    if custom_mapping and scene_name in custom_mapping:
        target = Path(custom_mapping[scene_name])
        if target.exists():
            return str(target), 1.0

    # 1. 尝试同义词与关键词搜索
    keywords = [scene_name]
    for k, synonyms in DEFAULT_SCENE_SYNONYMS.items():
        if k in scene_name or scene_name in k:
            keywords.extend(synonyms)

    best_match = None
    best_score = 0.0

    for af in asset_files:
        path_str = str(af).replace("\\", "/")
        stem = af.stem.lower()
        score = 0.0
        
        # 优先选择包含 "Design" 且在 Scence 目录下的
        if "/design/" in path_str.lower() or "/scence/" in path_str.lower() or "/scene/" in path_str.lower():
            score += 0.2

        for kw in keywords:
            kw_l = kw.lower()
            if kw_l in stem:
                score += 0.6
            elif kw_l in path_str.lower():
                score += 0.3
            else:
                sim = difflib.SequenceMatcher(None, kw_l, stem).ratio()
                if sim > 0.5:
                    score += sim * 0.4
                    
        if score > best_score:
            best_score = score
            best_match = af

    if best_match and best_score >= 0.4:
        return str(best_match), best_score
    return None, 0.0

if __name__ == "__main__":
    search_dirs = [
        r"Y:\TX\AI\TX_Assets_Design_JPG\Scence",
        r"Y:\TX\AI\TX_Assets_Design_JPG\其他设计",
        r"Y:\TX\Assets\Scence",
        r"Y:\TX\Assets\其他设计"
    ]
    assets = scan_design_assets(search_dirs)
    print(f"扫描到 {len(assets)} 个候选设计图。")
    
    test_scenes = ["星陨点·大佛悬崖", "塑体幻境", "刑营·指挥中心", "楼房废墟·一二层", "科技院·旧楼废墟"]
    for ts in test_scenes:
        p, score = match_scene_asset(ts, assets)
        print(f"场景: {ts} -> 匹配图: {p} (得分: {score:.2f})")
