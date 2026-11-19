"""Export the final primary shots of an episode into a scene-column PureRef (.pur) board with Layout comparisons."""
from collections import OrderedDict
from io import BytesIO
from html import escape
from pathlib import Path
import re
from PIL import Image

import purformat.items as items
from purformat import purformat


SHOT_HEIGHT = 600.0
LAYOUT_HEIGHT = 480.0
PAIR_GAP = 36.0
ROW_GAP = 60.0
COL_GAP = 260.0


def _scene_of(shot_label: str) -> str:
    m = re.search(r'(?:^|[_-])(sc\d+)(?:[_-]|$)', shot_label, re.I)
    if m:
        num = re.search(r'\d+', m[1])[0]
        return f'sc{int(num):03d}'
    m2 = re.match(r'^\d+-(\d+)-\d+', shot_label)
    if m2:
        return f'sc{int(m2[1]):03d}'
    return '其他'


def _natural_key(text: str):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', text)]


def _build_text_item(label: str, font_pt: int, x: float, y: float, scale: float = 1.0):
    node = items.PurGraphicsTextItem()
    node.text = (
        '<p style="-qt-paragraph-type:empty; margin:0px; text-indent:0px;"><br /></p>'
        '<p style="margin:0px; text-indent:0px;">'
        f'<span style="font-family:\'Microsoft YaHei\',\'Arial\'; font-size:{font_pt}pt; font-weight:700; color:#ffffff;">'
        f'{escape(label)}</span></p>'
    )
    node.matrix = [scale, 0.0, 0.0, scale]
    node.x = x
    node.y = y
    return node


def _load_pur_image(label: str, image_path: Path, display_height: float):
    with Image.open(image_path) as raw:
        pw, ph = raw.size
        if image_path.suffix.lower() == '.png':
            png_bytes = image_path.read_bytes()
        else:
            im = raw.convert('RGB')
            buf = BytesIO()
            im.save(buf, format='PNG', compress_level=6)
            png_bytes = buf.getvalue()

    pur_img = items.PurImage()
    pur_img.pngBinary = png_bytes

    tf = items.PurGraphicsImageItem()
    tf.reset_crop(pw, ph)
    tf.name = label
    tf.source = str(image_path)
    tf.scale_to_height(display_height)
    pur_img.transforms = [tf]
    return pur_img, tf


def export_episode_pur(scope: str, shot_items: list[tuple[str, Path, Path | None]], out_path: Path) -> dict:
    """Build a .pur board grouped into vertical columns per scene, with render + Layout side by side."""
    if not shot_items:
        raise ValueError('当前没有可导出的有效镜头图片')

    scenes: OrderedDict[str, list[tuple[str, Path, Path | None]]] = OrderedDict()
    for item in shot_items:
        shot_label = item[0]
        scenes.setdefault(_scene_of(shot_label), []).append(item)

    sorted_scenes = sorted(scenes.items(), key=lambda kv: (kv[0] == '其他', _natural_key(kv[0])))

    pur_file = purformat.PurFile()

    placed = []
    col_x = 0.0

    for _scene_name, rows in sorted_scenes:
        cur_y = 0.0
        col_width = 0.0

        for shot_label, render_path, layout_path in rows:
            pur_img, tf = _load_pur_image(shot_label, render_path, SHOT_HEIGHT)
            tf.x = col_x + tf.width / 2.0
            tf.y = cur_y + tf.height / 2.0
            pur_file.images.append(pur_img)

            row_width = tf.width
            if layout_path and layout_path.is_file():
                lay_img, lay_tf = _load_pur_image(f'{shot_label} Layout', layout_path, LAYOUT_HEIGHT)
                lay_tf.x = col_x + tf.width + PAIR_GAP + lay_tf.width / 2.0
                lay_tf.y = cur_y + tf.height / 2.0
                pur_file.images.append(lay_img)
                row_width += PAIR_GAP + lay_tf.width

            col_width = max(col_width, row_width)
            cur_y += SHOT_HEIGHT + ROW_GAP
            placed.append(shot_label)

        col_x += col_width + COL_GAP

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pur_file.write(str(out_path))
    return {'count': len(placed), 'scenes': len(sorted_scenes), 'path': str(out_path), 'size': out_path.stat().st_size}
