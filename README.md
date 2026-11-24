# 漫剧项目出图指南

本仓库沉淀自 CG 漫剧项目《踏星》（TX）实际生产管线中的 Agent Skills 与工程规范，覆盖**分镜与 Layout 取证 → 资产/灯光对照 → 轻量 AI 氛围出图与景别提示词分级 → VFX 光照设计 → 审核台单轮返修 → 动态特效 PureRef 参考交付 → 创意参考搜索**完整出图工作流。

> 说明：本仓库聚焦 CG 漫剧/动画影视项目的标准出图、提示词规范、特效设计与审核返修流程；所有工作流文档、引用路径与辅助脚本均已脱敏并做通用化整理。

---

## 出片审核与场次 CK

- 整集或整场先按 Layout 选代表全景定氛围和色调；打斗另定特效标准镜。范围内必需 CK 全部通过并归档后，才进入后续制作；明确跳过则另记（或按即梦 5.5 长词跨镜一致性路线直接出图送审）。
- CK、正式镜头、返修共用[出片审核规范](skills/tx-layout-atmosphere/references/ck-review.md)：制作端先自检；候选纵向排列，可直接写意见、画线、编号，或通过／退回，支持可选本地 VLM 五维初审。模型与渲染方式不改变审核标准。
- 退回后逐条返修、重出、复检，再按新版本重新送审。内附[可复用审核页模板](skills/tx-layout-atmosphere/assets/ck-review/)；支持[整集纯图 PureRef 展示板导出](skills/tx-layout-atmosphere/references/ck-review.md#整集-pureref-展示板导出纯图对照)；仓库不含项目实际图片或审核数据。

## 核心规范与工作流原则

项目根规范详见 [AGENTS.md](AGENTS.md)、[.vfx/project.json](.vfx/project.json) 与 [《踏星》创意出图提示词规范](踏星_创意出图提示词规范.md)：

1. **零裁切与原画幅锁定**：严格保持 Layout/原图景别（Shot Scale / FOV）、机位、角色身份与场景结构；禁止通过物理裁切或上下/左右补黑边强制适配固定比例。
2. **场景先行，Shading 优先与物理清杂**：按本帧可见内容检索角色、场景与道具的 Shading 图，缺图时再回退设计图；官方拼版/三视图需裁出干净单格，场景参考图中多余发光体（如不需要的灯管、过曝窗）须先物理抹除。
3. **取消固定风格样板，自主布光**：首版默认不传预设固定风格图，按剧本时段、Layout 已有光源与设计固有色自主布光；每镜出图一次，只做明显穿帮检查，不循环抽图。
4. **特写精简与前后镜光照衔接**：特写/微距/单人近景（ECU/CU/MCU）重点注意前后镜头的光照连续性，突出特写主体让观众明显看清并增强局部细节；精简提示词与参考图——只要人物对、表情对、光照对即可，切忌过多提示词与参考导致跑偏。
5. **VFX 人物与特效光照关系**：含 VFX 特效的镜头核心是突出人物与特效的光照关系——大场面采用**环境光与特效光影响的结合**，表现特效对人物和场景的作用；近景表现特效时**主动压暗背景**，突出人物与 VFX 的明暗对比与受光。
6. **即梦 5.5 大场景写透与 V8.2 独立创意线**：大场景/多人/复杂特效/多参考图镜头保持详尽扎实描述（上限 5000 字，写透即止、不硬凑固定字数）支撑跳过 CK 的跨镜一致性，宽银幕 `i2i` 须显式 `--ratio 21:9`，且不直接照抄带引号台词防烧字幕；V8.2 仅作独立概念探索线（不锁构图）。
7. **按需启用特效设计**：仅在明确涉及特效设计、改效或风格统一时启用特效模式路由（`Concept` / `Production` / `Hybrid` / `Style Match`），并遵守 UE Niagara 线条感美学。
8. **UE5 质感特效红线与陆隐招数基准**：气流/风压与主角全套招数统一执行[UE5 质感特效提示词蓝图](skills/tx-layout-atmosphere/references/ue-vfx-prompt-blueprint.md)（锚点核 + 菲涅尔曲面丝带/断裂气环 + 暗骨细丝 + 前景物理碎屑景深 + 物理打光四层解剖，`tight`/`full` 双档）；已批准基准与总锚点登记于 [.vfx/style-references.json](.vfx/style-references.json)。
9. **净图资产库与批量出图执行器**：单格净图参考统一先查 `asset_vault/vault.py resolve`（FRESH 直用、缺失/过期裁切入库、源图更新只报警不覆盖）；即梦 5.5 批量出图走 `batch_spec.json` + `skills/tx-layout-atmosphere/scripts/tx_batch_runner.py`（prepare→upload→render→qc-board→publish）。

---

## 出图与审核简表

出图前只定三件事（详见[出图与审核简表](skills/tx-layout-atmosphere/references/cinematic-look-standard.md)）：锁画面、锁连续性、按景别与 VFX 需要写清光照与焦点。具体用光与材质按场次和审片反馈调整，实际镜头图和素材不纳入本仓库。

## 技能清单（`skills/`）

| 技能目录 | 功能定位 | 核心文件与脚本 |
| :--- | :--- | :--- |
| [tx-layout-atmosphere](skills/tx-layout-atmosphere/SKILL.md) | **Layout → CG 电影氛围图与动态特效参考交付**<br>从 Layout/StoryBook 取证抽帧、资产与灯光对照、生成简报与 4K 交付验收；支持按镜号/剧情输出独立动态 GIF + 内嵌 GIF 的原生 PureRef 2.x `.pur` 参考板，以及整集纯图（成图+Layout 按场次分列）`.pur` 展示板导出 | `scripts/shot_delivery.py`<br>`scripts/pur_export.py`<br>`scripts/build_vfx_pur.py`<br>`scripts/search_vfx_refs.py`<br>`scripts/search_vfx_diverse.py`<br>`scripts/vfx_gif_cache.py`<br>`scripts/tx_batch_runner.py` |
| [tx-review-render-router](skills/tx-review-render-router/SKILL.md) | **审核台单轮返修路由**<br>根据审核台 `feedback.json` 与确认记录，单轮调度 Codex 原生、A2E API 或即梦原生画布进行返修出图，只报告质检不自动循环 | `SKILL.md` |
| [vfx-shot-design](skills/vfx-shot-design/SKILL.md) | **镜头 AI 特效设计主技能**<br>按意图选择 `Concept` / `Production` / `Hybrid` / `Style Match` 模式，规范结构分层、能量因果、人物-VFX 光照关系与 UE/Houdini 可落地建议 | `SKILL.md`<br>`references/output-standards.md` |
| [creative-reference-search](skills/creative-reference-search/SKILL.md) | **创意参考搜索与共享参考入库**<br>跨来源检索灯光/场景/特效案例，生成每批 20 条的交互式 HTML 候选板（`board.html`），按授权规则归档可溯源参考 ID（`TXREF`）与高清关键帧 | `scripts/reference.py`<br>`scripts/media.py`<br>`assets/board.html` |

---

## 仓库目录结构

```text
manju-image-guide/
├── README.md                          # 本指南（漫剧项目出图指南）
├── AGENTS.md                          # 项目级出图、特写/VFX 光照与特效路由总则
├── 踏星_创意出图提示词规范.md          # 按需求分配细节的创意与贴镜提示词写作规范
├── .vfx/
│   ├── project.json                   # 项目路径与路由配置
│   ├── examples.md                    # 典型调用示例与验收场景
│   └── style-references.json          # 风格参考登记表（含已批准特效基准）
├── asset_vault/                       # 单格净图资产库（vault.py + 索引；净图本体不入库）
└── skills/                            # 全部 4 个核心出图技能包
    ├── tx-layout-atmosphere/
    ├── tx-review-render-router/
    ├── vfx-shot-design/
    └── creative-reference-search/
```

---

## 快速使用

### 1. 安装或引入技能

- **通用 Agent Skills CLI**：
  ```bash
  npx skills add killenzhou/manju-image-guide
  ```
- **手动接入项目**：将 `skills/` 下的所需目录复制到项目 `.agents/skills/` 或用户全局技能目录，并参考根目录 [AGENTS.md](AGENTS.md) 与 [.vfx/project.json](.vfx/project.json) 映射你自己的项目素材路径。

### 2. 环境变量与路径映射

对于涉及本地资产根目录或管线客户端的工具脚本，可通过环境变量或命令行参数适配不同机器环境：

- `TX_VFX_GIF_LIBRARY`：本地特效 GIF 索引目录（用于 `tx-layout-atmosphere` 补充参考检索）
- `PUREREF_EXE`：PureRef 2.x 可执行文件路径（用于生成原生 `.pur` 参考板）
- `TX_AI_ROOT` / `TX_ASSETS_ROOT` / `TX_VAULT_DIR`：AI 工作区根、美术资产源根与净图库目录（`asset_vault/vault.py`、`tx_batch_runner.py` 与 `shot_delivery.py` 共用）
- `DREAMINA_CANVAS_BIN`：即梦画布官方 CLI 可执行文件（`tx_batch_runner.py` 上传/渲染步骤）
