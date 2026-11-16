import json, shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
market = root / "codex-marketplace"
plugin = market / "plugins" / "tx-vfx-director"
skill = plugin / "skills" / "tx-vfx-director"
source_skill = Path.home() / ".codex/plugins/cache/personal/vfx-director/0.2.0+codex.20260801084313/skills/vfx-director/SKILL.md"
def put(file, obj):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
put(market/".agents/plugins/marketplace.json",{"name":"tx-vfx-local","interface":{"displayName":"踏星 · 本地工作台"},"plugins":[{"name":"tx-vfx-director","source":{"source":"local","path":"./plugins/tx-vfx-director"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Productivity"}]})
put(plugin/".codex-plugin/plugin.json",{"name":"tx-vfx-director","version":"0.6.0","description":"踏星人物技能笔刷、可编辑曲线和透视，手绘草稿一键发到 Codex 出图。","author":{"name":"Local developer"},"skills":"./skills/","mcpServers":"./.mcp.json","interface":{"displayName":"踏星特效工作台","shortDescription":"手绘特效后点直接出图，原镜头和草稿自动送到 Codex","developerName":"Local developer","category":"Productivity","defaultPrompt":"打开踏星特效工作台"}})
put(plugin/".mcp.json",{"mcpServers":{"tx_vfx_director":{"command":"node","args":["./dist/server/index.mjs"],"cwd":"."}}})
for name in ("server/index.mjs","web/index.html"):
    dest = plugin/"dist"/name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root/"dist"/name,dest)
s=source_skill.read_text(encoding="utf-8").replace("name: vfx-director","name: tx-vfx-director",1)
s=s.replace("description: 打开单张图片的", "description: 在踏星项目打开特效工作台、使用技能预设直接出图、或处理踏星工作台提交的 inline 请求。打开单张图片的",1)
s=s.replace("# VFX Director v2","# 踏星特效工作台",1)
s=s.replace("1. 优先使用用户明确附加", "0. 用户要求打开踏星特效工作台时，调用 `mcp__tx_vfx_director__open_vfx_editor`。若本轮消息已经是工作台「直接出图」提交的 inline v2 请求，跳过打开编辑器，直接按下文生成；无需导出包、让用户再说明或再确认同一动作。保留源图机位、人物、姿态、文字及非特效区域。\n1. 优先使用用户明确附加",1)
s=s.replace("4. 成功打开后停止操作，让用户在浮动编辑器内确认对象、建立特效组、绘制并提交。未提交前不要自动出图。","4. 成功打开后停止操作。简洁模式中点技能即填入预设，单人无需建组或写说明。「手绘草稿」提供通用 20 种、踏星人物 10 种造型，可改贝塞尔锚点、整层移动缩放旋转或设置 2.5D Z 深度，可选导出透明 PNG，也可在手绘页点击「直接出图」把原镜头、手绘草稿和遮挡送到当前对话。原「引导与生成」的直接出图同样保留。未提交前不要自动出图。",1)
s=s.replace(
    '1. 严格读取图片顺序。',
    '0. 若 mode 为 hand-draft-refine：第 1 张仍是唯一编辑底图；第 2 张是同画幅的合成草稿；第 3 张是手绘足迹；第 4 张是保护图；guides.draftAlphaImageNumber 指向独立透明特效草稿（通常第 5 张），不是文字层或普通参考图。使用可用的图片编辑工具按合成草稿精修并在对话展示图片：保留落点、路径、透视、近远与前后遮挡，只在足迹内改善材质和发光细节。第 4 张已扣除用户设为前景的笔迹区域；未标注区域保持原镜头。没有文字包装请求时，不要生成新文字或界面。不得要求用户导出工程或重新上传这次已经随请求附带的图。\n1. 其他 inline v2 请求严格读取图片顺序。',
    1,
)
s=s.replace("调用 `get_vfx_request`","调用 `mcp__tx_vfx_director__get_vfx_request`")
skill.mkdir(parents=True,exist_ok=True)
(skill/"SKILL.md").write_text(s,encoding="utf-8")
print(plugin)

