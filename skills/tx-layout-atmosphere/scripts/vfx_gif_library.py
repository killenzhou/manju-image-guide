"""Adapt the supplemental GIF catalog without modifying its files or original media."""

import hashlib
import json
import os
from pathlib import Path, PureWindowsPath


def load_library(directory=None):
    configured = directory or os.environ.get('TX_VFX_GIF_LIBRARY')
    gif_root = Path(configured or r'E:\VFX_Reference_Library\GIF').absolute()
    index = gif_root.parent / 'vfx_index.json'
    stats = {'status': 'unavailable', 'directory': str(gif_root), 'indexed': 0,
             'searchable': 0, 'excluded': 0}
    if not gif_root.is_dir() or not index.is_file():
        if configured:
            raise ValueError(f'GIF library needs both the directory and its sibling index: {gif_root}')
        return [], stats
    records = json.loads(index.read_text(encoding='utf-8-sig'))
    if not isinstance(records, list):
        raise ValueError(f'Expected a list in {index}')
    stats.update(status='available', indexed=len(records))
    rows = {}
    for r in records:
        if r.get('status') not in ('success', 'skipped') or not r.get('gif_path') or not r.get('src_path'):
            continue
        parts = PureWindowsPath(r['gif_path']).parts
        anchor = next((i for i, s in enumerate(parts) if s.casefold() == 'gif'), -1)
        relative = parts[anchor+1:] if anchor >= 0 else ()
        if not relative or any(p in ('.', '..') or ':' in p for p in relative):
            continue
        gif = gif_root.joinpath(*relative)
        if gif.suffix.casefold() != '.gif' or not gif.is_file():
            continue
        # Ignore generic roots and long collection names listing many unrelated effects.
        categories = list(map(str, r.get('categories') or []))
        local_tags = [x for x in categories[1:][-3:] if len(x) <= 24]
        title = str(r.get('name') or relative[-1])
        key = '/'.join(relative).casefold()
        id_ = 'gif_' + hashlib.sha256(key.encode('utf-8')).hexdigest()[:24]
        rows[id_] = {'id': id_, 'full_path': r['src_path'], 'gif_path': str(gif),
                     'search_text': ' '.join([PureWindowsPath(title).stem, *local_tags]).casefold(),
                     'caption': {'description': title, 'category': ' / '.join(categories)}}
    stats.update(searchable=len(rows), excluded=len(records)-len(rows))
    return list(rows.values()), stats
