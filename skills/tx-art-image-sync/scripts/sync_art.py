"""TX artwork sync through the installed Nteam/Zynn client.

Downloads missing images and replaces older local images with newer server files.
No old image copies are retained; local-newer files are never downgraded.
Session and transfer implementations are reused, not copied, from the local pipeline.
"""
from __future__ import annotations

import argparse
import concurrent.futures
from collections import Counter
import hashlib
import importlib
import json
import os
from pathlib import Path, PureWindowsPath
import shutil
import stat
import sys
import time
from datetime import datetime, timezone, timedelta
import urllib.parse
import uuid

SHADING_CATEGORIES = {'character', 'scence', 'scene', 'pro', 'prop', 'props'}
SHADING_IMAGE_EXTS = {'.gif', '.tga', '.dds', '.ico', '.avif'}
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}
EXCLUDED = {'texture', 'textures', '贴图', 'modeling', 'shading', 'maya', 'ue', 'ue4', 'ue5'}
DEFAULT_TARGET = Path(os.environ.get('TX_ASSETS_DIR', './Assets'))
DEFAULT_OUTPUT = Path(os.environ.get('TX_SYNC_OUTPUT_DIR', './output/asset-image-sync'))
DEFAULT_HELPER = Path(os.environ.get('TX_PIPELINE_HELPER_DIR', './pipeline_helper'))
DEFAULT_PROJECT_ID = os.environ.get('TX_PROJECT_ID')
TZ = timezone(timedelta(hours=8))


def dump(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def digest(path, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def path_parts(package):
    value = str(package).replace('\\', '/')
    p = PureWindowsPath(value)
    raw = value.split('/')
    if p.is_absolute() or p.drive or any(x in ('', '.', '..') for x in raw):
        raise ValueError(f'异常项目路径: {package!r}')
    if any(':' in x or x.endswith((' ', '.')) for x in raw):
        raise ValueError(f'异常Windows文件名: {package!r}')
    if not raw or raw[0].casefold() != 'assets':
        raise ValueError(f'记录不在Assets中: {package!r}')
    return raw


def excluded(parts):
    return any(p.casefold() in EXCLUDED for p in parts)


def art_directory(parts):
    return not excluded(parts) and any(p.casefold() == 'design' or '设计' in p for p in parts)


def shading_directory(parts):
    return len(parts) >= 4 and parts[1].casefold() in SHADING_CATEGORIES and any(
        part.casefold() == 'shading' for part in parts[3:])


def image_kind(package):
    parts = path_parts(package)
    ext = Path(parts[-1]).suffix.casefold()
    if shading_directory(parts[:-1]) and ext in IMAGE_EXTS | SHADING_IMAGE_EXTS:
        return 'shading'
    if art_directory(parts[:-1]) and ext in IMAGE_EXTS:
        return 'design'
    return None


def art_file(package, include_shading=False):
    kind = image_kind(package)
    return kind == 'design' or (include_shading and kind == 'shading')


def target_path(target, package):
    parts = path_parts(package)
    target = Path(target).resolve()
    dest = target.joinpath(*parts[1:])
    # Resolve existing parent junctions/symlinks, not only lexical '..'.
    if not dest.resolve().is_relative_to(target):
        raise ValueError(f'目标越界: {package}')
    return dest


def post(client, endpoint, payload=None):
    for attempt in range(3):
        try:
            return client._post(endpoint, payload)
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(0.5 * (attempt + 1))


def directory_snapshot(client, project_id, workers=4, include_shading=False):
    roots = post(client, '/projectFileDir/getByPathAndProjectId?projectId=' +
                 str(project_id) + '&path=Assets')
    roots = [d for d in (roots or []) if str(d.get('path', '')).casefold() == 'assets'
             and not d.get('deleted')]
    if len(roots) != 1:
        raise ValueError('TX服务器Assets根目录不唯一或缺失')
    pending = roots
    seen = {}
    while pending:
        current = []
        for d in pending:
            parts = path_parts(d['path'])
            if d['id'] not in seen and not d.get('deleted') and (not excluded(parts) or (include_shading and
                    len(parts) >= 2 and parts[1].casefold() in SHADING_CATEGORIES)):
                seen[d['id']] = d
                current.append(d)
        if not current:
            break
        if len(seen) > 20000:
            raise ValueError('目录数量异常，停止遍历')
        def children(d):
            result = post(client, f'/projectFileDir/prlist?projectId={project_id}&id={d["id"]}')
            if result is None:
                return []
            if not isinstance(result, list):
                raise ValueError('目录接口返回格式异常')
            for child in result:
                pp = path_parts(child['path'])
                parent = str(d['path']).replace('\\', '/').casefold().rstrip('/') + '/'
                if not '/'.join(pp).casefold().startswith(parent):
                    raise ValueError('服务器返回非子目录记录')
            return result
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            pending = [child for group in pool.map(children, current) for child in group]
        print(f'目录核对：已读取 {len(seen)}，下一层 {len(pending)}', flush=True)
    return sorted(seen.values(), key=lambda d: d['path'].casefold())


def file_snapshot(client, project_id, directories, include_shading=False, shading_extensions=None):
    ids = []
    for d in directories:
        parts = path_parts(d['path'])
        if art_directory(parts) or (include_shading and shading_directory(parts)):
            ids.append(d['id'])
    by_path = {}
    raw_count = 0
    for start in range(0, len(ids), 100):
        batch = ids[start:start + 100]
        page = 1
        collected = 0
        previous = None
        while True:
            result = post(client, '/projectFile/listPageByDirIds', {
                'projectId': project_id, 'dirIdList': batch, 'pageNum': page, 'pageSize': 500})
            rows = result.get('records') or result.get('rows') or []
            total = int(result.get('total', 0))
            fingerprint = [(r.get('id'), r.get('packageName')) for r in rows]
            if rows and fingerprint == previous:
                raise ValueError('服务器分页重复，停止以防遗漏')
            previous = fingerprint
            raw_count += len(rows)
            collected += len(rows)
            for row in rows:
                if row.get('deleted'):
                    continue
                package = str(row.get('packageName', '')).replace('\\', '/')
                # Validate every candidate path before extension filtering.
                parts = path_parts(package)
                if shading_extensions is not None and shading_directory(parts[:-1]):
                    shading_extensions[Path(parts[-1]).suffix.casefold() or '(无后缀)'] += 1
                if not art_file(package, include_shading):
                    continue
                info = row.get('file') or {}
                if not info or int(info.get('size', 0)) <= 0:
                    raise ValueError(f'图片缺少有效文件记录: {package}')
                key = package.casefold()
                if key in by_path:
                    old = by_path[key]
                    if old.get('file') != row.get('file') or old.get('packageName') != row.get('packageName'):
                        raise ValueError(f'同一路径出现冲突记录: {package}')
                by_path[key] = row
            if collected >= total:
                break
            if not rows or page >= 10000:
                raise ValueError('服务器分页记录数量不足')
            page += 1
    records = sorted(by_path.values(), key=lambda r: r['packageName'].casefold())
    print(f'服务器图片：{len(records)} 张（原始文件记录 {raw_count} 条）', flush=True)
    return records


def local_inventory(target):
    return {p.relative_to(target).as_posix(): {'size': p.stat().st_size,
            'mtime_ns': p.stat().st_mtime_ns} for p in target.rglob('*') if p.is_file()}


def compare(records, target):
    groups = {'missing': [], 'existing': [], 'needs_update': [], 'local_newer': []}
    for row in records:
        path = target_path(target, row['packageName'])
        info = row['file']
        item = {'packageName': row['packageName'], 'localPath': str(path),
                'id': str(info['fileId']), 'serverPath': info['serverPath'],
                'serverCode': info.get('urlPath') or 'disk2', 'size': int(info['size']),
                'mtime': int(info.get('mtime', 0))}
        for algorithm in ('md5', 'sha256'):
            value = info.get(algorithm)
            if isinstance(value, str) and len(value) == hashlib.new(algorithm).digest_size * 2:
                item[algorithm] = value.lower()
        if not path.exists():
            groups['missing'].append(item)
        elif not path.is_file():
            raise ValueError(f'图片目标被目录占用: {path}')
        else:
            stat = path.stat()
            item.update(local_size=stat.st_size, local_mtime=int(stat.st_mtime), local_mtime_ns=stat.st_mtime_ns)
            if stat.st_mtime > item['mtime'] + 2:
                key = 'local_newer'
            elif item['mtime'] > stat.st_mtime + 2 or stat.st_size != item['size']:
                key = 'needs_update'
            else:
                key = 'existing'
            groups[key].append(item)
    return groups


def verify_image(path, expected):
    from PIL import Image
    if path.stat().st_size != expected['size']:
        raise ValueError('图片字节数与服务器记录不符')
    # Original art boards can exceed Pillow's decompression threshold.
    # verify() checks encoded structure/CRC, without allocating a pixel array.
    limit = Image.MAX_IMAGE_PIXELS
    try:
        Image.MAX_IMAGE_PIXELS = None
        with Image.open(path) as im:
            dimensions = list(im.size)
            im.verify()
    finally:
        Image.MAX_IMAGE_PIXELS = limit
    if min(dimensions) <= 0:
        raise ValueError('图片尺寸异常')
    hashes = {'sha256': digest(path)}
    for algorithm in ('md5', 'sha256'):
        if algorithm in expected:
            value = hashes.get(algorithm) or digest(path, algorithm)
            if value.lower() != expected[algorithm].lower():
                raise ValueError(f'服务器{algorithm}校验不符')
    return {**hashes, 'dimensions': dimensions, 'size': path.stat().st_size}


def publish_new(stage, dest):
    """Atomic no-replace publication. Stage remains an independent verified copy."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.parent / ('.art-sync-' + uuid.uuid4().hex + '.tmp')
    try:
        with open(stage, 'rb') as src, open(temp, 'xb') as out:
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        shutil.copystat(stage, temp)
        if os.name == 'nt':
            os.rename(temp, dest)  # Windows refuses an existing destination.
        else:
            os.link(temp, dest)  # POSIX rename would overwrite; link is exclusive.
            temp.unlink()
    finally:
        if temp.exists():
            temp.unlink()


def publish_replacement(stage, dest, before):
    """Validate the planned old file, then atomically replace it without a backup."""
    current = dest.stat()
    if (current.st_size != before['size'] or current.st_mtime_ns != before['mtime_ns']
            or digest(dest) != before['sha256']):
        raise ValueError(f'下载期间本地图片发生变化，保留当前文件: {dest}')
    temp = dest.parent / ('.art-sync-' + uuid.uuid4().hex + '.tmp')
    mode = current.st_mode
    try:
        with open(stage, 'rb') as src, open(temp, 'xb') as out:
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        shutil.copystat(stage, temp)
        # Recheck immediately before committing, including local edits during copying.
        current = dest.stat()
        if (current.st_size != before['size'] or current.st_mtime_ns != before['mtime_ns']
                or digest(dest) != before['sha256']):
            raise ValueError(f'发布前本地图片发生变化，保留当前文件: {dest}')
        if not mode & stat.S_IWRITE:
            os.chmod(dest, mode | stat.S_IWRITE)
        try:
            os.replace(temp, dest)
        except Exception:
            if dest.exists():
                os.chmod(dest, mode)
            raise
    finally:
        if temp.exists():
            temp.unlink()


def stage_complete(task):
    path = Path(task['localPath'])
    try:
        return path.is_file() and path.stat().st_size == task['size']
    except FileNotFoundError:
        return False


def submit_batches(dispatcher, tasks, batch_size=40):
    for start in range(0, len(tasks), batch_size):
        dispatcher.submit_download_tasks(tasks[start:start + batch_size])
        if start + batch_size < len(tasks):
            time.sleep(0.25)


def sync_images(helper, diff, run, target, timeout, replace_existing=True):
    missing = diff['missing']
    updates = diff.get('needs_update', []) if replace_existing else []
    selected = [{**x, 'action': 'create'} for x in missing] + [{**x, 'action': 'replace'} for x in updates]
    created = json.loads((run / 'created.json').read_text(encoding='utf-8')) if (run / 'created.json').exists() else []
    updated = json.loads((run / 'updated.json').read_text(encoding='utf-8')) if (run / 'updated.json').exists() else []
    if not selected:
        return {'created': created, 'updated': updated}
    before_records = []
    for item in selected:
        if item['action'] == 'replace':
            dest = target_path(target, item['packageName'])
            current = dest.stat()
            if current.st_size != item['local_size'] or current.st_mtime_ns != item['local_mtime_ns']:
                raise ValueError(f'扫描后本地图片发生变化: {dest}')
            item['before'] = {'size': current.st_size, 'mtime_ns': current.st_mtime_ns, 'sha256': digest(dest)}
            before_records.append({'packageName': item['packageName'], **item['before']})
    dump(run / 'updated_before.json', before_records)
    bytes_needed = sum(x['size'] for x in selected)
    if shutil.disk_usage(run).free < bytes_needed * 2 + 100 * 1024 * 1024:
        raise ValueError('磁盘剩余空间不足以暂存与验证本批图片')
    tasks = []
    sources = []
    by_id = {}
    for item in selected:
        if item['id'] in by_id:
            task = by_id[item['id']]
            if any(task[k] != item[k] for k in ('serverPath', 'serverCode', 'size')):
                raise ValueError('同一服务器文件ID出现冲突来源')
        else:
            stage = target_path(run / 'staging' / 'Assets', item['packageName'])
            stage.parent.mkdir(parents=True, exist_ok=True)
            task = {**item, 'localPath': str(stage), 'filename': stage.name}
            tasks.append(task)
            by_id[item['id']] = task
        sources.append(task)
    dispatcher = helper.ZynnTransferDispatcher()
    pending_tasks = [x for x in tasks if not stage_complete(x)]
    if pending_tasks:
        if not helper.ensure_transfer_client_running():
            raise RuntimeError('中影年年传输服务未就绪')
        submit_batches(dispatcher, pending_tasks)
    print(f'新增 {len(missing)} 张、覆盖旧图 {len(updates)} 张：复用暂存 {len(tasks)-len(pending_tasks)} 个，传输 {len(pending_tasks)} 个', flush=True)
    deadline = time.monotonic() + timeout
    stable = 0
    last_notice = 0
    last_progress = time.monotonic()
    previous = -1
    retries = 0
    while time.monotonic() < deadline:
        incomplete = [x for x in tasks if not stage_complete(x)]
        complete = len(tasks) - len(incomplete)
        stable = stable + 1 if not incomplete else 0
        now = time.monotonic()
        if complete != previous:
            last_progress, previous = now, complete
        if now - last_notice > 20:
            print(f'下载校验：{complete}/{len(tasks)} 张已到齐', flush=True)
            last_notice = now
        if stable >= 3:
            break
        if incomplete and retries < 2 and now - last_progress >= 45:
            lost = []
            for task in incomplete:
                path = Path(task['localPath'])
                if not path.with_name(path.name + '.zynn').exists() and not stage_complete(task):
                    lost.append(task)
            if lost:
                submit_batches(dispatcher, lost, batch_size=12)
                retries += 1
                print(f'重试缺失且未在传输中的图片：{len(lost)} 张', flush=True)
            last_progress = now
        time.sleep(2)
    else:
        pending = [x['packageName'] for x in tasks if not stage_complete(x)]
        dump(run / 'pending.json', pending)
        raise TimeoutError('下载等待到期，未发布任何目标文件；待下载清单已保存')
    # Validate the entire batch before publishing the first file.
    checks = [verify_image(Path(task['localPath']), item) for item, task in zip(selected, sources)]
    dump(run / 'created.json', created)
    dump(run / 'updated.json', updated)
    for item, task, check in zip(selected, sources, checks):
        dest = target_path(target, item['packageName'])
        if item['action'] == 'create' and dest.exists():
            print(f'保留下载期间出现的现有文件：{dest}', flush=True)
            continue
        stage = Path(task['localPath'])
        if item['mtime'] > 0:
            os.utime(stage, (item['mtime'], item['mtime']))
        if item['action'] == 'replace':
            publish_replacement(stage, dest, item['before'])
        else:
            publish_new(stage, dest)
        entry = {**item, **check, 'localPath': str(dest)}
        # Journal before final verification so a failed verify remains rollbackable.
        journal = updated if item['action'] == 'replace' else created
        journal.append(entry)
        dump(run / ('updated.json' if item['action'] == 'replace' else 'created.json'), journal)
        verify_image(dest, entry)
    return {'created': created, 'updated': updated}


def download_missing(helper, diff, run, target, timeout):
    """Compatibility for a historical missing-only run."""
    return sync_images(helper, diff, run, target, timeout, replace_existing=False)['created']


def rollback(run, apply=False):
    run = Path(run).resolve()
    config = json.loads((run / 'run.json').read_text(encoding='utf-8'))
    target = Path(config['target']).resolve()
    created = json.loads((run / 'created.json').read_text(encoding='utf-8'))
    updated = json.loads((run / 'updated.json').read_text(encoding='utf-8')) if (run / 'updated.json').exists() else []
    result = {'removed': [], 'would_remove': [], 'modified_preserved': [], 'already_absent': [],
              'replacements_retained_no_old_copy': [x['localPath'] for x in updated]}
    for entry in created:
        if not art_file(entry['packageName'], config.get('include_shading', False)):
            raise ValueError('回滚清单含同步范围外的文件')
        dest = target_path(target, entry['packageName'])
        if dest != Path(entry['localPath']).resolve():
            raise ValueError('回滚目标与清单不符')
        if not dest.exists():
            result['already_absent'].append(str(dest))
        elif not dest.is_file() or digest(dest) != entry['sha256']:
            result['modified_preserved'].append(str(dest))
        elif apply:
            dest.unlink()
            result['removed'].append(str(dest))
        else:
            result['would_remove'].append(str(dest))
    dump(run / ('rollback_applied.json' if apply else 'rollback_preview.json'), result)
    print(json.dumps({k: len(v) for k, v in result.items()}, ensure_ascii=False), flush=True)
    return result


def load_helper(folder):
    sys.path.insert(0, str(folder))
    return importlib.import_module('zynn_updater_runner')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='补齐缺失设计图并覆盖本地旧图，不另存旧图副本')
    parser.add_argument('--include-shading', action='store_true', help='同时同步人物、场景、道具 Shading 图片，排除 PSD 和工程文件')
    parser.add_argument('--resume', type=Path, help='继续已有记录与暂存，不重新下载完整文件；须搭配--apply')
    parser.add_argument('--target', type=Path, default=DEFAULT_TARGET)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--helper', type=Path, default=DEFAULT_HELPER)
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    parser.add_argument('--timeout', type=int, default=1800)
    parser.add_argument('--rollback', type=Path)
    parser.add_argument('--apply-rollback', action='store_true')
    args = parser.parse_args()
    if args.rollback:
        rollback(args.rollback, args.apply_rollback)
        return 0
    if args.resume and not args.apply:
        parser.error('--resume 须搭配 --apply')
    now = datetime.now(TZ)
    if args.resume:
        run = args.resume.resolve()
        config = json.loads((run / 'run.json').read_text(encoding='utf-8'))
        if config.get('project') != 'TX' or config.get('mode') not in ('missing_only', 'update_newer'):
            raise ValueError('继续记录不属于TX设计图流程')
        target = Path(config['target']).resolve()
        dump(run / 'resume.json', {'command': sys.argv, 'at': now.isoformat(),
                                  'source': 'saved server snapshot; live scan required after completion'})
    else:
        target = args.target.resolve()
        run = args.output.resolve() / (now.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])
        run.mkdir(parents=True)
        config = {'target': str(target), 'project': 'TX', 'mode': 'update_newer',
                  'started_at': now.isoformat(), 'apply': args.apply, 'command': sys.argv,
                  'include_shading': args.include_shading}
        dump(run / 'run.json', config)
    if not target.is_dir():
        raise ValueError(f'目标资产目录不存在: {target}')
    print(f'记录目录：{run}', flush=True)
    try:
        helper = load_helper(args.helper)
        if args.resume:
            baseline = json.loads((run / 'local_before.json').read_text(encoding='utf-8'))
            records = json.loads((run / 'server_records.json').read_text(encoding='utf-8'))
            project_id = config.get('project_id') or (int(DEFAULT_PROJECT_ID) if DEFAULT_PROJECT_ID else None)
        else:
            baseline = local_inventory(target)
            dump(run / 'local_before.json', baseline)
            session = helper.get_active_zynn_token()
            if not session:
                raise RuntimeError('请在资产管理客户端登录后重试')
            client = helper.ZynnTaskApiClient(session['token'])
            project_id = client.fetch_project_id('TX')
            if DEFAULT_PROJECT_ID and int(project_id) != int(DEFAULT_PROJECT_ID):
                raise ValueError('TX项目ID与TX_PROJECT_ID不符，请重新核对服务器项目映射')
            config['project_id'] = project_id
            dump(run / 'run.json', config)
            dirs = directory_snapshot(client, project_id, args.workers, args.include_shading)
            dump(run / 'server_directories.json', dirs)
            extensions = Counter()
            records = file_snapshot(client, project_id, dirs, args.include_shading, extensions)
            if args.include_shading:
                dump(run / 'shading_extensions.json', dict(sorted(extensions.items())))
            dump(run / 'server_records.json', records)
        if not records:
            raise ValueError('服务器图片集合为空，停止本次同步')
        diff = compare(records, target)
        dump(run / ('resume_plan.json' if args.resume else 'plan.json'), diff)
        def counts(rows):
            return dict(Counter(image_kind(row['packageName']) for row in rows))
        print('比对结果：' + json.dumps({k: counts(v) for k, v in diff.items()}, ensure_ascii=False), flush=True)
        can_replace = config['mode'] == 'update_newer'
        outcome = sync_images(helper, diff, run, target, args.timeout, can_replace) if args.apply else {'created': [], 'updated': []}
        created, updated = outcome['created'], outcome['updated']
        if not (run / 'created.json').exists():
            dump(run / 'created.json', created)
        if not (run / 'updated.json').exists():
            dump(run / 'updated.json', updated)
        after = local_inventory(target)
        dump(run / 'local_after.json', after)
        changed_existing = [p for p, meta in baseline.items() if after.get(p) != meta]
        expected_changes = {Path(x['localPath']).relative_to(target).as_posix() for x in updated}
        unexpected_changes = [p for p in changed_existing if p not in expected_changes]
        final_diff = compare(records, target)
        summary = {'run': str(run), 'project_id': project_id, 'server_art_images': len(records),
                   'image_counts': {'server': counts(records), 'created': counts(created), 'updated': counts(updated),
                                    'remaining_missing': counts(final_diff['missing']),
                                    'remaining_updates': counts(final_diff['needs_update'])},
                   'initial_missing': len(diff['missing']), 'initial_updates': len(diff['needs_update']),
                   'created': len(created), 'updated': len(updated),
                   'remaining_missing_in_snapshot': len(final_diff['missing']),
                   'remaining_updates_in_snapshot': len(final_diff['needs_update']),
                   'local_newer_preserved': len(final_diff['local_newer']),
                   'baseline_files': len(baseline), 'existing_metadata_changes': changed_existing,
                   'unexpected_existing_changes': unexpected_changes,
                   'created_bytes': sum(x['size'] for x in created), 'updated_bytes': sum(x['size'] for x in updated),
                   'completed_at': datetime.now(TZ).isoformat(),
                   'status': 'success' if not unexpected_changes and (not args.apply or
                             (not final_diff['missing'] and (not can_replace or not final_diff['needs_update']))) else 'attention'}
        dump(run / 'summary.json', summary)
        if summary['status'] == 'success' and (run / 'error.json').exists():
            os.replace(run / 'error.json', run / ('recovered_error-' + now.strftime('%H%M%S') + '.json'))
        lines = ['# TX 资产图片更新记录', '', f'- 模式：{config["mode"]}；服务器较新则替换本地旧图，不保存旧图副本',
                 f'- 服务器设计图：{counts(records).get("design", 0)} 张；Shading：{counts(records).get("shading", 0)} 张', f'- 初始缺失：{len(diff["missing"])} 张',
                 f'- 本次新增：{len(created)} 张；覆盖旧图：{len(updated)} 张',
                 f'- 快照内剩余缺失：{len(final_diff["missing"])} 张；待更新：{len(final_diff["needs_update"])} 张',
                 f'- 本地时间较新（未降级）：{len(final_diff["local_newer"])} 张',
                 f'- 计划外原有文件元数据变更：{len(unexpected_changes)} 项', '',
                 '文件明细见 server_records.json、plan.json、created.json、updated.json。',
                 '旧图已按要求直接替换，无旧图备份。撤销入口只处理本次新增图片，不恢复被替换的旧图。']
        (run / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        print(json.dumps(summary, ensure_ascii=False), flush=True)
        return 0 if summary['status'] == 'success' else 2
    except Exception as exc:
        dump(run / 'error.json', {'type': type(exc).__name__, 'message': str(exc)})
        print(f'本次停止：{exc}；记录目录：{run}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    raise SystemExit(main())
