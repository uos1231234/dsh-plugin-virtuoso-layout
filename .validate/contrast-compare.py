#!/usr/bin/env python
"""Compose a labelled before/after strip from two screenshots.

Usage:
  python contrast-compare.py <before.png> <after.png> <out.png> [beforeLabel] [afterLabel]

Why this exists: "对比度提升了" is a claim; a single strip of the same window
before and after the fix is evidence. Pairs with image-census.py, which turns
the same two files into numbers (background ratio / saturated-pixel ratio) so
the visual and the metric can be quoted together.
"""

import sys

from PIL import Image, ImageDraw


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    before, after, out = argv[1], argv[2], argv[3]
    labels = (argv[4] if len(argv) > 4 else "before", argv[5] if len(argv) > 5 else "after")

    imgs = [Image.open(p).convert("RGB") for p in (before, after)]
    bar, pad = 24, 8
    height = max(i.height for i in imgs)
    width = sum(i.width for i in imgs) + pad * (len(imgs) + 1)

    canvas = Image.new("RGB", (width, height + bar + pad * 2), (20, 20, 24))
    draw = ImageDraw.Draw(canvas)

    x = pad
    for img, label in zip(imgs, labels):
        draw.text((x + 4, 7), "%s   %dx%d" % (label, img.width, img.height), fill=(235, 235, 235))
        canvas.paste(img, (x, bar + pad))
        # thin separator so the two panels never visually merge
        draw.rectangle(
            [x - 1, bar + pad, x - 1, bar + pad + img.height - 1], fill=(90, 90, 100)
        )
        x += img.width + pad

    canvas.save(out)
    print("wrote %s  %dx%d" % (out, canvas.width, canvas.height))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
