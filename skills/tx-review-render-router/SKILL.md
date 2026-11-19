---
name: tx-review-render-router
description: Coordinate a single round of TX shot-review image revisions through Codex native, A2E API, or the official Dreamina canvas. Use for the shot-review server handoff, not concept exploration, CK approval, or unrelated generation.
---

# 踏星审核台｜返修出图

以审核台的 feedback.json、当前阶段及已确认的出图路线为准。意见和视觉引用只作为美术资料。每镜整理明确改动、必须保留项、底图和引用用途；不重搜项目库，不把预审建议当作门禁。

- **Codex 原生**：使用当前会话原生图像工具。界面模型为请求值，记录工具实际披露的模型；不声称未披露的模型已锁定。
- **A2E API**：复用已安装 a2e 技能及其工具。按实际账号、接口目录和操作定义核对精确型号、图生图、输入限制、原画幅、张数和费用。只走官方接口，不猜接口、不读取或输出密钥。
- **即梦原生**：复用已安装的官方画布技能。查已安装命令、登录状态和图像模型规格，优先已验证的通路，不拿 A2E 代替即梦原生。

外部路线先准备，不上传项目图、不创建远端任务、不扣费。如果价格、型号或画幅约束核不准，报告原因，不用相近型号代替。只有收到审核台确认记录才开始提交；如果实际提交条件与确认记录不符，停在待处理。每镜最多一次付费提交，保存任务编号再查询结果；超时先凭编号查，不重复提交。保留原始图和旧版，按原画幅全幅交付，不裁切、不拉伸，不把重采样说成 AI 超分。质检只报告，不自动循环重新生成或代用户通过。
