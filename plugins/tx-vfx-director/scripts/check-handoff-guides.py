from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]/"verification/direct-draft"
def load(name, n):
    with Image.open(root/f"{name}-{n}.png") as im:
        return im.copy()
b={i:load("behind",i) for i in range(2,6)}
f={i:load("front",i) for i in range(2,6)}
assert all(im.size==(1280,392) for im in [*b.values(),*f.values()])
assert b[5].mode==f[5].mode=="RGBA"
assert b[5].getpixel((0,0))==(0,0,0,0)
x,y=round(.48*1280),round(.50*392)
point=(x,y)
assert b[5].getpixel(point)[3]<10 and f[5].getpixel(point)[3]>160
assert b[3].getpixel(point)[0]<30 and f[3].getpixel(point)[0]>200
assert b[4].getpixel(point)[0]>240 and f[4].getpixel(point)[0]<100
assert f[4].getpixel((x,round(.40*392)))[0]>220
assert b[2].getpixel(point)!=f[2].getpixel(point)
assert f[3].getpixel((0,0))==(0,0,0,255)
print("Guide pixels verified at 1280x392: rendered footprint, front-layer exception, protection outside the foreground, and transparent FX-only draft match.")

