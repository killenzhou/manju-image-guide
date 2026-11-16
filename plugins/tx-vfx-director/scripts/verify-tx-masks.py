from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from PIL import Image

report = Path(__file__).resolve().parents[1] / "verification"
for name in ("01-EP001-palm.zip","02-EP001-branch.zip","05-EP003-reuse.zip"):
    with ZipFile(report / name) as z:
        with Image.open(BytesIO(z.read("03.png"))) as pic:
            mask = pic.convert("L")
            changed = sum(mask.histogram()[1:])
            fraction = changed/(mask.width*mask.height)
            assert 0 < fraction < .30, (name, fraction)
            print(f"{name}: influence coverage {fraction:.2%}, local and non-empty")

