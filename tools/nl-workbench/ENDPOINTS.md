# 年轮AI API 侦察记录（2026-11-16）

- 站点：`https://nl.nianlunai.com`（中影年年/多态云脑，品牌 Neuralun）
- API 前缀：`/business-center`（同源 nginx → 后端，JSON `{code,msg,data,diagnosticId}`）
- 鉴权头：`annual-ring-token` = 浏览器 `localStorage.token`；失效返回 `{"code":401}`
- **nginx 浏览器头过滤**：部分端点缺 Origin/Referer 会吃 405 或 SPA 兜底 → nl.mjs 默认带 Origin/Referer/UA
- **token 自动获取（已实现）**：nl.mjs 直接扫本机 Chrome/Edge/Antigravity 的 Local Storage leveldb 提取 `nl.nianlunai.com` 的 `token` 记录（`.log/.ldb`，取最后写入值）；401 时自动重扫重试。手动兜底 `.nl-token` / `NL_TOKEN` env
- **不可自动化的**：密码登录 `/user/login` 要 `humanToken`（滑块验证，`agreementAccepted` 字段已确认）；`/pluginApi/*` API Key 仅团队所有者（当前账号 800 无权限）；Git Bash 传参 `/path` 会被 MSYS 转义（nl.mjs 已归一化处理）
- 无官方 MCP / CLI / 公开 API 文档。前端另有「API中心」页面（pluginApiCenter），待登录后探查是否发 API Key。

## 已确认可调端点（前端 bundle 提取）

### 账号/团队/资产
```
GET  /user/user-info                      用户信息
GET  /user/storage-info                   存储用量
GET  /team/space/options                  团队空间列表（切踏星空间用）
POST /team/space/switch                   切换空间
GET  /ai/asset/getListByTaskId?id=        任务产物资产
POST /ai/asset/isCollect                  收藏资产
POST /ai/asset/validateUsable             资产可用性校验
```

### AIGC 任务（aipc）
```
POST /aipc/generateVideo                  文/图生视频（计费）
POST /aipc/generateImg                    生图（计费）
POST /aipc/generateAudio                  音频（计费）
POST /aipc/generateText                   文本
POST /aipc/submitLipSyncVideo             对口型
POST /aipc/toolTask/submit                工具任务（taskType 枚举，如 genBackgroundMusic）
POST /aipc/calculateVideoPoints           视频费用预估
POST /aipc/enhanceVideoPointsEstimate     增强预估
GET  /aipc/query/queryVideoTask           视频任务查询（params: taskId[,key]）
GET  /aipc/query/queryImgTask|queryAudioTask|queryTextTask|queryLipSyncVideoTask
GET  /aipc/toolTask/query                 工具任务查询
GET  /aipc/query/taskId                   任务ID查询
GET  /aipc/query/modelAndParam            模型与参数清单
GET  /aipc/generationQueue                生成队列
GET  /aipc/resultGenerationInfo           结果生成信息
DELETE /aipc/waitingTask                  取消等待任务（params: taskId）
PUT  /aipc/waitingTask/sort               排队排序
POST /aipc/queryDraftVideoAssets          草稿视频资产
```

### 画布/项目（ai/project/manage）
```
POST /ai/project/manage/saveOrUpdate      保存或创建画布（不带 id = 新建，待验证载荷）
GET  /ai/project/manage/canvasDetail?id=  画布详情
POST /ai/project/manage/canvas/lock/acquire|renew|release   画布编辑锁
POST /ai/project/manage/snapshot          快照
POST /ai/project/manage/saveUploadAsset   上传资产入库
POST /ai/project/manage/getOriginAsset    取原始资产
POST /ai/project/manage/getVideoClipSource 取剪辑源
```

### 插件工作流（pluginCanvas + pluginRun）—— 自动化主面
```
GET  /pluginCanvas/plugin/page            插件分页列表
POST /pluginCanvas/save|update            插件画布保存/更新
POST /pluginCanvas/savePluginVersion      存版本
GET  /pluginCanvas/version/list/{id}      版本列表
GET  /pluginCanvas/version/{id}           版本详情
GET  /pluginCanvas/version/{id}/pluginKey 版本插件 key
GET  /pluginCanvas/version/public/{id}    公开版本
GET  /pluginCanvas/versions/{id}
GET  /pluginCanvas/version/page           版本分页
POST /pluginCanvas/publish/status         发布状态
POST /pluginRun/submit                    提交工作流 run（body: {pluginVersionId, userInputJson}，待验证）
POST /pluginRun/calculatePoints           run 费用预估
GET  /pluginRun/query?runId=              run 状态查询
POST /pluginRun/retryCurrent|restart|pause/continue   run 控制
```

### 积分/会员
```
GET  /memberCommodity/points/summary      年糕积分汇总
GET  /memberCommodity/quota/current       当前配额
GET  /memberCommodity/subscription/current 当前订阅
POST /pointsRecords/listPage              积分流水 {page,size}
GET  /commodity/list                      商品
GET  /memberCommodity/points/daily/claim  每日领取
```

### 其他
```
GET  /ai/main/creativeOutline             创作大纲
POST /ai/main/clearUpdateMark
GET  /ai/voice/voiceList|voiceEmotionList 音色库
```

## 2026-11-16 实测验证（token 有效，userId 10875 / enterpriseId 16）

✅ 已验证：
- `GET /user/user-info` → 周昆林 zhoukunlin@zynnzz.com
- `GET /ai/project/manage/canvasDetail?id=` → 踏星画布完整 nodes/edges/viewport/canvasConfig 可读
- `POST /ai/project/manage/saveOrUpdate` `{projectId, canvasName}` → **新建画布成功**（实测产出 id `…a1756543230`）
- `POST /ai/project/manage/saveOrUpdate` `{id, sourceMaterials:{nodes,edges,viewport,canvasConfig}}` → **节点写回成功**（读回已持久化）
- `GET /pluginCanvas/plugin/page?current=&size=` → 工作流插件列表（records 含 id/name/type/latestVersionId）
- 踏星 projectId = `1784616738985a2731223562`（来自 localStorage `aigc:recent-project-canvas`）

❌ 不存在/未找到：`/project/manage/page|detail`、`/ai/project/page|list|detail`（405/SPA 兜底）；项目列表端点待抓（TX 场景不刚需，projectId 已知）

⏳ 有接口未实测（会扣积分，需指定真实对象后再试）：
- `pluginRun/submit`（需 pluginVersionId + userInputJson，前端有包装函数 userInputJson/showPrompt）
- `aipc/generateVideo|generateImg|generateAudio` 提交参数结构（先 `calculateVideoPoints` 预估）
- 「API中心」长效 API Key（替代会过期 web token）

