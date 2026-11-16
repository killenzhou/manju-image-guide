"""DaVinci Resolve 环境连接与上下文工具库
支持外部独立 Python 进程或 Resolve 内部 / MCP 运行环境。
"""

import sys
import os

def get_resolve_context():
    """获取 DaVinci Resolve 当前上下文: resolve, project_manager, project, timeline."""
    resolve = globals().get("resolve")
    if resolve is None:
        try:
            import DaVinciResolveScript as dvr
            resolve = dvr.scriptapp("Resolve")
        except ImportError:
            paths = [
                r"C:\Program Files\Blackmagic Design\DaVinci Resolve\Developer\Scripting\Modules",
                r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules"
            ]
            for p in paths:
                if os.path.exists(p) and p not in sys.path:
                    sys.path.append(p)
            try:
                import DaVinciResolveScript as dvr
                resolve = dvr.scriptapp("Resolve")
            except Exception as e:
                raise RuntimeError(f"无法连接 DaVinci Resolve Scripting API: {e}")

    if not resolve:
        raise RuntimeError("DaVinci Resolve 未运行或无法获取 ScriptApp 实例。")

    pm = resolve.GetProjectManager()
    if not pm:
        raise RuntimeError("无法获取 ProjectManager。")

    proj = pm.GetCurrentProject()
    if not proj:
        raise RuntimeError("当前未打开任何 Resolve 工程。")

    timeline = proj.GetCurrentTimeline()
    return {
        "resolve": resolve,
        "pm": pm,
        "project": proj,
        "timeline": timeline
    }

if __name__ == "__main__":
    ctx = get_resolve_context()
    tl_name = ctx["timeline"].GetName() if ctx["timeline"] else "None"
    print(f"成功连接 DaVinci Resolve!")
    print(f"当前项目: {ctx['project'].GetName()}")
    print(f"当前时间线: {tl_name}")
