# 漫剧项目出图指南

本仓库沉淀自 CG 漫剧项目《踏星》（TX）实际生产管线中的 Agent Skills、工程规范与交互式特效工作台插件，覆盖**分镜与 Layout 取证 → 资产/灯光对照 → AI 氛围出图与局部精修 → 交互式手绘特效引导 → 动态特效 PureRef 交付 → 达芬奇时间线场景标记 → 美术资产同步**完整工作流。

> 说明：本仓库面向漫剧/动画影视项目的标准出图与资产协同场景整理发布，已移除本机用户名与内网敏感地址，并独立排除短剧分镜（LibTV）相关工作流。

---

## 核心规范与工作流原则

项目根规范详见 [AGENTS.md](AGENTS.md) 与 [.vfx/project.json](.vfx/project.json)：

1. **零裁切与原画幅锁定**：严格保持 Layout/原图景别（Shot Scale / FOV）、机位、角色身份与场景结构；禁止通过物理裁切或上下/左右补黑边强制适配固定比例。
2. **场景先行，Shading 优先**：按本帧可见内容检索角色、场景与道具的 Shading 图，缺图时再回退设计图；区分「资产展示光」与「镜头真实用光」。
3. **跨程序统一验收**：支持不同生图模型/适配器（Codex 原生图像工具、即梦/Dreamina、本地渲染等），统一通过简报 JSON 检查与 4K（3840px 宽级）交付核验（`.qa.json`）。
4. **按需启用特效设计**：仅在明确涉及特效设计、改效或风格统一时启用特效模式路由（`Concept` / `Production` / `Hybrid` / `Style Match`），普通人像与常规出图不被过度拆解。

---

## 技能清单（`skills/`）

| 技能目录 | 功能定位 | 核心文件与脚本 |
| :--- | :--- | :--- |
| [tx-layout-atmosphere](skills/tx-layout-atmosphere/SKILL.md) | **Layout → CG 电影氛围图与动态特效参考交付**<br>从 Layout/StoryBook 取证抽帧、资产与灯光对照、生成简报与 4K 交付验收；支持按镜号/剧情输出独立动态 GIF + 内嵌 GIF 的原生 PureRef 2.x `.pur` 参考板 | `scripts/shot_delivery.py`<br>`scripts/build_vfx_pur.py`<br>`scripts/search_vfx_refs.py`<br>`scripts/search_vfx_diverse.py`<br>`scripts/vfx_gif_cache.py` |
| [vfx-shot-design](skills/vfx-shot-design/SKILL.md) | **镜头 AI 特效设计主技能**<br>按意图选择 `Concept` / `Production` / `Hybrid` / `Style Match` 模式，规范结构分层、能量因果与 UE/Houdini 可落地建议 | `SKILL.md`<br>`references/output-standards.md` |
| [tx-vfx-director](skills/tx-vfx-director/SKILL.md) | **踏星特效工作台（VFX Director v2）**<br>配合本地 MCP 插件打开单帧特效编辑器：多目标分组、影响区/保护区、贝塞尔曲线与 2.5D 透视手绘草稿、精准文字层与直接出图请求 | `SKILL.md`<br>配套插件：[plugins/tx-vfx-director](plugins/tx-vfx-director/) |
| [creative-reference-search](skills/creative-reference-search/SKILL.md) | **创意参考搜索与共享参考入库**<br>跨来源检索灯光/场景/特效案例，生成每批 20 条的交互式 HTML 候选板（`board.html`），按授权规则归档可溯源参考 ID（`TXREF`）与高清关键帧 | `scripts/reference.py`<br>`scripts/media.py`<br>`assets/board.html` |
| [resolve-script-scene-marker](skills/resolve-script-scene-marker/SKILL.md) | **达芬奇剧本分镜场景智能标记与 HUD 导览条**<br>解析剧本场次 Slugline、匹配场景设计图、读取 DaVinci Resolve 时间线切点，幂等写入 Cyan 范围标记并生成 `1920x224` 视觉导览条 | `scripts/parse_script.py`<br>`scripts/match_design_assets.py`<br>`scripts/inspect_timeline.py`<br>`scripts/align_scene_cuts.py`<br>`scripts/apply_scene_markers.py`<br>`scripts/generate_guide_hud.py` |
| [tx-art-image-sync](skills/tx-art-image-sync/SKILL.md) | **美术设计图与 Shading 图增量同步**<br>从资产管理服务端树形扫描 Design 与 Shading 栅格图，基于暂存校验与原子替换补齐缺失并更新旧图（保护本地较新文件，支持 `--rollback` 撤销新增） | `scripts/sync_art.py`<br>`scripts/test_sync_art.py` |

---

## 配套插件：踏星特效工作台（`plugins/tx-vfx-director/`）

[plugins/tx-vfx-director](plugins/tx-vfx-director/) 是配合 `tx-vfx-director` 技能使用的交互式 MCP + Web 单帧特效引导工作台（详见 [使用说明.md](plugins/tx-vfx-director/使用说明.md)）：

- 支持对象与特效组隔离（多人物不同特效、环境/主体分区）
- 支持影响区、保护区、流向、环形/弧形/螺旋/刀光拖尾标注
- 内置手绘草稿工作室（贝塞尔曲线编辑、2.5D 透视深度 Z 控制、透明 PNG 导出与直接出图提交）
- 已预置构建产物（`dist/server/index.mjs` 与 `dist/web/index.html`），也可从源码重新构建：

```bash
cd plugins/tx-vfx-director
npm install
npm run test
npm run build
```

---

## 仓库目录结构

```text
manju-image-guide/
├── README.md                          # 本指南（漫剧项目出图指南）
├── AGENTS.md                          # 项目级出图与特效路由总则
├── .vfx/
│   ├── project.json                   # 项目路径与路由配置
│   ├── examples.md                    # 典型调用示例与验收场景
│   └── style-references.json          # 风格参考登记表模板
├── .agents/plugins/marketplace.json   # 本地插件清单入口
├── skills/                            # 全部 6 个核心技能包
│   ├── tx-layout-atmosphere/
│   ├── vfx-shot-design/
│   ├── tx-vfx-director/
│   ├── creative-reference-search/
│   ├── resolve-script-scene-marker/
│   └── tx-art-image-sync/
└── plugins/
    └── tx-vfx-director/               # VFX Director v2 MCP + React 前端工作台
```

---

## 快速使用

### 1. 安装或引入技能

- **通用 Agent Skills CLI**：
  ```bash
  npx skills add killenzhou/manju-image-guide
  ```
- **手动接入项目**：将 `skills/` 下的所需目录复制到项目 `.agents/skills/` 或用户全局技能目录，并参考根目录 [AGENTS.md](AGENTS.md) 与 [.vfx/project.json](.vfx/project.json) 映射你自己的项目素材路径。

### 2. 运行自带测试（Python 3.11+）

```bash
# 达芬奇剧本标记模块离线自测（解析与资产匹配）
python -X utf8 skills/resolve-script-scene-marker/test_skill.py

# 美术设计图增量同步单元测试（隔离临时目录）
python -X utf8 -m unittest discover -s skills/tx-art-image-sync/scripts -p "test_*.py" -v
```

### 3. 环境变量与路径映射

对于涉及本地资产根目录或管线客户端的工具脚本，可通过环境变量或命令行参数适配不同机器环境（默认均已脱敏为示例占位路径）：

- `TX_VFX_GIF_LIBRARY`：本地特效 GIF 索引目录（用于 `tx-layout-atmosphere` 补充参考检索）
- `PUREREF_EXE`：PureRef 2.x 可执行文件路径（用于生成原生 `.pur` 参考板）
- `TX_ASSETS_DIR` / `TX_SYNC_OUTPUT_DIR` / `TX_PIPELINE_HELPER_DIR` / `TX_PROJECT_ID`：用于 `tx-art-image-sync` 指定本地资产目录、同步日志输出目录、外部传输辅助模块路径与项目 ID
