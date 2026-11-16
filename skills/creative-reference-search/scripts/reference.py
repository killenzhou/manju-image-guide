"""Build a portable reference board and maintain a file-based reference library."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from datetime import date
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SKILL = Path(__file__).resolve().parents[1]
WORKSPACE = SKILL.parents[2]
DEFAULT_LIBRARY = Path('Y:/TX/参考资料/镜头参考库')
KINDS = {'video', 'image', 'font', 'ui', 'text', 'link'}
METRICS = {'views': 1, 'likes': 3, 'comments': 1, 'saves': 3}
REF_ID = re.compile(r'TXREF-[0-9A-F]{12}')


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, data):
    with path.open('x', encoding='utf-8', newline='\n') as file:
        json.dump(data, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write('\n')


def checked_url(value, schemes=('https', 'http', 'file')):
    p = urlsplit(value)
    if p.scheme not in schemes or p.username or p.password or any(c.isspace() for c in value):
        raise ValueError(f'无效链接：{value}')
    if (p.scheme != 'file' and not p.hostname
            or p.scheme == 'file' and not p.path.startswith('/')):
        raise ValueError(f'无效链接：{value}')
    return value


def canonical(value):
    p = urlsplit(checked_url(value))
    host = p.hostname or ''
    if host.removeprefix('www.') == 'youtu.be':
        return 'youtube:' + p.path.strip('/').split('/')[0]
    if host in {'www.youtube.com', 'youtube.com', 'm.youtube.com'}:
        vid = dict(parse_qsl(p.query)).get('v') if p.path == '/watch' else None
        if not vid and p.path.startswith(('/shorts/', '/live/', '/embed/')):
            vid = p.path.split('/')[2]
        if vid:
            return 'youtube:' + vid
    if host in {'www.bilibili.com', 'bilibili.com', 'm.bilibili.com'}:
        match = re.match(r'/video/(BV[a-zA-Z0-9]+|av[0-9]+)', p.path)
        if match:
            part = dict(parse_qsl(p.query)).get('p', '1')
            return f'bilibili:{match[1]}:{part}'
    if p.scheme == 'file':
        return value.casefold() if sys.platform == 'win32' else value
    pairs = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in {'gclid', 'fbclid'}]
    return urlunsplit(('https', p.netloc.lower().removeprefix('www.'),
                       p.path.rstrip('/') or '/', urlencode(sorted(pairs)), ''))


def bounds(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('请给出起止秒数')
    start, end = (float(x) for x in value)
    if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end:
        raise ValueError('秒段必须满足 0 ≤ 开始 < 结束')
    return [round(start, 4), round(end, 4)]


def normalize(row):
    item = {k: str(row.get(k) or '').strip() for k in ('title', 'source', 'category', 'reason')}
    if not all(item.values()) or row.get('kind') not in KINDS:
        raise ValueError('候选需要标题、来源、类别、匹配理由与有效媒体类型')
    item['kind'] = row['kind']
    item['url'] = checked_url(row['url'])
    for key in ('match', 'value'):
        val = float(row[key])
        if not 0 <= val <= 100:
            raise ValueError(f'{key} 必须在 0–100')
        item[key] = val
    item['verified'] = row.get('verified', 'metadata')
    if item['verified'] not in {'media', 'metadata'}:
        raise ValueError('无效核对状态')
    segment = row.get('segment')
    if segment is not None and (item['kind'] != 'video' or item['verified'] != 'media'):
        raise ValueError('秒段须来自已实际核对的视频')
    item['segment'] = bounds(segment) if segment is not None else None
    item['preview'] = checked_url(row['preview'], ('https', 'file')) if row.get('preview') else None
    item['license_url'] = checked_url(row['license_url'], ('https', 'http')) if row.get('license_url') else None
    item['archive'] = 'eligible' if row.get('archive') == 'eligible' and (
        item['license_url'] or item['url'].startswith('file:')) else 'link'
    item['tags'] = [str(x) for x in row.get('tags', [])][:20]
    metrics = row.get('metrics') or {}
    recorded = metrics.get('as_of')
    if recorded:
        date.fromisoformat(recorded)
    item['metrics'] = {k: metrics.get(k) for k in METRICS}
    for value in item['metrics'].values():
        if value is not None and (type(value) is not int or value < 0 or not recorded):
            raise ValueError('互动量须为有读取日期的非负整数，缺失请留空')
    item['metrics']['as_of'] = recorded
    item['key'] = canonical(item['url'])
    manual_key = str(row.get('dedup_key') or '').strip().casefold()
    item['dedup'] = manual_key or item['key']
    youtube = item['key'].startswith('youtube:') or 'youtube' in item['source'].casefold()
    item['engagement_allowed'] = row.get('engagement_allowed') is True and not youtube
    return item


def rank(rows):
    unique, seen_keys = [], set()
    dedup = set()
    for item in sorted(map(normalize, rows), key=lambda x: (
            -x['match'], -x['value'], x['verified'] != 'media', x['key'], x['title'])):
        if item['dedup'] in dedup or item['key'] in seen_keys:
            continue
        seen_keys.add(item['key'])
        dedup.add(item['dedup'])
        unique.append(item)
    cohorts = {}
    for item in unique:
        if item['engagement_allowed']:
            for metric in METRICS:
                if item['metrics'][metric] is not None:
                    key = item['source'].casefold(), item['kind'], metric
                    cohorts.setdefault(key, []).append(item['metrics'][metric])
    for item in unique:
        parts = []
        if item['engagement_allowed']:
            for metric, weight in METRICS.items():
                value = item['metrics'][metric]
                cohort = cohorts.get((item['source'].casefold(), item['kind'], metric), [])
                if value is not None and len(cohort) >= 5:
                    percentile = (sum(x < value for x in cohort) +
                                  .5 * sum(x == value for x in cohort)) / len(cohort)
                    parts.append((percentile * 100, weight))
        heat = sum(p * w for p, w in parts) / sum(w for _, w in parts) if parts else 50
        item['heat_used'] = bool(parts)
        item['score'] = round(.7 * item['match'] + .2 * item['value'] + .1 * heat, 1)
    unique.sort(key=lambda x: (-x['score'], -x['match'], -x['value'], x['key']))
    for i, item in enumerate(unique, 1):
        item['id'] = f'{i:02d}'
    return unique


def build(args):
    payload = read(args.input)
    items = rank(payload['items'])
    query = str(payload['query']).strip()
    if not query:
        raise ValueError('查询文本为空')
    snapshot = {'query': query, 'groups': list(dict.fromkeys(
        [str(g) for g in payload.get('groups', [])] + [r['category'] for r in items])),
        'items': items}
    data = json.dumps(snapshot, ensure_ascii=False, allow_nan=False).replace('<', '\\u003c')
    template = (SKILL / 'assets/board.html').read_text(encoding='utf-8')
    args.out.mkdir(parents=True, exist_ok=False)
    write(args.out / 'results.json', snapshot)
    (args.out / 'index.html').write_text(template.replace('/*REFERENCE_SNAPSHOT*/', data, 1),
                                        encoding='utf-8')
    return {'count': len(items), 'board': str((args.out / 'index.html').absolute()),
            'snapshot': str((args.out / 'results.json').absolute())}


def local(args):
    script = WORKSPACE / '.agents/skills/tx-layout-atmosphere/scripts/search_vfx_refs.py'
    cmd = [sys.executable, '-X', 'utf8', str(script), '--top', str(args.top), '--', args.query]
    call = subprocess.run(cmd, capture_output=True, encoding='utf-8', timeout=90)
    if call.returncode:
        raise ValueError('现有特效库搜索失败：' + call.stderr.strip()[-750:])
    result = json.loads(call.stdout)
    groups = result if isinstance(result, list) else [result]
    rows = []
    for group in groups:
        for hit in group.get('videos', []):
            source_path = Path(hit['full_path'])
            if not source_path.is_absolute():
                continue
            caption = hit.get('caption') or {}
            thumbnail = hit.get('preview_gif') or hit.get('thumb_path')
            preview = Path(thumbnail) if thumbnail else None
            rows.append({'title': f"{hit['id']} · {caption.get('category') or '项目特效'}",
                         'url': source_path.as_uri(), 'source': '现有 EFX 特效库',
                         'kind': 'video', 'category': '特效', 'verified': 'metadata',
                         'reason': caption.get('description') or '索引候选，待打开核对',
                         'preview': preview.as_uri() if preview and preview.is_file() else None,
                         'tags': caption.get('tags') or [], 'existing_id': hit['id']})
    write(args.out, {'query': args.query, 'items': rows})
    return {'count': len(rows), 'file': str(args.out.absolute()),
            'note': '候选尚未评分，请核对后填 match/value 再建板'}


def file_hash(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def save(args):
    from media import archive_media, download
    snapshot = read(args.snapshot)
    item = next((i for i in snapshot['items'] if i['id'] == args.id.zfill(2)), None)
    if item is None:
        raise ValueError('候选编号不在该次查询中')
    has_media = bool(args.file or args.download_url)
    if has_media and not (args.permission and args.evidence and args.evidence.strip()):
        raise ValueError('保存媒体前需核对许可并记录依据；否则仅收藏链接')
    if args.download_url and (args.permission != 'explicit' or item['archive'] != 'eligible'):
        raise ValueError('仅已核对许可的候选可使用官方原文件下载')
    if args.allow_generation and not has_media:
        raise ValueError('仅有链接时不能设为出图输入')
    if has_media and item['kind'] == 'video' and item['segment'] is None and args.range is None:
        raise ValueError('视频入库需要已核对的起止秒段')
    if args.range and item['kind'] != 'video':
        raise ValueError('只有视频使用秒段')
    segment = bounds(args.range) if args.range else item['segment']
    note = args.note.strip() if args.note else item['reason']
    key = [item['key'], segment, 'media' if has_media else 'link']
    rid = 'TXREF-' + hashlib.sha256(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:12].upper()
    library = args.library.resolve()
    target = library / rid
    if (target / 'reference.json').is_file():
        return {'id': rid, 'status': 'already saved; unchanged', 'folder': str(target)}
    library.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.ref-staging-', dir=library))
    try:
        files, digest = {}, None
        if has_media:
            source = args.file.resolve() if args.file else download(args.download_url, stage)
            digest = file_hash(source)
            files = archive_media(source, stage, item['kind'], segment, args.still_gif)
            if args.download_url:
                source.unlink()
        record = {'schema': 1, 'id': rid, 'status': 'media' if has_media else 'link',
                  'source_url': item['url'], 'source': item['source'], 'title': item['title'],
                  'category': item['category'], 'kind': item['kind'], 'segment': segment,
                  'borrow': note, 'tags': item['tags'], 'shots': args.shot,
                  'permission': args.permission if has_media else None,
                  'evidence': args.evidence if has_media else None, 'license_url': item['license_url'],
                  'allow_generation': bool(args.allow_generation and files.get('frames')),
                  'source_sha256': digest, 'files': files}
        write(stage / 'reference.json', record)
        try:
            stage.rename(target)
        except OSError:
            if (target / 'reference.json').is_file():
                return {'id': rid, 'status': 'already saved; unchanged', 'folder': str(target)}
            raise
        return {'id': rid, 'status': record['status'], 'folder': str(target), 'files': files}
    finally:
        if stage.exists() and stage.resolve().parent == library and stage.name.startswith('.ref-staging-'):
            shutil.rmtree(stage)


def lookup(args):
    rid = args.id.upper()
    if not REF_ID.fullmatch(rid):
        raise ValueError('参考 ID 格式无效')
    folder = args.library.resolve() / rid
    record = read(folder / 'reference.json')
    if args.for_generation:
        if not record.get('allow_generation'):
            raise ValueError('该参考未登记为可用于出图')
        frames = [(folder / name).resolve() for name in record['files']['frames']]
        if any(not p.is_relative_to(folder.resolve()) or not p.is_file() for p in frames):
            raise ValueError('关键帧缺失或超出参考目录')
        record['generation_inputs'] = [str(p) for p in frames]
    return record


def library_search(args):
    def clean(s):
        return unicodedata.normalize('NFKC', s).casefold()

    words = clean(args.query).split()
    rows = []
    for path in args.library.glob('TXREF-*/reference.json'):
        record = read(path)
        text = clean(' '.join(str(record.get(k, '')) for k in (
            'id', 'title', 'category', 'borrow', 'tags', 'shots')))
        if all(word in text for word in words):
            rows.append({k: record[k] for k in ('id', 'title', 'category', 'status', 'borrow',
                                                'shots', 'allow_generation')})
    return sorted(rows, key=lambda row: (row['title'], row['id']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(required=True)
    p = sub.add_parser('build', help='生成候选网页和排名快照')
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.set_defaults(action=build)
    p = sub.add_parser('local', help='收集现有 EFX 库候选')
    p.add_argument('--query', required=True)
    p.add_argument('--top', type=int, choices=range(1, 31), default=10, metavar='1–30')
    p.add_argument('--out', type=Path, required=True)
    p.set_defaults(action=local)
    p = sub.add_parser('save', help='保存用户选中的参考')
    p.add_argument('--snapshot', type=Path, required=True)
    p.add_argument('--id', required=True)
    p.add_argument('--library', type=Path, default=DEFAULT_LIBRARY)
    media = p.add_mutually_exclusive_group()
    media.add_argument('--file', type=Path)
    media.add_argument('--download-url')
    p.add_argument('--permission', choices=['project', 'explicit'])
    p.add_argument('--evidence')
    p.add_argument('--allow-generation', action='store_true')
    p.add_argument('--still-gif', action='store_true')
    p.add_argument('--range', type=float, nargs=2, metavar=('START', 'END'))
    p.add_argument('--shot', action='append', default=[])
    p.add_argument('--note')
    p.set_defaults(action=save)
    p = sub.add_parser('lookup', help='按永久参考 ID 取回素材')
    p.add_argument('id')
    p.add_argument('--library', type=Path, default=DEFAULT_LIBRARY)
    p.add_argument('--for-generation', action='store_true')
    p.set_defaults(action=lookup)
    p = sub.add_parser('find', help='按镜号、标题或标签查共享库')
    p.add_argument('query')
    p.add_argument('--library', type=Path, default=DEFAULT_LIBRARY)
    p.set_defaults(action=library_search)
    args = parser.parse_args()
    try:
        print(json.dumps(args.action(args), ensure_ascii=False, indent=2, allow_nan=False))
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as e:
        parser.exit(1, f'{e}\n')


if __name__ == '__main__':
    main()
