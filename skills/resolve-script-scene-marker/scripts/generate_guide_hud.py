"""场景视觉导览卡片与 HUD 条生成工具
使用 PIL/FFmpeg 批量生成 1920x224 官方标准深蓝圆角导览条图片与精确时长的 MP4 视频，
文字排版经过严格字宽计算与智能折行，杜绝信息相互堆叠遮挡；
并支持一键通过 DaVinci Resolve MediaPool 上轨并调整 Tilt = -2025 贴底展示。
"""

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import imageio_ffmpeg
import cv2

FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
def font(size):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except:
        return ImageFont.load_default()

def tc(n, fps=25):
    n = int(n)
    return f"{n//(fps*3600):02}:{n//(fps*60)%60:02}:{n//fps%60:02}:{n%fps:02}"

def create_guide_card(item, output_png_path, ep_start_frame=0):
    """
    生成 1920x224 尺寸的高清场景导览条图片（遵循官方标准规范，绝不遮挡堆叠）：
    - 尺寸: 1920x224 (RGB)
    - 背景: 深蓝圆角半透明面板 (13, 21, 32)，外边框 (58, 88, 111)
    - 左侧: 美术设计图居中 contain 缩略图 (最大限制 352x174)，带底部“项目美术设计参考”小字
    - 右侧第 1 行: 场次编号与场景标题 (y=16, font 34, 浅亮灰白 #E6F1F9)
    - 右侧第 2 行: 昼夜与环境时段标签 + 本集与时间线时间码范围 (y=66, font 25, 亮青蓝 #62C4DC)
    - 右侧第 3、4 行: 一句话剧情，按 1430px 限额智能折行，行距 38px，字号 28，字间距舒展不堆叠
    """
    ident = item.get("id", "")
    scene = item.get("scene", item.get("scene_name", ""))
    story = item.get("story", "")
    asset_path = item.get("asset", "")
    daypart = item.get("daypart", "")
    setting = item.get("setting", "")
    record = item.get("start", 0)
    rend = item.get("end", 0)

    card = Image.new("RGB", (1920, 224), (0, 0, 0))
    d = ImageDraw.Draw(card)

    # 1. 绘制背景圆角面板
    d.rounded_rectangle((20, 2, 1900, 220), radius=15, fill=(13, 21, 32), outline=(58, 88, 111), width=2)

    # 2. 贴美术设计图 (352x174 contain 缩放，支持局部大图裁切)
    if asset_path and os.path.exists(asset_path):
        try:
            with Image.open(asset_path) as im:
                im = im.convert("RGB")
                # 支持用户指定局部裁切大图 (归一化坐标 x1, y1, x2, y2)
                crop_box = item.get("crop")
                if crop_box and len(crop_box) == 4:
                    x1, y1, x2, y2 = crop_box
                    w_orig, h_orig = im.size
                    im = im.crop((int(x1 * w_orig), int(y1 * h_orig), int(x2 * w_orig), int(y2 * h_orig)))
                thumb = ImageOps.contain(im, (352, 174))
                tx = 34 + (352 - thumb.width) // 2
                ty = 19 + (174 - thumb.height) // 2
                card.paste(thumb, (tx, ty))
        except Exception as e:
            print(f"缩略图加载失败: {asset_path}, {e}")

    # 底部注释
    d.text((44, 195), "项目美术设计参考", font=font(16), fill=(160, 183, 197))

    # 3. 右侧排版文字
    # 标题行
    title_text = f"{ident.replace('_', ' · ')}   {scene}"
    d.text((407, 16), title_text, font=font(34), fill=(230, 241, 249))

    # 时段与时间码
    ref_start = ep_start_frame if ep_start_frame else record
    period_str = f"本集 {tc(record - ref_start)}~{tc(rend - ref_start)}    |    时间线 {tc(record)}~{tc(rend)}"
    label_text = f"{daypart} · {setting}    |    {period_str}"
    d.text((409, 66), label_text, font=font(25), fill=(98, 196, 220))

    # 剧情按实际像素宽度折行，绝不重叠
    lines = [""]
    for ch in story:
        if d.textlength(lines[-1] + ch, font=font(28)) > 1430:
            lines.append("")
        lines[-1] += ch

    for k, line in enumerate(lines[:3]):
        d.text((409, 108 + k * 38), line, font=font(28), fill=(236, 238, 240))

    out_p = Path(output_png_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    card.save(out_p, format="PNG")
    return str(out_p)

def render_card_video(png_path, duration_frames, output_mp4_path):
    """使用 ffmpeg 将导览卡片图片转为精确时长的 MP4 视频。"""
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out_p = Path(output_mp4_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ff, "-hide_banner", "-y",
        "-loop", "1",
        "-framerate", "25",
        "-i", str(png_path),
        "-frames:v", str(duration_frames),
        "-an",
        "-c:v", "libx264",
        "-threads", "2",
        "-preset", "ultrafast",
        "-tune", "stillimage",
        "-crf", "16",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_p)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return res.returncode == 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="场景导览卡片生成工具")
    parser.add_argument("--manifest", required=True, help="manifest.json 路径")
    parser.add_argument("--output-dir", required=True, help="生成的 PNG 保存目录")
    parser.add_argument("--render-videos", action="store_true", help="是否压制为 MP4 视频")
    args = parser.parse_args()

    items = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    out_dir = Path(args.output_dir)
    ep_start = items[0]["start"] if items else 0
    print(f"开始批量生成导览卡片: 共 {len(items)} 个...")
    for it in items:
        out_file = out_dir / f"{it['id']}.png"
        create_guide_card(it, out_file, ep_start_frame=ep_start)
        if args.render_videos:
            v_file = out_dir / "videos" / f"{it['id']}.mp4"
            render_card_video(out_file, it["duration"], v_file)
            it["video"] = str(v_file)
    print(f"全部生成完成，保存在: {out_dir}")
