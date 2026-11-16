"""Extract evidenced active Layout frames and verify/publish full-frame shot PNGs."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess

from PIL import Image


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as f:
        f.write(data)


def publish_files(path, image, report):
    if path.suffix.lower() != '.png':
        raise ValueError('Output must be .png')
    evidence = path.with_suffix('.qa.json')
    if path.exists() or evidence.exists():
        raise FileExistsError('Choose a new output version: ' + str(path))
    opts = {k: image.info[k] for k in ('icc_profile',) if k in image.info}
    with io.BytesIO() as b:
        image.save(b, format='PNG', **opts)
        raw = b.getvalue()
    with Image.open(io.BytesIO(raw)) as check:
        assert check.format == 'PNG' and check.size == image.size
        check.verify()
    write_new(path, raw)
    with Image.open(path) as check:
        check.load()
        assert check.format == 'PNG' and check.size == image.size
    report.update(output=str(path), size=list(image.size), sha256=digest(path))
    write_new(evidence, (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps(report, ensure_ascii=False))


def frame(a):
    if a.frame < 1:
        raise ValueError('Use a one-based source frame number')
    ff = a.ffmpeg or shutil.which('ffmpeg')
    if not ff:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    source = a.source.resolve(strict=True)
    args = [ff, '-v', 'error', '-nostdin', '-i', str(source), '-vf',
            f'select=eq(n\\,{a.frame - 1})', '-frames:v', '1',
            '-f', 'image2pipe', '-vcodec', 'png', '-']
    proc = subprocess.run(args, check=True, capture_output=True)
    if not proc.stdout:
        raise ValueError('Requested frame was not decoded')
    with Image.open(io.BytesIO(proc.stdout)) as full:
        full.load()
        w, h = full.size
        active = full.copy()
    rect = a.active_rect or [0, 0, w, h]
    x, y, aw, ah = rect
    if x < 0 or y < 0 or aw < 1 or ah < 1 or x + aw > w or y + ah > h:
        raise ValueError('Active rectangle lies outside the source frame')
    if a.active_rect:
        if not a.boundary_evidence or not a.boundary_evidence.strip():
            raise ValueError('Give observed overlay/matte boundary evidence before extraction')
        active = active.crop((x, y, x + aw, y + ah))
    publish_files(a.out.resolve(), active, {'kind': 'layout_frame', 'source': str(source),
                  'frame_one_based': a.frame, 'source_size': [w, h], 'active_rect_xywh': rect,
                  'boundary_evidence': a.boundary_evidence or 'Full decoded frame, no trimming'})


def load_brief(path):
    path = path.resolve(strict=True)
    b = json.loads(path.read_text(encoding='utf-8-sig'))
    if not re.fullmatch(r'Ep\d{3}_sc\d{3}_\d{3}[a-z]?', b.get('shot', ''), re.I):
        raise ValueError('Brief requires canonical shot ID, e.g. Ep003_sc006_069')
    if b.get('mode') not in ('new', 'edit'):
        raise ValueError('Brief mode must be new or edit')
    for key in ('beat', 'change', 'lighting', 'prompt'):
        if not isinstance(b.get(key), str) or not b[key].strip():
            raise ValueError(f'Brief missing {key}')
    locks = b.get('locks', {})
    for key in ('camera', 'frame', 'characters', 'scene', 'other'):
        if not isinstance(locks.get(key), str) or not locks[key].strip():
            raise ValueError(f'Brief missing locks.{key}')
    if not isinstance(b.get('references'), list):
        raise ValueError('Brief requires a references list (may be empty)')

    def resolve(value):
        f = Path(value).expanduser()
        return (f if f.is_absolute() else path.parent / f).resolve(strict=True)

    plate = resolve(b['plate'])
    with Image.open(plate) as image:
        image.load()
        dimensions = image.size
    refs = []
    for ref in b['references']:
        for key in ('role', 'borrow', 'exclude'):
            if not isinstance(ref.get(key), str) or not ref[key].strip():
                raise ValueError(f'Reference missing {key}')
        source = resolve(ref['file'])
        with Image.open(source) as image:
            image.verify()
        if ref['role'] == 'vfx_frame':
            if not ref.get('source') or not isinstance(ref.get('at_seconds'), (int, float)) or ref['at_seconds'] < 0:
                raise ValueError('VFX keyframes need their original source and seconds')
        refs.append(str(source))
    return {'brief': str(path), 'brief_sha256': digest(path), 'shot': b['shot'],
            'mode': b['mode'], 'plate': str(plate), 'plate_size': list(dimensions),
            'reference_files': refs}


def detected_matte(image):
    # Strict signal for a black flat strip with a visible interior transition.
    # Dark textured content and a single pixel row are not considered bars.
    w, h = image.size
    dark = []
    for edge, oriented in [('top', image), ('bottom', image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)),
                           ('left', image.transpose(Image.Transpose.ROTATE_270)),
                           ('right', image.transpose(Image.Transpose.ROTATE_90))]:
        ow, oh = oriented.size
        sample = oriented.convert('L').resize((min(ow, 384), oh))
        n = 0
        for y in range(min(oh // 5, max(64, oh // 12))):
            if sample.crop((0, y, sample.width, y + 1)).getextrema()[1] > 9:
                break
            n += 1
        if n >= max(4, round(min(w, h) * .006)):
            near = sample.crop((0, n, sample.width, min(oh, n + 6)))
            if near.getextrema()[1] >= 28:
                dark.append({'edge': edge, 'thickness_px': n})
    return dark


def publish(a):
    info = load_brief(a.brief)
    for label, value in [('renderer', a.renderer), ('visual review', a.review)]:
        if not value.strip():
            raise ValueError(f'Missing {label}')
    raw = a.raw.resolve(strict=True)
    if raw == Path(info['plate']):
        raise ValueError('Raw render and input plate must be separate')
    with Image.open(raw) as src:
        if src.format not in ('PNG', 'JPEG', 'WEBP'):
            raise ValueError('Raw render must be a supported still image')
        if 'A' in src.getbands() or 'transparency' in src.info:
            if src.convert('RGBA').getchannel('A').getextrema() != (255, 255):
                raise ValueError('Project delivery must be opaque and full-frame')
        im = src.convert('RGB')
        if src.info.get('icc_profile'):
            im.info['icc_profile'] = src.info['icc_profile']
    rw, rh = im.size
    pw, ph = info['plate_size']
    expected = round(3840 * ph / pw)
    target = (3840, round(3840 * rh / rw))
    if abs(expected - target[1]) > 2:
        raise ValueError(f'Aspect mismatch: plate expects ~3840x{expected}; raw scales to {target}. Re-render without cropping.')
    matte = detected_matte(im)
    if matte and not a.edge_evidence.strip():
        raise ValueError(f'Possible black matte {matte}; inspect the full frame before publishing.')
    method = 'native' if target == im.size else 'full-frame Lanczos resampling'
    out = im if target == im.size else im.resize(target, Image.Resampling.LANCZOS)
    publish_files(a.out.resolve(), out, {**info, 'kind': 'shot_render', 'renderer': a.renderer,
                  'visual_review': a.review, 'raw': str(raw), 'raw_size': [rw, rh],
                  'raw_sha256': digest(raw), 'expected_height_at_3840': expected,
                  'native_rounding_delta_px': target[1] - expected, 'resize': method,
                  'detected_matte': matte, 'edge_evidence': a.edge_evidence or None})


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('frame')
    f.add_argument('--source', type=Path, required=True)
    f.add_argument('--frame', type=int, required=True)
    f.add_argument('--active-rect', nargs=4, type=int, metavar=('X', 'Y', 'W', 'H'))
    f.add_argument('--boundary-evidence')
    f.add_argument('--ffmpeg')
    f.add_argument('--out', type=Path, required=True)
    b = sub.add_parser('check-brief')
    b.add_argument('--brief', type=Path, required=True)
    o = sub.add_parser('publish')
    o.add_argument('--brief', type=Path, required=True)
    o.add_argument('--raw', type=Path, required=True)
    o.add_argument('--out', type=Path, required=True)
    o.add_argument('--renderer', required=True)
    o.add_argument('--review', required=True, help='Actual visual comparison against the plate')
    o.add_argument('--edge-evidence', default='', help='Only for verified scene-darkness false positives, never real matte')
    a = p.parse_args()
    try:
        if a.command == 'frame':
            frame(a)
        elif a.command == 'check-brief':
            print(json.dumps(load_brief(a.brief), ensure_ascii=False))
        else:
            publish(a)
    except (ValueError, TypeError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        p.exit(2, f'{exc}\n')


if __name__ == '__main__':
    main()
