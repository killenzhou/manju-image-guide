"""Collect, diversify and audit local VFX candidates without changing the source index."""
import argparse
import csv
import hashlib
from html import escape
import json
import math
from pathlib import Path, PureWindowsPath
import re
from collections import Counter

from vfx_gif_cache import CACHE, LIBRARY
from vfx_gif_library import load_library
from vfx_reference_id import public_id


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def terms(q):
    return list(dict.fromkeys(re.findall(r'[\u3400-\u9fff]+|[a-z0-9_]+', q.casefold())))


def caption(row):
    return row.get('caption') or row.get('vfx_caption') or {}


def description(row):
    if 'search_text' in row:
        return row['search_text']
    c = caption(row)
    return ' '.join([c.get('category') or '', c.get('description') or '',
                     *map(str, c.get('tags') or [])]).casefold()


def rank_corpus(entries, queries, pool):
    """Rank one corpus using the same term statistics and weights for every entry."""
    texts = [(r, description(r)) for r in entries if not caption(r).get('is_empty_or_faint')]
    vocab = {t for q in queries for t in terms(q)}
    idf = {t: math.log1p((len(texts) + 0.5) / (0.5 + sum(t in s for _, s in texts)))
           for t in vocab}
    results = {}
    for q in queries:
        ranked = []
        for r, s in texts:
            score = sum(idf[t] for t in terms(q) if t in s)
            if score:
                ranked.append(dict(r, score=round(score, 8), caption=caption(r)))
        ranked.sort(key=lambda r: (-r['score'], stable(q, r['id'])))
        results[q] = ranked[:pool]
    return results


def stable(seed, ref_id):
    return hashlib.sha256(f'{seed}|{ref_id}'.encode('utf-8')).hexdigest()


def load_primary(args):
    index = args.index or args.library / 'index.json'
    if not args.index and args.library == LIBRARY and not index.is_file():
        return []
    rows = read(index)
    if not isinstance(rows, list):
        raise ValueError(f'Expected a list in {index}')
    return [dict(r, library='ue') for r in rows if r.get('id') and r.get('full_path')]


def path_key(p):
    return str(p).replace('\\', '/').casefold()


def attach(row, cache, folder):
    info = cache.get(row['id'], {})
    gif = folder / Path(info['gif']).name if info.get('gif') else None
    if gif and gif.is_file() and path_key(info.get('source')) == path_key(row['source']):
        row['gif'] = str(gif.resolve())
        row['preview_seconds'] = [info['source_start_s'],
                                  round(info['source_start_s'] + info['preview_duration_s'], 3)]
    else:
        row['gif'] = None
        row['preview_seconds'] = None


def check_spec(spec, args):
    def query_list(values, label):
        if not isinstance(values, list) or not values or any(
                not isinstance(s, str) or not s.strip() or s != s.strip() or '\n' in s or '\r' in s
                for s in values):
            raise ValueError(f'{label} must contain trimmed, one-line queries')
    if not isinstance(spec.get('shot'), str) or not spec['shot'].strip():
        raise ValueError('Specify shot')
    query_list(spec.get('baseline'), 'baseline')
    routes = spec.get('routes')
    if not isinstance(routes, list) or not 2 <= len(routes) <= 8:
        raise ValueError('Supply 2–8 distinct visual routes')
    seen = set()
    for r in routes:
        if not re.fullmatch('[a-z0-9_-]+', r.get('id','')) or r['id'] in seen or not r.get('label'):
            raise ValueError('Route ids must be unique; each needs a label')
        seen.add(r['id'])
        query_list(r.get('queries'), r['id'])
        for group in r.get('require', []):
            query_list(group, f'{r["id"]}.require')
        if not r.get('require'):
            raise ValueError(f'{r["id"]}: provide observable metadata anchors to avoid filler')
        if 'exclude' in r and r['exclude'] != []:
            query_list(r['exclude'], f'{r["id"]}.exclude')
        if not isinstance(r.get('min', 2), int) or not 0 <= r.get('min', 2) <= 5:
            raise ValueError('Each route min must be 0–5')
    if sum(r.get('min', 2) for r in routes) + args.explore > args.page:
        raise ValueError('Route minimums plus exploration must fit the first page')
    if not (1 <= args.baseline_top <= args.pool and args.page <= args.pool
            and 1 <= args.explore_rank <= args.pool):
        raise ValueError('Pool must fit page, baseline top and exploration rank')


def rank_baseline(queries, results, limit, page, seed):
    scores = Counter()
    best = {}
    for q in dict.fromkeys(queries):
        for i, v in enumerate(results[q][:limit], 1):
            if not v.get('full_path'):
                continue
            k = v['id']
            scores[k] += 1 / (60 + i)
            best[k] = min(best.get(k, i), i)
    return sorted(scores, key=lambda k: (-scores[k], best[k], stable(seed, k)))[:page], len(scores)


def gate(route, text):
    missed = ['／'.join(group) for group in route['require']
              if not any(t.casefold() in text for t in group)]
    blocked = [t for t in route.get('exclude', []) if t.casefold() in text]
    return '；'.join(([f'缺：{"、".join(missed)}'] if missed else [])
                     + ([f'明确排除词：{"、".join(blocked)}'] if blocked else []))


def build(spec, results, args, ue_count, gif_stats):
    reviews = read(args.reviews) if args.reviews else {}
    if not isinstance(reviews, dict) or any(
            not isinstance(v, dict) or v.get('status') not in ('可借用', '不适合')
            or not isinstance(v.get('reason'), str) or not v['reason'].strip() for v in reviews.values()):
        raise ValueError('Review entries need status 可借用 / 不适合 and a reason')
    old, old_pool = rank_baseline(spec['baseline'], results, args.baseline_top, args.page, spec['shot'])
    wide, wide_pool = rank_baseline(spec['baseline'], results, args.page, args.page, spec['shot'])
    seen = set(spec.get('seen_ids', [])) | set(old)
    rows = {}
    lanes = {}
    route_index = {r['id']: r for r in spec['routes']}
    lookup_queries = [('baseline', q) for q in dict.fromkeys(spec['baseline'])]
    lookup_queries += [(r['id'], q) for r in spec['routes'] for q in dict.fromkeys(r['queries'])]
    families = spec.get('families', {})
    for route_id, q in lookup_queries:
        for rank, v in enumerate(results[q], 1):
            library = v['library']
            k, source = v['id'], v.get('full_path')
            if not source:
                continue
            c = caption(v)
            row = rows.setdefault(k, {'id': k, 'source': source,
                                      'library': library, 'gif_path': v.get('gif_path') if library == 'gif' else None,
                                      'family': families.get(public_id(k), families.get(k)),
                                      'caption': c.get('description') or '',
                                      'category': c.get('category') or '', 'hits': [], 'routes': {},
                                      'known_seen': k in seen or public_id(k) in seen})
            text = description(v)
            row['hits'].append({'route': route_id, 'query': q, 'rank': rank, 'score': v['score'],
                                'literal_hits': [t for t in terms(q) if t in text]})
            if route_id == 'baseline':
                continue
            reject = gate(route_index[route_id], text)
            info = row['routes'].setdefault(route_id, {'best_rank': rank, 'rrf': 0.0, 'gate': reject})
            info['best_rank'] = min(info['best_rank'], rank)
            info['rrf'] += 1 / (60 + rank)
    cache_index = args.cache / 'index.json'
    cache = read(cache_index)['items'] if cache_index.is_file() else {}
    for k, row in rows.items():
        row['review'] = reviews.get(public_id(k), reviews.get(k, {'status': '待看片', 'reason': ''}))
        if row['library'] == 'gif':
            row['gif'] = row.pop('gif_path')
            row['preview_seconds'] = None
        else:
            row.pop('gif_path')
            attach(row, cache, args.cache)
        for route_id, hit in row['routes'].items():
            hit['rrf'] = round(hit['rrf'] / len(set(route_index[route_id]['queries'])), 9)
            if not hit['gate'] and row['review']['status'] != '不适合':
                lanes.setdefault(route_id, []).append(row)
    for route_id, lane in lanes.items():
        lane.sort(key=lambda x: (-x['routes'][route_id]['rrf'], x['routes'][route_id]['best_rank'],
                                 stable(spec['shot'], x['id'])))
    chosen = {}
    used_source = {}
    used_family = {}
    def duplicate(row):
        return (used_source.get(path_key(row['source']))
                or (used_family.get(row['family']) if row['family'] else None))
    def take(row, reason):
        if len(chosen) >= args.page or row['id'] in chosen or duplicate(row):
            return False
        chosen[row['id']] = reason
        used_source[path_key(row['source'])] = row['id']
        if row['family']:
            used_family[row['family']] = row['id']
        return True

    for route in spec['routes']:
        lane = lanes.get(route['id'], [])
        coverage = sum(row['id'] in chosen for row in lane)
        for row in lane:
            if coverage >= route.get('min', 2):
                break
            if take(row, f'方向覆盖：{route["label"]}'):
                coverage += 1
    def best_route_key(row):
        return min(((-x['rrf'], x['best_rank']) for x in row['routes'].values() if not x['gate']),
                   default=(0, args.pool + 1))
    all_eligible = sorted((r for r in rows.values() if any(not x['gate'] for x in r['routes'].values())),
                          key=lambda r: (*best_route_key(r), stable(spec['shot'], r['id'])))
    exploration = 0
    # At most one exploration position per visual direction; never promote an ineligible hit.
    for route in spec['routes']:
        if exploration >= args.explore:
            break
        for row in lanes.get(route['id'], []):
            rank = row['routes'][route['id']]['best_rank']
            if not row['known_seen'] and rank <= args.explore_rank and row['gif'] and take(
                    row, f'探索位：{route["label"]}／旧首屏及已登记曝光未见'):
                exploration += 1
                break
    # Fill the remaining seats round-robin, rather than adding incompatible route scores.
    while len(chosen) < args.page:
        n = len(chosen)
        for route in spec['routes']:
            for row in lanes.get(route['id'], []):
                if take(row, f'按路轮转补位：{route["label"]}'):
                    break
        if n == len(chosen):
            break
    page_order = {k: i for i, k in enumerate(chosen, 1)}
    for row in rows.values():
        k = row['id']
        row['first_page_rank'] = page_order.get(k)
        row['old_rank'] = old.index(k) + 1 if k in old else None
        row['wide_rank'] = wide.index(k) + 1 if k in wide else None
        valid = [i for i, hit in row['routes'].items() if not hit['gate']]
        row['eligible_routes'] = valid
        copy = duplicate(row)
        row['decision'] = (chosen[k] if k in chosen else
                           '落选：看片判为不适合' if row['review']['status'] == '不适合' else
                           f'去重：同源或已核同族 {public_id(copy)}' if copy else
                           '候补：符合门槛，首屏未分到位置' if valid else
                           '落选：未通过任何方向的文字门槛' if row['routes'] else
                           '仅旧查询召回')
    candidates = sorted(rows.values(), key=lambda r: (page_order.get(r['id'], 1000), *best_route_key(r),
                                                     stable(spec['shot'], r['id'])))
    return {'shot': spec['shot'], 'backend': 'unified-idf',
            'libraries': {'ue': {'indexed': ue_count}, 'gif': gif_stats},
            'settings': {'pool_per_query': args.pool, 'page': args.page, 'baseline_top': args.baseline_top,
                         'explore': args.explore, 'explore_rank': args.explore_rank},
            'routes': spec['routes'], 'baseline_queries': spec['baseline'],
            'views': {'old': old, 'wide': wide, 'diverse': list(chosen)},
            'counts': {'old_union': old_pool, 'wide_union': wide_pool,
                       'new_union': sum(bool(r['routes']) for r in candidates),
                       'new_eligible': len(all_eligible), 'exploration': exploration,
                       'by_library': {lib: {'recalled': sum(r['library'] == lib and bool(r['routes']) for r in candidates),
                                            'first_page': sum(rows[k]['library'] == lib for k in chosen)}
                                      for lib in ('ue', 'gif')},
                       'reviewed': sum(r['review']['status'] != '待看片' for r in candidates),
                       'review_rejected': sum(r['review']['status'] == '不适合' for r in candidates),
                       'direction_coverage': {i: sum(x['id'] in chosen for x in lanes.get(i, []))
                                              for i in route_index},
                       'unfilled_min': {i: r.get('min', 2) - sum(x['id'] in chosen for x in lanes.get(i, []))
                                        for i, r in route_index.items()
                                        if sum(x['id'] in chosen for x in lanes.get(i, [])) < r.get('min', 2)}},
            'candidates': candidates}


def write(out, result, internal_audit=False):
    out.mkdir(parents=True, exist_ok=False)
    columns = ['id', 'first_page_rank', 'decision', 'eligible_routes', 'caption', 'preview_seconds',
               'hits', 'routes', 'review']
    candidates = [dict({k: r[k] for k in [*columns, 'source', 'gif']}, id=public_id(r['id']))
                  for r in result['candidates']]
    ids = [public_id(i) for i in result['views']['diverse']]
    counts = {k: result['counts'][k] for k in ('new_union', 'new_eligible', 'exploration', 'reviewed',
                                             'review_rejected', 'direction_coverage', 'unfilled_min')}
    public = {'shot': result['shot'], 'settings': result['settings'], 'routes': result['routes'],
              'views': {'diverse': ids}, 'counts': counts, 'candidates': candidates}
    (out/'results.json').write_text(json.dumps(public, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    if internal_audit:
        (out/'internal_audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    with (out/'检索对照.csv').open('x', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        for row in candidates:
            w.writerow({k: json.dumps(row[k], ensure_ascii=False) if isinstance(row[k], (dict, list))
                        else row[k] for k in columns})
    esc = escape
    rows = {r['id']:r for r in candidates}
    def url(p):
        win = PureWindowsPath(p)
        return esc(win.as_uri() if win.is_absolute() else Path(p).absolute().as_uri(), quote=True)
    def detail(r):
        hits = '；'.join(f'{h["route"]}｜{h["query"]}｜#{h["rank"]} / {h["score"]}｜'
                        f'字面：{"/".join(h["literal_hits"]) or "无"}' for h in r['hits'])
        gates = '；'.join(f'{i}：{x["gate"] or "通过"}' for i,x in r['routes'].items())
        preview = (f'<img loading="lazy" src="{url(r["gif"])}" alt="本地 GIF">' if r['gif'] else '<p>暂无本地 GIF</p>')
        rev = esc(r['review']['status'] + ('：'+r['review']['reason'] if r['review']['reason'] else ''))
        return (f'<details><summary>{esc(r["id"])}｜{esc(r["caption"])}｜{rev}</summary>'
                f'<p>{esc(r["decision"])} · {esc(str(r["preview_seconds"] or "秒段待核"))} · '
                f'<a href="{url(r["source"])}">原片</a></p>{preview}'
                f'<p>{esc(gates)}</p><p>{esc(hits)}</p></details>')
    section = f'<section><h2>参考候选｜{len(ids)} 条</h2>' + ''.join(detail(rows[i]) for i in ids) + '</section>'
    coverage = '，'.join(f'{r["label"]} {counts["direction_coverage"][r["id"]]}' for r in result['routes'])
    missing = '，'.join(f'{r["label"]} 缺 {counts["unfilled_min"][r["id"]]}' for r in result['routes']
                       if r['id'] in counts['unfilled_min'])
    html = ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>特效检索对照</title>'
            '<style>body{background:#14202b;color:#eaf2fa;font:16px/1.6 system-ui;margin:2rem}'
            'a{color:#9edbff}details{padding:.5rem;border-bottom:1px solid #304358}'
            'summary{cursor:pointer}img{display:block;max-width:min(100%,520px)}</style>'
            f'<h1>{esc(result["shot"])}｜特效检索对照</h1>'
            f'<p>分方向召回 {counts["new_union"]}，'
            f'文字门槛通过 {counts["new_eligible"]} · 探索位 {counts["exploration"]}</p>'
            f'<p>首屏方向覆盖（可重叠）：{esc(coverage)}</p>'
            + (f'<p>未达方向最低数：{esc(missing)}；不拿无关候选补数。</p>' if missing else '') +
            f'<p>已抽看 GIF {counts["reviewed"]} 条，其中不适合 {counts["review_rejected"]} 条。</p>'
            '<p>算法首屏与看片状态分开。GIF 秒段是缓存预览，并非已选出图帧。'
            '<a href="检索对照.csv">完整候选与取舍表</a></p>'
            + section + '</html>')
    (out/'index.html').write_text(html, encoding='utf-8')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('spec', type=Path)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--library', type=Path, default=LIBRARY)
    p.add_argument('--index', type=Path)
    p.add_argument('--cache', type=Path, default=CACHE)
    gif_options = p.add_mutually_exclusive_group()
    gif_options.add_argument('--gif-library', type=Path, metavar='GIF_DIR')
    gif_options.add_argument('--no-gif-library', action='store_true', help='Search only the primary index for diagnostics')
    p.add_argument('--internal-audit', action='store_true', help='Save index diagnostics separately for maintainers')
    p.add_argument('--reviews', type=Path)
    p.add_argument('--pool', type=int, default=25, choices=range(5, 101), metavar='5..100')
    p.add_argument('--page', type=int, default=20, choices=range(5, 41), metavar='5..40')
    p.add_argument('--baseline-top', type=int, default=5)
    p.add_argument('--explore', type=int, default=3, choices=range(0, 6))
    p.add_argument('--explore-rank', type=int, default=12)
    a = p.parse_args()
    spec = read(a.spec)
    check_spec(spec, a)
    if a.out.exists():
        p.error('Choose a new output directory')
    qs = dict.fromkeys(spec['baseline'] + [q for r in spec['routes'] for q in r['queries']])
    try:
        ue = load_primary(a)
        gif, gif_stats = ([], {'status': 'disabled', 'searchable': 0}) if a.no_gif_library else load_library(a.gif_library)
    except (OSError, ValueError) as e:
        p.error(str(e))
    if not ue and not gif:
        p.error('No searchable VFX reference index is available')
    entries = [*ue, *(dict(r, library='gif') for r in gif)]
    results = rank_corpus(entries, qs, a.pool)
    result = build(spec, results, a, len(ue), gif_stats)
    write(a.out, result, a.internal_audit)
    print(json.dumps({'out': str(a.out.resolve()), 'first_page': len(result['views']['diverse']),
                      'recalled': result['counts']['new_union']},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
