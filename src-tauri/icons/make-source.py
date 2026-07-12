# Turns public/logo.png (full-bleed square) into the macOS-shaped icon source that
# `npx tauri icon` fans out from. macOS does not mask app icons — the squircle and the
# ~10% margin have to be baked into the source, or the dock shows a hard-edged square.
# Needs: pip install pillow
import math
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
ROOT = HERE.parent.parent

SIZE, BODY, SS, N = 1024, 824, 4, 5.0  # canvas, body (Apple's icon grid), supersample, squircle exponent

# Superellipse |x|^N + |y|^N = 1 — Apple's continuous corner, not a circular-arc rounded rect.
# Drawn oversized and downsampled because ImageDraw.polygon has no antialiasing.
r = BODY * SS / 2
pts = []
for i in range(720):
    t = i * math.pi / 360
    c, s = math.cos(t), math.sin(t)
    x = math.copysign(abs(c) ** (2 / N), c)
    y = math.copysign(abs(s) ** (2 / N), s)
    pts.append((r + x * r, r + y * r))

mask = Image.new("L", (BODY * SS, BODY * SS), 0)
ImageDraw.Draw(mask).polygon(pts, fill=255)
mask = mask.resize((BODY, BODY), Image.LANCZOS)

body = Image.open(ROOT / "public/logo.png").convert("RGBA").resize((BODY, BODY), Image.LANCZOS)
body.putalpha(mask)

out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
out.paste(body, ((SIZE - BODY) // 2, (SIZE - BODY) // 2), body)
out.save(HERE / "source.png")
print("wrote src-tauri/icons/source.png — now run: npx tauri icon src-tauri/icons/source.png")
