from pathlib import Path
import cv2
from PIL import Image

out = Path(__file__).resolve().parents[1] / "verification" / "frames"
out.mkdir(parents=True, exist_ok=True)
for ep, second in ((1, 65), (3, 145)):
    path = f"Y:/TX/Video_Final/Layout/EP{ep:03}_ly.mov"
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_MSEC, second * 1000)
    ok, frame = cap.read()
    frame_index = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
    cap.release()
    if not ok:
        raise RuntimeError(path)
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    image.thumbnail((1280, 720))
    image.save(out / f"EP{ep:03}-{second}s.jpg", quality=91)
    print(f"{path} @ {second}s frame {frame_index} -> {image.size}")

