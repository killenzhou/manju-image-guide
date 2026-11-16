"""Build local, bounded GIF previews without changing the VFX library masters."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import re
import subprocess
import time

from PIL import Image
import imageio_ffmpeg

LIBRARY = Path.home() / '.gemini/config/skills/ue-efx-library'
CACHE = Path('E:/VFX_Reference_Library/GIF/EFX_Library')
PROFILE = {'width': 480, 'fps': 12, 'max_seconds': 3.5, 'colors': 96, 'revision': 1}


def gif_info(path):
    with Image.open(path) as im:
        if im.format != 'GIF' or im.n_frames < 2:
            raise ValueError(f'Not an animated GIF: {path}')
        for i in {0, im.n_frames - 1}:
            im.seek(i)
            im.load()
        return {'width': im.width, 'height': im.height, 'frames': im.n_frames,
                'bytes': path.stat().st_size}


def encode_gif(source, output, start, seconds, width=480, fps=12, colors=96):
    if not 0 <= start or not 0 < seconds <= 15:
        raise ValueError('Invalid GIF segment')
    vf = (f"fps={fps},scale='min({width},iw)':-2:flags=lanczos,split[a][b];"
          f'[a]palettegen=max_colors={colors}:stats_mode=diff[p];'
          '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle')
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-nostdin', '-y',
           '-threads', '2', '-ss', f'{start:.4f}', '-t', f'{seconds:.4f}',
           '-i', str(source), '-map', '0:v:0', '-an', '-filter_complex_threads', '1',
           '-filter_threads', '1', '-vf', vf, '-loop', '0', str(output)]
    t = time.perf_counter()
    result = subprocess.run(cmd, capture_output=True, timeout=90,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip() or result.returncode)
    return {**gif_info(output), 'encode_seconds': round(time.perf_counter() - t, 3)}


def atomic_json(path, data):
    tmp = path.with_suffix(f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--library-index', type=Path, default=LIBRARY / 'index.json')
    p.add_argument('--cache', type=Path, default=CACHE)
    p.add_argument('--workers', type=int, default=6)
    p.add_argument('--ids', nargs='+', help='Only warm these IDs; omitted means all indexed items')
    a = p.parse_args()
    if not 1 <= a.workers <= 12:
        p.error('--workers must be in 1..12')
    db = {x['id']: x for x in json.loads(a.library_index.read_text(encoding='utf-8-sig'))}
    ids = list(dict.fromkeys(a.ids)) if a.ids else list(db)
    if any(i not in db or not re.fullmatch(r'efx_\d{4}', i) for i in ids):
        p.error('Unknown or invalid EFX ID')
    cache = a.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    index = cache / 'index.json'
    old = json.loads(index.read_text(encoding='utf-8')) if index.is_file() else {}
    results = old.get('items', {}) if old.get('profile') == PROFILE else {}
    t0 = time.perf_counter()

    def work(i):
        x = db[i]
        source = Path(x['full_path'])
        info = x['video_info']
        length = float(info['duration_sec'])
        duration = min(length, PROFILE['max_seconds'])
        start = max(0., (length - duration) / 2)
        key = [str(source), x.get('size_bytes'), x.get('mtime'), start, duration]
        final = cache / (i + '.gif')
        existing = results.get(i, {})
        if existing.get('fingerprint') == key and final.is_file():
            try:
                return i, {**existing, **gif_info(final)}, 'reused'
            except (ValueError, OSError):
                pass
        temporary = cache / f'.{i}.{os.getpid()}.gif'
        try:
            if not source.is_file():
                raise FileNotFoundError(str(source))
            enc = encode_gif(source, temporary, start, duration, PROFILE['width'],
                             PROFILE['fps'], PROFILE['colors'])
            temporary.replace(final)
            caption = x.get('vfx_caption') or {}
            return i, {**enc, 'gif': final.name, 'source': str(source),
                       'source_duration_s': length, 'source_start_s': round(start, 3),
                       'preview_duration_s': round(duration, 3), 'fingerprint': key,
                       'category': caption.get('category'), 'description': caption.get('description'),
                       'tags': caption.get('tags', [])}, 'encoded'
        finally:
            temporary.unlink(missing_ok=True)

    count = {'encoded': 0, 'reused': 0}
    failed = {}
    with ThreadPoolExecutor(a.workers) as pool:
        futures = {pool.submit(work, i): i for i in ids}
        for n, f in enumerate(as_completed(futures), 1):
            try:
                i, item, mode = f.result()
                results[i] = item
                count[mode] += 1
            except Exception as ex:
                i = futures[f]
                results.pop(i, None)
                failed[i] = str(ex)
            if n % 25 == 0 or n == len(ids):
                print(f'{n}/{len(ids)}: encoded={count["encoded"]} reused={count["reused"]} failed={len(failed)}', flush=True)
    results = dict(sorted((i, item) for i, item in results.items() if i in db))
    atomic_json(index, {'profile': PROFILE, 'library_index': str(a.library_index.resolve()),
                        'items': results})
    report = {'requested': len(ids), **count, 'failed': failed, 'total_cached': len(results),
              'total_gif_bytes': sum(x['bytes'] for x in results.values()),
              'wall_seconds': round(time.perf_counter() - t0, 3), 'cache': str(cache)}
    atomic_json(cache / 'last-run.json', report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
