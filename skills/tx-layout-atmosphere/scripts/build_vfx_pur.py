"""Lay out reviewed story beats, Layout stills, and animated references in PureRef."""
import argparse
from hashlib import sha256
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import quote

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageOps

from vfx_gif_cache import CACHE, LIBRARY, PROFILE, encode_gif, gif_info
from vfx_reference_id import public_id

BG, INK, MUTED, BLUE, AMBER = '#14202b', '#eaf2fa', '#b2c3d1', '#9edbff', '#ffd598'


def font(n):
    return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', n)


def wrapped(d, txt, x, y, width, size=20, color=INK):
    f = font(size)
    lines = []
    for paragraph in str(txt).splitlines():
        line = ''
        for c in paragraph:
            if line and d.textlength(line + c, font=f) > width:
                lines.append(line)
                line = ''
            line += c
        lines.append(line)
    for line in lines:
        d.text((x, y), line, font=f, fill=color)
        y += size + 8
    return y


def panel(w, h):
    im = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((1, 1, w - 2, h - 2), radius=12, outline='#334b61', width=2)
    return im, d


def note(path, row, number, clip):
    im, d = panel(486, 274)
    d.text((19, 13), f'{number:02d}   {row["shot"]}', font=font(19), fill=BLUE)
    y = wrapped(d, row['beat'], 19, 42, 448, 25)
    y = wrapped(d, row['note'], 19, y + 8, 448, 19)
    if clip:
        s = f'{clip["id"]}  ·  源 {clip["start"]:.2f}–{clip["end"]:.2f}s  ·  候选'
        y = wrapped(d, s, 19, y + 7, 448, 17, AMBER)
    if y > 272:
        raise ValueError(f'Note too long: {row["shot"]}; shorten it for the canvas')
    im.save(path)


def layouts(path, items):
    im, d = panel(645, 274)
    if not items:
        d.text((28, 112), 'Layout 待补 · 不代造镜头', fill=MUTED, font=font(23))
    else:
        if len(items) > 3:
            raise ValueError('Keep at most three Layout screenshots per beat')
        w = (615 - (len(items) - 1) * 9) // len(items)
        for i, item in enumerate(items):
            x = 15 + (w + 9) * i
            d.text((x, 10), item['label'], font=font(16), fill=BLUE)
            with Image.open(item['image']) as original:
                f = ImageOps.contain(original.convert('RGB'), (w, 229), Image.Resampling.LANCZOS)
            im.paste(f, (x + (w - f.width) // 2, 34 + (229 - f.height) // 2))
    im.save(path)


def pure_run(exe, settings, commands):
    args = [str(exe), '-s', str(settings)]
    for c in commands:
        args.extend(('-c', c))
    r = subprocess.run(args, capture_output=True, timeout=60,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    record = {'command': args, 'exit': r.returncode,
              'stdout': r.stdout.decode('utf-8', errors='replace'),
              'stderr': r.stderr.decode('utf-8', errors='replace')}
    if r.returncode:
        raise RuntimeError(record)
    return record


def source_uri(s):
    return Path(s).resolve().as_uri()


def resolve_pureref(explicit):
    if explicit:
        return explicit.expanduser().resolve()
    env = os.environ.get('PUREREF_EXE')
    if env:
        return Path(env).expanduser().resolve()
    exe = shutil.which('PureRef.exe') or shutil.which('PureRef')
    if exe:
        return Path(exe)
    roots = [Path(os.environ.get('ProgramFiles', 'C:/Program Files')),
             Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Programs']
    return next((p for root in roots for p in sorted(root.glob('PureRef*/PureRef.exe'), reverse=True)
                 if p.is_file()), None)


def local_path(value, parent):
    path = Path(value).expanduser()
    return (path if path.is_absolute() else parent / path).resolve()


def clip_seconds(src):
    reader = imageio_ffmpeg.read_frames(str(src))
    try:
        return float(next(reader)['duration'])
    finally:
        reader.close()


def preview_name(folder, clip):
    return quote(folder.name) + '/' + quote(clip['file'])


def markdown(m, rows, gif_folder):
    lines = [f'# {m["title"]}', '', m['summary'], '',
             '独立 GIF 与板内 GIF 是同一选段；颜色、声音和逐帧细节以原视频为准。', '']
    for row, clip in rows:
        lines.extend([f'## {row["shot"]}｜{row["beat"]}', '', row['note'], ''])
        for p in row.get('layouts', []):
            lines.append(f'- [{p["label"]}]({source_uri(p["image"])})')
        if clip:
            lines.append(f'- 候选 {clip["id"]} · 源 {clip["start"]:.2f}–{clip["end"]:.2f}s：'
                         f'[播放 GIF]({preview_name(gif_folder, clip)}) · '
                         f'[打开原视频]({source_uri(clip["source"])})')
        else:
            lines.append('- 本拍无匹配动态参考，待补。')
        lines.append('')
    return '\n'.join(lines) + '\n'


def gallery(spec, rows, gif_folder, pur, notes):
    esc = escape
    title = esc(spec['title'])
    parts = ['<!doctype html><html lang="zh-CN"><meta charset="utf-8">',
             f'<title>{title}</title>',
             '<style>body{background:#14202b;color:#eaf2fa;font:16px/1.65 system-ui;margin:2rem}'
             'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:1rem}'
             'article{border:1px solid #334b61;border-radius:10px;padding:1rem}'
             'img{display:block;max-width:100%;height:auto;margin-top:.6rem}a{color:#9edbff}</style>',
             f'<h1>{title}</h1><p>{esc(spec["summary"])}</p>',
             f'<p><a href="{quote(pur.name)}">PureRef 原生文件</a> · '
             f'<a href="{quote(notes.name)}">说明与原片秒段</a></p><main>']
    for row, clip in rows:
        parts.append(f'<article><h2>{esc(row["shot"])}｜{esc(row["beat"])}</h2>'
                     f'<p>{esc(row["note"])}</p>')
        if clip:
            gif = preview_name(gif_folder, clip)
            parts.append(f'<img loading="lazy" src="{gif}" alt="循环特效参考">'
                         f'<p>{esc(clip["id"])} · {clip["start"]:.2f}–{clip["end"]:.2f}s · '
                         f'<a href="{gif}">独立 GIF</a> · '
                         f'<a href="{esc(source_uri(clip["source"]))}">原视频</a></p>')
        else:
            parts.append('<p>动态参考待补。</p>')
        parts.append('</article>')
    return '\n'.join([*parts, '</main></html>']) + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('manifest', type=Path)
    p.add_argument('--pureref', type=Path, help='PureRef 2.x executable (or PUREREF_EXE / PATH)')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cache', type=Path, default=CACHE)
    p.add_argument('--library-index', type=Path, default=LIBRARY / 'index.json')
    a = p.parse_args()
    manifest = a.manifest.resolve()
    spec = json.loads(manifest.read_text(encoding='utf-8-sig'))
    output = a.output.resolve()
    sheet = output.with_name(output.stem + '_总览.png')
    notes = output.with_name(output.stem + '_说明.md')
    evidence = output.with_name(output.stem + '_验证.json')
    webpage = output.with_name(output.stem + '_浏览.html')
    gifs = output.with_name(output.stem + '_GIF')
    exe = resolve_pureref(a.pureref)
    if not exe or not exe.is_file():
        p.error('PureRef 2.x is required; set --pureref or PUREREF_EXE')
    if (output.suffix.lower() != '.pur'
            or any(f.exists() for f in (output, sheet, notes, evidence, webpage, gifs))
            or not 1 <= len(spec['rows']) <= 15 or not any(row.get('reference') for row in spec['rows'])):
        p.error('Require 1..15 rows, at least one animated reference, and all-new output paths')
    for row in spec['rows']:
        for item in row.get('layouts', []):
            item['image'] = str(local_path(item['image'], manifest.parent))
    output.parent.mkdir(parents=True, exist_ok=True)
    cache = a.cache.resolve()
    index = cache / 'index.json'
    local = json.loads(index.read_text(encoding='utf-8'))['items'] if index.is_file() else {}
    needs_index = any(row.get('reference') and not row['reference'].get('source') for row in spec['rows'])
    db = ({x['id']: x for x in json.loads(a.library_index.read_text(encoding='utf-8-sig'))}
          if needs_index else {})
    logs, record = [], []
    with tempfile.TemporaryDirectory(prefix='tx-pureref-') as work:
        work = Path(work)
        media = work / 'assets'
        media.mkdir()
        settings = work / 'isolated.ini'  # separate from any open PureRef session
        head, draw = panel(1750, 142)
        draw.text((24, 12), spec['title'], font=font(35), fill=INK)
        wrapped(draw, spec['summary'], 26, 61, 1690, 19, MUTED)
        draw.text((28, 110), '叙事阶段与借用层                    Layout 画面                     GIF 动态参考｜选中可查看播放控制',
                  font=font(18), fill=BLUE)
        headfile = media / 'header.png'
        head.save(headfile)
        def load(f, x, y):
            if ';' in str(f):
                raise ValueError('Semicolon in PureRef command path')
            return f'load;{f.as_posix()};{x};{y}'
        commands = [load(headfile, 875, 71)]
        for i, row in enumerate(spec['rows'], 1):
            gif = None
            request = row.get('reference')
            if request:
                lookup_id = request['id']
                if not re.fullmatch(r'[A-Za-z0-9_-]+', lookup_id):
                    raise ValueError('Reference ID must be a simple file-safe identifier')
                id = public_id(lookup_id)
                direct = bool(request.get('source'))
                src = (local_path(request['source'], manifest.parent) if direct
                       else Path(db[lookup_id]['full_path']))
                if not src.is_file():
                    raise FileNotFoundError(src)
                cached = local.get(lookup_id, {})
                gif = media / f'{i:02d}_{id}.gif'
                if (not direct and 'start' not in request and 'seconds' not in request
                        and cached.get('source') == str(src)):
                    src_gif = cache / Path(cached['gif']).name
                    shutil.copyfile(src_gif, gif)
                    info = gif_info(gif)
                    start = cached['source_start_s']; duration = cached['preview_duration_s']
                    mode = 'local cache'
                else:
                    if direct and not {'start', 'seconds'} <= request.keys():
                        raise ValueError(f'{id}: direct source needs reviewed start and seconds')
                    start = float(request.get('start', 0))
                    length = clip_seconds(src) if direct else float(db[lookup_id]['video_info']['duration_sec'])
                    duration = float(request.get('seconds', min(PROFILE['max_seconds'], length - start)))
                    if (start < 0 or not 0 < duration <= PROFILE['max_seconds']
                            or start + duration > length + 0.08):
                        raise ValueError(f'{id} segment outside source')
                    info = encode_gif(src, gif, start, duration, PROFILE['width'], PROFILE['fps'], PROFILE['colors'])
                    mode = 'selected source segment'
                with Image.open(gif) as loop_check:
                    if loop_check.info.get('loop') != 0:
                        raise ValueError(f'{id} preview must loop')
                clip = {'id': id, 'source': str(src), 'start': start, 'end': start + duration,
                        'mode': mode, 'file': gif.name, 'sha256': sha256(gif.read_bytes()).hexdigest(), **info}
            else:
                clip = None
            record.append((row, clip))
            f1, f2 = media / f'{i:02d}_notes.png', media / f'{i:02d}_layout.png'
            note(f1, row, i, clip)
            layouts(f2, row.get('layouts', []))
            y = 160 + 137 + 294 * (i - 1)
            commands.extend([load(f1, 243, y), load(f2, 829, y)])
            if gif:
                commands.append(load(gif, 1468, y))
            else:
                im, d = panel(480, 274)
                d.text((27, 108), '延续前镜 / 本拍无新增特效', fill=MUTED, font=font(22))
                f3 = media / f'{i:02d}_hold.png'
                im.save(f3)
                commands.append(load(f3, 1468, y))
        staging = work / 'scene.pur'
        logs.append(pure_run(exe, settings, [*commands, f'save;{staging.as_posix()}', 'exit']))
        assert staging.is_file() and staging.stat().st_size > 1024
        # Rename the entire staging source directory before reopening, so a link-only scene cannot pass.
        media.rename(work / 'detached')
        preview = work / 'reopened.png'
        logs.append(pure_run(exe, settings, [f'load;{staging.as_posix()}',
                             f'exportScene;{preview.as_posix()};-1;-1;false;false', 'exit']))
        with Image.open(preview) as exported:
            im = exported.convert('RGB')
            assert im.width >= 1700 and im.height >= 250 * len(spec['rows'])
            for i, (_, clip) in enumerate(record, 1):
                if clip:
                    gif = work / 'detached' / clip['file']
                    with Image.open(gif) as original:
                        rgb = original.convert('RGB'); w,h = rgb.size
                    cx,cy=1468,297+294*(i-1)
                    # Native scene export uses the center coordinates; a tiny offset may come from rounding.
                    src_pixel = rgb.getpixel((w//2,h//2))
                    matches = [im.getpixel((cx+dx,cy+dy)) for dx,dy in ((0,0),(-1,0),(0,-1),(-1,-1))]
                    if not any(sum(abs(a-b) for a,b in zip(pixel, src_pixel)) < 36 for pixel in matches):
                        raise ValueError(f'Embedded reference not visible at expected position: {clip["id"]}')
            size = im.size
        for a_src, a_dst in ((staging, output), (preview, sheet)):
            with a_dst.open('xb') as handle, a_src.open('rb') as data:
                shutil.copyfileobj(data, handle)
        gifs.mkdir()
        for _, clip in record:
            if clip:
                target = gifs / clip['file']
                shutil.copyfile(work / 'detached' / clip['file'], target)
                assert gif_info(target)['frames'] == clip['frames']
                assert sha256(target.read_bytes()).hexdigest() == clip['sha256']
    notes.write_text(markdown(spec, record, gifs), encoding='utf-8')
    webpage.write_text(gallery(spec, record, gifs, output, notes), encoding='utf-8')
    evidence.write_text(json.dumps({'canvas': size, 'items': len(spec['rows']), 'reopened_without_sources': True,
                                   'gifs': [c for _, c in record if c], 'native_commands': logs},
                                  ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'pur': str(output), 'gif_directory': str(gifs), 'browse': str(webpage),
                      'notes': str(notes), 'verification': str(evidence),
                      'bytes': output.stat().st_size, 'canvas': size,
                      'rows': len(spec['rows']), 'animated_gifs': sum(c is not None for _, c in record),
                      'reopened_without_sources': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
