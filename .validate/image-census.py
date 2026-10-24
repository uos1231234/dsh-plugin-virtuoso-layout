"""Prove a Virtuoso screenshot is not blank, without being able to view it.

The model driving this session cannot read images, so "the screenshot exists" is
not evidence that anything was drawn. This reports what is actually in the pixels:
the distinct-colour census, the background colour, and the bounding box of all
content that differs from that background. Layer geometry shows up as saturated
colours well away from the dark editor background.
"""

import sys
from collections import Counter

from PIL import Image

path = sys.argv[1]
img = Image.open(path).convert("RGB")
width, height = img.size
pixels = list(img.getdata())
total = len(pixels)

counts = Counter(pixels)
bg, bg_count = counts.most_common(1)[0]

# Bounding box of everything that is not the background colour.
min_x, min_y, max_x, max_y = width, height, -1, -1
for index, colour in enumerate(pixels):
    if colour == bg:
        continue
    x = index % width
    y = index // width
    if x < min_x:
        min_x = x
    if x > max_x:
        max_x = x
    if y < min_y:
        min_y = y
    if y > max_y:
        max_y = y

content = total - bg_count
print(f"file        : {path}")
print(f"size        : {width}x{height} = {total} px")
print(f"background  : rgb{bg} ({bg_count} px, {100.0 * bg_count / total:.2f}%)")
print(f"content     : {content} px ({100.0 * content / total:.2f}%), {len(counts)} distinct colours")
if max_x >= 0:
    print(f"content bbox: x {min_x}..{max_x}  y {min_y}..{max_y}  "
          f"({max_x - min_x + 1}x{max_y - min_y + 1})")
else:
    print("content bbox: EMPTY - the image is a single flat colour")

print("\ntop colours:")
for colour, count in counts.most_common(12):
    r, g, b = colour
    kind = "background" if colour == bg else ("saturated" if max(r, g, b) - min(r, g, b) > 40 else "grey/ui")
    label = f"rgb({r},{g},{b})"
    print(f"  {label:<18} {count:>8} px  {100.0 * count / total:>6.2f}%  {kind}")

# Layer geometry is drawn in saturated colours, unlike the grey UI chrome and the
# dark canvas. Isolating them answers "is the drawing actually visible", which the
# file's existence alone does not.
sat_colours = Counter()
smin_x, smin_y, smax_x, smax_y = width, height, -1, -1
for index, colour in enumerate(pixels):
    if max(colour) - min(colour) <= 40:
        continue
    sat_colours[colour] += 1
    x = index % width
    y = index // width
    smin_x = min(smin_x, x)
    smax_x = max(smax_x, x)
    smin_y = min(smin_y, y)
    smax_y = max(smax_y, y)

sat_total = sum(sat_colours.values())
print(f"\nsaturated pixels: {sat_total} ({100.0 * sat_total / total:.3f}%), "
      f"{len(sat_colours)} distinct layer-ish colours")
if smax_x >= 0:
    print(f"saturated bbox  : x {smin_x}..{smax_x}  y {smin_y}..{smax_y}  "
          f"({smax_x - smin_x + 1}x{smax_y - smin_y + 1})")
else:
    print("saturated bbox  : none - no layer geometry is visible")
print("top saturated colours:")
for colour, count in sat_colours.most_common(8):
    r, g, b = colour
    print(f"  rgb({r},{g},{b})".ljust(20) + f"{count:>7} px")
