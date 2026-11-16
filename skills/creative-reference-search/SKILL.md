---
name: creative-reference-search
description: 根据提示词、剧情或已有参考搜创意案例，适用于找视频特效、灯光氛围、环境场景、字体排版、文案或 UI 界面参考；跨来源排序，每批二十条，按用户选择收藏或将许可明确的素材入库。不是直接出图、写稿或设计界面的入口。
---

# 创意参考搜索

**踏星按镜号或剧情找动态特效**：先走项目的 [GIF + PureRef 交付规范](../tx-layout-atmosphere/references/pureref-vfx-board.md)。本技能的结果页用于扩选，不替代项目要求的独立 GIF、原生 `.pur` 和原片秒段。普通创意参考继续按下文。

## 查找

1. 输入一句话、剧情、镜头号、网址或已有候选号。把需求拆成可观察的属性和方向。字体/排版看字形、版式与语种；文案看用途和语气；UI 看设备、页面任务、层级和交互状态；场景看空间和材质；灯光看光源和空气层；特效看阶段、方向、尺度和物理反应。多方向查询用分组，不要求用户先选类别。
2. 踏星需求优先查已登记项目参考。现有特效库可用脚本的 `local`；已有共享参考可用 `find`。确有缺口再用当前 Codex 自带网页搜索，按中英文画面关键词去 B 站、YouTube、作品页或素材站找，不需要用户申请 API key。只发公开检索关键词，不把项目完整剧情、未公开镜号或本地路径发给外部站点。
3. 打开较强候选核对来源、内容和媒体证据。先汇总足量不同候选，优先原发布页；不把同一来源的转载或多个截图当多个候选。尽量覆盖不同做法，但排序优先贴题；数量不足如实交付。候选结构、打分和许可规则见 [workflow.md](references/workflow.md)。
4. 用脚本 `build` 生成独立结果页与快照。给用户一个页链接：默认首批 20 条，「换一批」浏览同一排名的后续结果；重新搜索另建结果页。候选卡显示匹配理由、可见互动、核对状态及来源。仅在有实际依据时标时码、热度或可入库状态。用户说「像 07，但更暗」时，保留明确要求，另搜新的候选；不把已选项自动入库。

## 选中后

- 用户在页面勾选，可跨批次保留，并将复制的编号发回聊天。结合对应结果快照处理；相同编号在不同搜索中不通用。确认后按 [workflow.md](references/workflow.md) 决定「只收藏链接」「下载已许可的官方原文件」或「使用用户提供的原文件」。用户只说收藏时，不下载。仅有公开播放页，不等于有原文件存档或出图权限。
- `save` 返回永久参考 ID。带许可的视频生成短片、高清 PNG 与 GIF；静态图保留原图；字体、文案、UI 的第一版保存原页链接，可另将获准的静态预览按图片入库。`--allow-generation` 仅在该用途明确获准时添加。
- 踏星出图时用 `lookup --for-generation` 取回高清帧，只借登记的效果层、环境或用光。Layout 仍锁机位、景别、人物与构图；仅收藏条目不作为出图输入。不启动独立出图流程，不改既有项目批准登记。

## 命令

从项目根目录运行，结果页文件夹用 `output/creative-reference-search/` 下的新名称。下面命令中的 `SCRIPT` 为本技能 `scripts/reference.py` 的路径；`INPUT` 是编制的 UTF-8 JSON，`BOARD` 为本次结果目录。

```powershell
python -X utf8 SCRIPT local --query '洞穴 光束 浮尘' --out LOCAL_JSON
python -X utf8 SCRIPT build --input INPUT --out BOARD
python -X utf8 SCRIPT save --snapshot BOARD/results.json --id 07 --note '只借侧逆光'
python -X utf8 SCRIPT save --snapshot BOARD/results.json --id 08 --file ORIGINAL --range 72 76 --permission project --evidence '已核对项目用途' --allow-generation --shot Ep003_sc005_017
python -X utf8 SCRIPT find 'Ep003_sc005_017'
python -X utf8 SCRIPT lookup TXREF_ID --for-generation
```

远程原文件以 `--download-url HTTPS_URL` 替代 `--file`，该候选须已标可入库并写明 `--permission explicit --evidence ...`。工具默认库为 `Y:/TX/参考资料/镜头参考库/`；其他项目或测试通过 `--library` 指定。建板和链接收藏只需 Python；媒体入库使用本机 Pillow 和 FFmpeg。
