# 达芬奇剧本分镜场景智能标记工具使用示例

本技能打通了 **剧本定稿**、**场景设计图库**、**分镜头剪辑 (Layout/StoryBook)** 与 **DaVinci Resolve 时间线**。

## 典型工作流

### 1. 巡检当前时间线与标记状态
```powershell
python skills\resolve-script-scene-marker\scripts\inspect_timeline.py --export-tc "01:22:10:21" --export-img "output\inspect_frame.png"
```

### 2. 解析分集剧本
```powershell
python skills\resolve-script-scene-marker\scripts\parse_script.py --input "episodes_text\《踏星》第二集【剧本定稿】.txt" --ep 2 --output "output\ep002_scenes.json"
```

### 3. 美术资产检索与匹配
```powershell
python skills\resolve-script-scene-marker\scripts\match_design_assets.py
```

### 4. 预览与写入达芬奇标记
```powershell
# 预检 (Dry-Run)
python skills\resolve-script-scene-marker\scripts\apply_scene_markers.py --manifest "output\resolve_scene_guide_slugline\manifest.json" --mode dry-run

# 正式写入 (Apply)
python skills\resolve-script-scene-marker\scripts\apply_scene_markers.py --manifest "output\resolve_scene_guide_slugline\manifest.json" --mode apply

# 恢复/回滚 (Rollback)
python skills\resolve-script-scene-marker\scripts\apply_scene_markers.py --manifest "output\resolve_scene_guide_slugline\manifest.json" --mode rollback
```

### 5. 生成 HUD 导览条卡片（可选）
```powershell
python skills\resolve-script-scene-marker\scripts\generate_guide_hud.py --manifest "output\resolve_scene_guide_slugline\manifest.json" --output-dir "output\guide_cards"
```
