---
name: tx-art-image-sync
description: 从项目资产管理客户端（Nteam/Zynn）服务器核对踏星TX资产记录，补齐本地 Assets 缺失的美术设计图片，并直接覆盖本地旧图，不保存旧图副本。用于更新、下载或查缺TX设计图；不用于创作出图、贴图、模型或镜头视频更新。
---

# 踏星设计图增量更新

默认对象为项目 `Assets` 目录（可通过 `--target` 或环境变量 `TX_ASSETS_DIR` 指定），服务器项目为 `TX`（项目 ID 可通过 `TX_PROJECT_ID` 配置）。若本地使用盘符映射（如 `<PROJECT_ROOT>` 映射到 `<LOCAL_WORK_ROOT>`），两者指向同一份文件，不是两套源库。服务器记录来自资产管理客户端，不从其他客户端当前打开的项目推断。

## 执行

用户要求更新、同步或补齐设计图时运行（默认包含旧图覆盖）：

```powershell
python -X utf8 "skills/tx-art-image-sync/scripts/sync_art.py" --apply
```

只要求核对、预览差异时，去掉 `--apply`。脚本通过 `--helper` 或环境变量 `TX_PIPELINE_HELPER_DIR` 指向外部管线辅助模块（`zynn_updater_runner.py`），复用现有登录会话与原生传输服务，以及 Python 的 Pillow、websocket-client 和原有会话依赖；不修改客户端程序、登录信息或服务器记录。不把会话值写入报告或对话。登录过期时让用户在客户端登录，不切换账号。

每次读取当前服务器目录树和分页文件记录，不把上次快照当作当前状态。只选 Design 或含“设计”的目录中的 JPG/JPEG/PNG/WebP/BMP/TIF/TIFF；跳过 Texture、贴图、Modeling、Shading、Maya、UE 等制作目录，跳过PSD、工程和视频。读取 `references/local-workflow.md` 可查看映射、接口与验证约定。

## 更新规则与验证

- 缺失图片下载；服务器修改时间比本地新超过2秒时，直接替换原路径旧图，不生成旧图、bak、old副本。同一时间容差内大小不同也以服务器文件修复。
- 本地修改时间比服务器新超过2秒的图片单列local_newer，不向旧服务器文件降级；本地独有文件不删。
- 原生传输先写入本次记录目录的 staging，全部通过字节数、图片解析和可用服务器哈希校验后，新增图无覆盖发布，旧图用已校验的新文件原子替换到原路径。新增与替换均记录SHA-256；旧图仅记录原哈希、大小、时间，不保存旧图内容。
- 完成后再运行一次不带 `--apply` 的实时核对，确认当前服务器集合的缺失数与待更新数。若服务器在两次核对间新增内容，再运行更新，最多一次额外更新后报告剩余差异，避免持续变化导致无限循环。
- 结果保存在 `--output` 或 `TX_SYNC_OUTPUT_DIR` 指定的目录下（`<时间-编号>`）。报告新增、覆盖、剩余缺失、剩余待更新和本地较新数量及记录路径。元数据一致不等同于服务器与旧图逐字节一致，不宣称全库内容哈希验证。
- 一次下载最多等待30分钟；网络/分页/图片验证异常有错误记录，保留已验证的新增项与暂存文件，不伪称完成。不取消传输客户端中其他任务。

已有中断记录与暂存时，不重新开始下载；继续同一快照：

```powershell
python -X utf8 "skills/tx-art-image-sync/scripts/sync_art.py" --resume "RUN" --apply
```

RUN 是中断记录目录。完整暂存图片会复用；缺失/不完整的暂存才重新提交。继续完成后仍须执行一次新的实时核对。超大原画用结构/CRC校验，不展开整张像素数组；这不是重新压缩或改图。

## 撤销范围

先预览（`RUN` 换成该次记录目录的绝对路径）：

```powershell
python -X utf8 "skills/tx-art-image-sync/scripts/sync_art.py" --rollback "RUN"
```

用户明确要求撤销新增时加 `--apply-rollback`。只移除该次新增且SHA-256仍匹配的文件；后来编辑过的图片保留。按用户要求，覆盖时未留旧图，因此此入口保留替换后的服务器图片，不恢复旧图。默认更新不执行撤销。

## 维护测试

修改同步脚本后运行：

```powershell
python -X utf8 -m unittest discover -s "skills/tx-art-image-sync/scripts" -p "test_*.py" -v
```

测试使用独立临时目录，覆盖过滤、路径边界、缺失补齐、旧图直接替换、无旧图备份、本地较新保护与撤销边界，不连接服务器。

## 人物、场景、道具的 Shading 图片

同时同步两类图片：`python -X utf8 "skills/tx-art-image-sync/scripts/sync_art.py" --include-shading --apply`。
该开关从 TX 实时目录树递归查找人物、场景、道具下的 Shading 及子目录，仅接收支持的栅格图片，不下载 PSD 或制作工程。省略开关则保留旧版仅设计图行为。达芬奇工作台的「更新服务器图片」默认启用两类图片同步。无服务器图片的目录及本地独有图保持原样。
