"""Run the EFX text index and attach local animated previews to the matches."""
import argparse
import html
import json
from pathlib import Path
import re
import subprocess
import sys

from vfx_gif_cache import CACHE, LIBRARY


def index_search(index, queries, top):
    """Text-only candidate search for runners with the index but no vendor CLI."""
    entries = json.loads(index.read_text(encoding='utf-8-sig'))
    groups = []
    for query in queries:
        terms = list(dict.fromkeys(re.findall(r'[\u3400-\u9fff]+|[a-z0-9_]+', query.casefold())))
        phrases = list(dict.fromkeys(t[i:i+2] for t in terms if len(t) > 2
                                    for i in range(len(t)-1) if '\u3400' <= t[i] <= '\u9fff'))
        hits = []
        for item in entries:
            cap = item.get('vfx_caption') or {}
            if cap.get('is_empty_or_faint'):
                continue
            text = ' '.join([item['filename'], cap.get('category') or '', cap.get('description') or '',
                             *map(str, cap.get('tags') or [])]).casefold()
            score = sum(3 + len(t) for t in terms if t in text) + sum(p in text for p in phrases)
            if score:
                hits.append({**{k: item.get(k) for k in ('id', 'filename', 'full_path', 'thumb_path')},
                             'score': score, 'caption': cap})
        hits.sort(key=lambda x: (-x['score'], x['id']))
        groups.append({'query': query, 'videos': hits[:top], 'templates': [], 'method': 'index text'})
    return groups


def write_html(path, groups):
    def esc(s):
        return html.escape(str(s), quote=True)
    blocks = []
    for group in groups:
        cards = []
        for v in group['videos']:
            c = v.get('caption') or {}
            thumb = Path(v['thumb_path']) if v.get('thumb_path') else None
            gif = Path(v['preview_gif']) if v.get('preview_gif') else None
            pic = ('<img loading="lazy" alt="三帧缩略图" src="' + esc(thumb.as_uri()) + '">'
                   if thumb and thumb.is_file() else '')
            if gif:
                pic = ('<details><summary>展开本地 GIF</summary><img loading="lazy" alt="循环预览" '
                       'src="' + esc(gif.as_uri()) + '"></details>' + pic)
            src = Path(v['full_path']).as_uri()
            cards.append(f'<article><strong>{esc(v["id"])} · {esc(c.get("category", ""))}</strong>'
                         f'<p>{esc(c.get("description", ""))}</p>{pic}<p><a href="{esc(src)}">原视频</a></p></article>')
        blocks.append(f'<h2>{esc(group["query"])}</h2><section>{"".join(cards)}</section>')
    page = ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>特效候选</title>'
            '<style>body{background:#101923;color:#eaf2fa;font:15px/1.6 system-ui;margin:25px}'
            'section{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}'
            'article{background:#192635;padding:14px;border-radius:9px}img{display:block;width:100%}'
            'a{color:#a6dcff}details{margin:7px 0}</style><h1>特效参考候选</h1>'
            '<p>展开 GIF 看动作，定帧和核对颜色时仍回到原片。</p>' + ''.join(blocks) + '</html>')
    with path.open('x', encoding='utf-8') as f:
        f.write(page)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('query', nargs='?')
    p.add_argument('--batch', type=Path)
    p.add_argument('--top', type=int, default=5)
    p.add_argument('--templates', type=int, default=0)
    p.add_argument('--clip', action='store_true')
    p.add_argument('--html', type=Path)
    p.add_argument('--library', type=Path, default=LIBRARY)
    p.add_argument('--index', type=Path, help='Search only this index.json without the library search program')
    p.add_argument('--cache', type=Path, default=CACHE)
    a = p.parse_args()
    if bool(a.query) == bool(a.batch):
        p.error('Specify exactly one query or --batch')
    if a.top < 1 or a.templates < 0:
        p.error('Require positive --top and nonnegative --templates')
    engine = a.library / 'search.py'
    if a.index or not engine.is_file():
        candidate_index = a.index or a.library / 'index.json'
        if not candidate_index.is_file():
            p.error('Supply the project video index with --index, or a library directory with --library')
        if a.clip or a.templates:
            p.error('Index-only text search supports neither --clip nor --templates')
        queries = ([line.strip() for line in a.batch.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
                   if a.batch else [a.query])
        if not queries:
            p.error('Query list is empty')
        groups = index_search(candidate_index, queries, a.top)
        result = groups if a.batch else groups[0]
    else:
        args = [sys.executable, '-X', 'utf8', str(engine), '-k', str(a.top),
                '--tpl', str(a.templates), '--json']
        if a.clip:
            args.append('--clip')
        args.extend(['--batch', str(a.batch)] if a.batch else ['--', a.query])
        call = subprocess.run(args, check=True, capture_output=True, encoding='utf-8')
        result = json.loads(call.stdout)
        groups = result if isinstance(result, list) else [result]
    index = a.cache.resolve() / 'index.json'
    cache = json.loads(index.read_text(encoding='utf-8'))['items'] if index.is_file() else {}
    for group in groups:
        for v in group['videos']:
            record = cache.get(v['id'], {})
            gif = index.parent / Path(record['gif']).name if record.get('gif') else None
            if gif and record.get('source') == v['full_path'] and gif.is_file():
                v.update(preview_gif=str(gif), preview_start_s=record['source_start_s'],
                         preview_duration_s=record['preview_duration_s'], preview_status='local GIF')
            else:
                v.update(preview_gif=None, preview_status='thumbnail / original')
    if a.html:
        write_html(a.html, groups)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
