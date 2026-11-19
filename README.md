# 漫剧项目出图指南

本仓库沉淀自 CG 漫剧项目《踏星》（TX）实际生产管线中的 Agent Skills 与工程规范，覆盖**分镜与 Layout 取证 → 资产/灯光对照 → 轻量 AI 氛围出图与提示词分级规范 → 审核台单轮返修 → 动态特效 PureRef 参考交付 → 创意参考搜索**完整出图工作流。

> 说明：本仓库聚焦漫剧/动画影视项目的标准出图、提示词规范与审核返修流程，已移除本机用户名与内网敏感地址，并排除与核心出图无关的达芬奇打标、资产同步、年轮画布及短剧分镜（LibTV）模块。

---

## 出片审核与场次 CK

- 整集或整场先按 Layout 选代表全景定氛围和色调；打斗另定特效标准镜。范围内必需 CK 全部通过并归档后，才进入后续制作；明确跳过则另记。
- CK、正式镜头、返修共用[出片审核规范](skills/tx-layout-atmosphere/references/ck-review.md)：制作端先自检；候选纵向排列，可直接写意见、画线、编号，或通过／退回，支持可选本地 VLM 五维初审。模型与渲染方式不改变审核标准。
- 退回后逐条返修、重出、复检，再按新版本重新送审。内附[可复用审核页模板](skills/tx-layout-atmosphere/assets/ck-review/)；仓库不含项目实际图片或审核数据。

## 核心规范与工作流原则

项目根规范详见 [AGENTS.md](AGENTS.md) 与 [.vfx/project.json](.vfx/project.json)：

1. **零裁切与原画幅锁定**：严格保持 Layout/原图景别（Shot Scale / FOV）、机位、角色身份与场景结构；禁止通过物理裁切或上下/左右补黑边强制适配固定比例。
2. **场景先行，Shading 优先**：按本帧可见内容检索角色、场景与道具的 Shading 图，缺图时再回退设计图；官方拼版/三视图需裁出干净单格再传入；区分「资产展示光」与「镜头真实用光」。
3. **轻量首版与自主布光**：取消固定风格样板强绑定，按剧本时段、Layout 已有光源与设计图固有色自主布光；每镜出图一次，只做明显穿帮检查，不做无限循环抽图。
4. **视觉风格与景别景深规范**：地球篇（科幻末世 CG 电影）与离地后（沙丘/星战级体量感）阶段统一；按景别分级控制景深（WS `24–28mm T5.6–T8.0`、MS `35–50mm T3.5–T4.0`、CU `85–100mm T2.0`，严禁广角硬虚焦）。
5. **即梦 5.5 提示词篇幅分级**：特写/单人近景精准聚焦不硬凑字数；大场景/多人/复杂特效/多参考图镜头需充分展开至 4200–4900 字（上限 5000 字），支撑跳过 CK 后的跨镜一致性。
6. **即梦 V8.2 独立创意线与跨程序统一验收**：V8.2 仅作独立概念候选线（不锁构图）；正式镜头统一通过简报 JSON 与 4K（3840px 宽级 PNG）交付核验（`.qa.json`）。
7. **按需启用特效设计**：仅在明确涉及特效设计、改效或风格统一时启用特效模式路由（`Concept` / `Production` / `Hybrid` / `Style Match`），普通人像与常规出图不被过度拆解。

---

## 出图与审核简表

出图前只定三件事（详见[出图与审核简表](skills/tx-layout-atmosphere/references/cinematic-look-standard.md)）：锁画面、锁连续性、给模型一两个本镜重点。具体用光与材质按场次和审片反馈调整，实际镜头图和素材不纳入本仓库。

## 技能清单（`skills/`）

| 技能目录 | 功能定位 | 核心文件与脚本 |
| :--- | :--- | :--- |
| [tx-layout-atmosphere](skills/tx-layout-atmosphere/SKILL.md) | **Layout → CG 电影氛围图与动态特效参考交付**<br>从 Layout/StoryBook 取证抽帧、资产与灯光对照、生成简报与 4K 交付验收；支持按镜号/剧情输出独立动态 GIF + 内嵌 GIF 的原生 PureRef 2.x `.pur` 参考板，以及整集纯图（成图+Layout 按场次分列）`.pur` 展示板导出 | `scripts/shot_delivery.py`<br>`scripts/pur_export.py`<br>`scripts/build_vfx_pur.py`<br>`scripts/search_vfx_refs.py`<br>`scripts/search_vfx_diverse.py`<br>`scripts/vfx_gif_cache.py` |
| [tx-review-render-router](skills/tx-review-render-router/SKILL.md) | **审核台单轮返修路由**<br>根据审核台 `feedback.json` 与确认记录，单轮调度 Codex 原生、A2E API 或即梦原生画布进行返修出图，只报告质检不自动循环 | `SKILL.md` |
| [vfx-shot-design](skills/vfx-shot-design/SKILL.md) | **镜头 AI 特效设计主技能**<br>按意图选择 `Concept` / `Production` / `Hybrid` / `Style Match` 模式，规范结构分层、能量因果与 UE/Houdini 可落地建议 | `SKILL.md`<br>`references/output-standards.md` |
| [creative-reference-search](skills/creative-reference-search/SKILL.md) | **创意参考搜索与共享参考入库**<br>跨来源检索灯光/场景/特效案例，生成每批 20 条的交互式 HTML 候选板（`board.html`），按授权规则归档可溯源参考 ID（`TXREF`）与高清关键帧 | `scripts/reference.py`<br>`scripts/media.py`<br>`assets/board.html` |

---

## 仓库目录结构

```text
manju-image-guide/
├── README.md                          # 本指南（漫剧项目出图指南）
├── AGENTS.md                          # 项目级出图、提示词分级与特效路由总则
├── .vfx/
│   ├── project.json                   # 项目路径与路由配置
│   ├── examples.md                    # 典型调用示例与验收场景
│   └── style-references.json          # 风格参考登记表模板
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
