"""Acquire only explicitly selected media and make verified archival derivatives."""

import ipaddress
from pathlib import Path
import shutil
import socket
import subprocess
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

LIMIT = 256 * 1024 * 1024


def public_https(url):
    p = urlsplit(url)
    if (p.scheme != 'https' or not p.hostname or p.username or p.password
            or p.port not in (None, 443)):
        raise ValueError('下载仅接受公开 HTTPS 原文件地址')
    addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('下载地址必须位于公网')


class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, folder):
    public_https(url)
    opener = build_opener(ProxyHandler({}), PublicRedirect())
    req = Request(url, headers={'User-Agent': 'CreativeReferenceSearch/1.0',
                                'Accept': 'video/*, image/*, application/octet-stream'})
    path = folder / 'downloaded.source'
    deadline = time.monotonic() + 180
    with opener.open(req, timeout=20) as resp:
        mime = resp.headers.get_content_type()
        if not mime.startswith(('image/', 'video/')) and mime != 'application/octet-stream':
            raise ValueError('地址返回的不是直接媒体文件')
        size = resp.headers.get('Content-Length')
        if size and int(size) > LIMIT:
            raise ValueError('原文件超过 256 MiB，请改用已核对的本地短片')
        with path.open('xb') as file:
            total = 0
            while block := resp.read(1024 * 1024):
                total += len(block)
                if total > LIMIT or time.monotonic() > deadline:
                    raise ValueError('下载超过大小或时间上限')
                file.write(block)
        if not total or size and total != int(size):
            raise ValueError('下载不完整')
    return path


def ffmpeg(*args):
    exe = shutil.which('ffmpeg')
    if not exe:
        try:
            import imageio_ffmpeg
        except ImportError:
            raise ValueError('视频转码需要本机 FFmpeg') from None
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [exe, '-hide_banner', '-v', 'error', '-nostdin', '-n', *map(str, args)]
    result = subprocess.run(cmd, capture_output=True, timeout=150,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip()
                           or 'FFmpeg 处理失败')


def video_input(path):
    return ['-protocol_whitelist', 'file', '-format_whitelist',
            'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,mpegts,avi,flv,gif,apng,mpeg,ogg',
            '-i', path]


def archive_media(source, folder, kind, segment, still_gif=False):
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise ValueError('入库前需要本机图片处理组件 Pillow') from None

    def inspect(path, expected):
        with Image.open(path) as im:
            if im.format != expected:
                raise ValueError('输出文件格式不符')
            dimensions = {'width': im.width, 'height': im.height}
            im.load()
            return dimensions

    if kind == 'image':
        formats = {'PNG': '.png', 'JPEG': '.jpg', 'WEBP': '.webp', 'BMP': '.bmp',
                   'TIFF': '.tif', 'GIF': '.gif', 'AVIF': '.avif'}
        with Image.open(source) as im:
            if im.format not in formats or getattr(im, 'n_frames', 1) != 1:
                raise ValueError('静态图支持常见图片格式；动态原件请选择视频/动图类型')
            suffix = formats[im.format]
            original = 'original' + suffix
            im.load()
            shutil.copyfile(source, folder / original)
            fixed = ImageOps.exif_transpose(im)
            fixed.convert('RGBA' if 'A' in fixed.getbands() or 'transparency' in im.info
                          else 'RGB').save(folder / 'frame-01.png',
                                           icc_profile=im.info.get('icc_profile'))
            output = {'original': original, 'frames': ['frame-01.png'],
                      'size': inspect(folder / 'frame-01.png', 'PNG')}
            if still_gif:
                preview = fixed.convert('RGBA')
                preview.thumbnail((1080, 1080), Image.Resampling.LANCZOS)
                preview.save(folder / 'preview.gif')
                output.update(gif='preview.gif', gif_size=inspect(folder / 'preview.gif', 'GIF'))
            return output

    if kind != 'video':
        raise ValueError('字体、UI、文字资源第一版先收藏链接；预览图可按图片候选登记')
    start, end = segment
    seconds = end - start
    if not .5 <= seconds <= 15:
        raise ValueError('请选 0.5–15 秒的短片段，通常 2–5 秒')
    clip = folder / 'clip.mkv'
    ffmpeg('-ss', f'{start:.4f}', *video_input(source), '-t', f'{seconds:.4f}',
           '-map', '0:v:0', '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '2', clip)
    # Look near the requested end to reject source clips that ended too early.
    end_check = folder / '.end-check.png'
    ffmpeg('-ss', f'{max(0, seconds - .15):.4f}', *video_input(clip),
           '-frames:v', '1', '-threads', '1', end_check)
    if not end_check.is_file():
        raise ValueError('原视频早于所选结束时间，请缩短秒段')
    end_check.unlink()
    frames = []
    for i, fraction in enumerate((.10, .50, .80), 1):
        name = f'frame-{i:02d}.png'
        ffmpeg('-ss', f'{seconds * fraction:.4f}', *video_input(clip),
               '-frames:v', '1', '-threads', '1', folder / name)
        inspect(folder / name, 'PNG')
        frames.append(name)
    gif = folder / 'preview.gif'
    filters = (
        "fps=20,scale='if(gte(iw,ih),min(1080,iw),-1)':'if(gte(iw,ih),-1,min(1080,ih))':"
        "flags=lanczos,split[a][b];"
        "[a]palettegen=max_colors=256:reserve_transparent=0:stats_mode=full[p];"
        "[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle"
    )
    ffmpeg(*video_input(clip), '-filter_threads', '1', '-filter_complex_threads', '1',
           '-vf', filters, '-loop', '0', gif)
    with Image.open(gif) as im:
        if im.format != 'GIF' or im.n_frames < 2:
            raise ValueError('该秒段没有可用动态，请选其他秒段或保存静帧')
        im.seek(im.n_frames - 1)
        im.load()
        dimensions = {'width': im.width, 'height': im.height, 'frames': im.n_frames}
    return {'clip': clip.name, 'gif': gif.name, 'frames': frames, 'gif_size': dimensions,
            'size': inspect(folder / frames[0], 'PNG')}
