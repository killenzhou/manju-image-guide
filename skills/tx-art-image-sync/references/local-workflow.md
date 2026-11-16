# 本地工作流与接口约定（已脱敏）

## 路径与客户端

- 资产目标：`<PROJECT_ROOT>\Assets`（可通过 `--target` 或 `TX_ASSETS_DIR` 指定）。
- 盘符映射示例：若本地存在盘符映射（如 `Y:\ => <LOCAL_WORK_ROOT>`），映射到同一实际目录，不可视为两套源库。
- 资产管理客户端：Nteam/Zynn；外部管线辅助模块 `<PIPELINE_HELPER_DIR>\zynn_updater_runner.py`（通过 `--helper` 或 `TX_PIPELINE_HELPER_DIR` 指定）提供活跃登录会话、`ZynnTaskApiClient` 和 `ZynnTransferDispatcher`。
- 传输服务：由本机已登录客户端的本地传输进程提供（`ws://127.0.0.1:<TRANSFER_WS_PORT>`）。
- 若同时运行其他资产管理客户端（如 Alienbrain Designer Client），其当前窗口可能打开其他项目，不得把其当前目录当作 TX 的服务器查询范围。
- 旧导出的 JPG 清单副本（`manifest.csv`）不是服务器实时清单，不应据此判定最新缺失，也不默认重新导出它。

## 只读服务器记录

当前管线 API 基址由外部辅助模块管理（`<INTERNAL_TASKAPI_BASE_URL>`）。沿用安装客户端的会话和原有传输通道；不在技能内保存凭据，不改变其通讯配置。

- `/project/fetchListByEnName`：按英文项目名获取对应 `<PROJECT_ID>`。
- `/projectFileDir/getByPathAndProjectId`：查询 `projectId=<PROJECT_ID>, path=Assets` 获取根目录 `<ROOT_DIR_ID>`。
- `/projectFileDir/prlist`：指定项目和父目录 ID，只返回直接子目录。根目录与类别 ID 不能直接代表递归全部文件。
- `/projectFile/listPageByDirIds`：`projectId, dirIdList, pageNum, pageSize`，按返回 `total` 完整分页。
- 文件记录的 `packageName` 是项目内路径，例 `Assets/Character/LuYin/Design/LuYin.jpg`。
- `file` 包含 `fileId, serverPath, urlPath, size, mtime`；`mtime` 沿用客户端秒单位。仅明确命名的 `md5`/`sha256` 字段作为内容校验，不猜测 `fileId` 就是哈希。
- 删除记录跳过；路径越界、重复路径内容冲突、分页重复或空页未达到 `total` 应停止并保留诊断。

## 原生下载与记录

向传输客户端发送既有 `addDownFile` 指令，传递 `id, localPath, serverPath, serverCode, size, mtime`。`localPath` 必须是本次暂存文件；校验完成后原子替换符合更新条件的目标旧图，不保留旧图副本，不调用视频更新器主流程（其规则跳过缺失视频，与本技能不同）。

每次运行记录：

- `server_directories.json`、`server_records.json`：本次服务器目录及美术图片记录，无会话凭据。
- `local_before.json`、`local_after.json`：目标原有全部文件的路径、大小与纳秒修改时间。
- `plan.json`：`missing`、`existing`、`needs_update`、`local_newer` 四类。
- `created.json`：实际新增文件、SHA-256、图片尺寸和来源。
- `updated.json`：实际替换的旧图及替换后 SHA-256；`updated_before.json` 仅含旧图哈希、大小、时间，不保存旧图内容。
- `summary.json`、`report.md`：结果与边界；相同元数据仅表示没有检测到元数据差异。
- `error.json`、`pending.json`：出现故障时记录原因与未到齐列表。
- `rollback_preview.json` 或 `rollback_applied.json`：新增文件的撤销结果；替换图保留新版，因为未保存旧图副本。

目录或 API 发生变更时，根据当前客户端和本地辅助模块修正映射并运行测试；不要凭旧 ID 访问其他项目。

## 当前默认规则

服务器有新版时直接更新本地旧图，不保留旧图片副本。默认 `--apply` 执行补齐和覆盖；只有本地文件时间更新时跳过降级。历史运行记录继续遵守当次模式，新的运行使用 `update_newer`。
