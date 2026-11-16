from pathlib import Path
from PIL import Image

workspace = Path(__file__).resolve().parents[2]
output = Path(__file__).resolve().parents[1] / "assets" / "tx"
output.mkdir(parents=True, exist_ok=True)
sources = (
    ("BoDongZhang.jpg", "palm", {"palm-shape": (790, 77, 956, 280)}),
    ("HanBingTianFu.jpg", "ice", {"ice-burst": (158, 44, 414, 154), "ice-ground": (633, 61, 806, 134)}),
)
for file, name, crops in sources:
    with Image.open(workspace / "img" / "vfx" / file) as image:
        image.convert("RGB").save(output / f"{name}-board.jpg", quality=92)
        if image.size != (1200, 314):
            raise ValueError(f"Unexpected design preview size: {file} {image.size}")
        for label, rect in crops.items():
            image.crop(rect).convert("RGB").save(output / f"{label}.jpg", quality=95)

