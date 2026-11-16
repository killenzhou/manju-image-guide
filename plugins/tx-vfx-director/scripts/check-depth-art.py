from pathlib import Path
import hashlib, json
from PIL import Image, ImageChops, ImageDraw, ImageFont

out=Path(__file__).resolve().parents[1]/"verification"/"depth"
rows=json.loads((out/"thumbnails.json").read_text(encoding="utf-8"))
assert len(rows)==30
unique=set()
font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",13)
board=Image.new("RGB",(1000,830),"#111923")
d=ImageDraw.Draw(board)
for i,row in enumerate(rows):
    im=Image.open(out/"thumbnails"/(row["id"]+".png")).convert("RGBA")
    assert im.getchannel("A").getbbox(), row["id"]
    unique.add(hashlib.sha256(im.tobytes()).hexdigest())
    x=12+(i%5)*198; y=12+(i//5)*135
    d.rounded_rectangle((x,y,x+188,y+124),radius=5,fill="#748697" if row["id"]=="ink" else "#172534",outline="#39495a")
    board.paste(im,(x+6,y+5),im)
    d.text((x+8,y+108),row["title"],font=font,fill="#e4f5ff")
assert len(unique)==30
board.save(out/"30-brushes.png")
flat,spatial,final,reopened=(Image.open(out/name).convert("RGBA") for name in ("flat.png","spatial.png","depth-final.png","depth-reopened.png"))
assert final.size==reopened.size==spatial.size==flat.size==(1280,392)
assert ImageChops.difference(flat.getchannel("A"),spatial.getchannel("A")).getbbox()
assert final.tobytes()==reopened.tobytes()
assert final.getpixel((0,0))==(0,0,0,0)
assert sum(final.getchannel("A").histogram()[1:255])>1000
print("30/30 presets render distinct, non-empty pixels. Perspective/transform changes the alpha footprint; reopened final RGBA matches exactly.")

