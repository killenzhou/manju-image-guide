from pathlib import Path
from PIL import Image, ImageChops
from io import BytesIO
import base64, json

root = Path(__file__).resolve().parents[1] / "verification"
report = root / "draft"
def png(name):
    with Image.open(report / name) as im:
        assert im.mode == "RGBA", (name, im.mode)
        return im.copy()
before, hidden, masked, reopened, mask, ice = [png(x) for x in ("palm-before.png","palm-hidden-mask.png","palm-fx.png","palm-reopened.png","palm-mask.png","ice-fx.png")]
with Image.open(root/"frames/EP001-65s.jpg") as source:
    assert before.size == hidden.size == masked.size == reopened.size == mask.size == source.size
    project=json.loads((report/"palm-project.json").read_text(encoding="utf-8"))
    assert base64.b64decode(project["current"]["dataUrl"].split(",",1)[1]) == (root/"frames/EP001-65s.jpg").read_bytes()
    Image.alpha_composite(source.convert("RGBA"),masked).save(report/"palm-composited-preview.png")
with Image.open(root/"frames/EP003-145s.jpg") as source:
    assert ice.size == source.size
for name,im in (("palm",masked),("ice",ice)):
    alpha=im.getchannel("A")
    hist=alpha.histogram()
    assert hist[0] > alpha.width*alpha.height*.5
    assert sum(hist[1:255]) > 800
    assert alpha.getextrema()[1] > 200
    assert all(im.getpixel(p) == (0,0,0,0) for p in ((0,0),(im.width-1,0),(0,im.height-1)))
    print(f"{name}: RGBA {im.width}x{im.height}; partial-alpha pixels={sum(hist[1:255])}; empty corners transparent.")
assert before.tobytes() == hidden.tobytes(), "mask visibility should be non-destructive"
assert masked.tobytes() == reopened.tobytes(), "project round trip did not reproduce FX"
a,b=before.getchannel("A"),masked.getchannel("A")
increased=ImageChops.subtract(b,a)
assert increased.getextrema()[1] <= 1 and sum(increased.histogram()[1:]) <= 8, "mask must not add visible alpha"
assert mask.getchannel("A").getextrema()[1] == 255, "full-strength mask needs an opaque core"
changed=ImageChops.subtract(a,b)
assert changed.getbbox() and sum(changed.histogram()[12:]) > 300
assert ImageChops.multiply(changed.point(lambda a: a if a>1 else 0),ImageChops.invert(mask.getchannel("A")).point(lambda a:255 if a==255 else 0)).getbbox() is None
print("Mask removes alpha locally and has a fully opaque core. Hidden mask restores identical pixels; reopened project reproduces the exact RGBA pixels.")

