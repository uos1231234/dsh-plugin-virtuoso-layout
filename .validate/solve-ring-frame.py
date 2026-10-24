# TEMPLATE -- rule values are redacted (written as X). Fill them in from your own
# licensed PDK before running. See README, "Note on third-party material".
"""
Rebuild the guard ring so it is an actual RING -- a closed loop with an empty
middle -- and verify it by rasterising the shapes and counting holes.

The screenshot showed the problem better than any rule check did: the "ring" was
a solid horizontal bar. Cause: the four sides were laid out with the top side at
y -1.34..-0.92 and the bottom at -1.49..-1.07, which OVERLAP in y. The vertical
sides then filled the space between them, so the union was one filled rectangle.

A guard ring must ENCLOSE the device. Its four sides form a frame:
    outer rectangle minus inner rectangle
with the inner opening large enough that the device (plus implants) fits inside.

This script computes the frame, then RASTERISES it at 10 nm and counts connected
components and holes. A frame has exactly 1 component and exactly 1 hole; a solid
bar has 1 component and 0 holes. That is a check the eye can make, so it is the
right check to automate.
"""

DEVx0, DEVx1 = 0.40, 2.00
DEVy0, DEVy1 = 0.00, 1.20
SN_BOTTOM = -0.64          # SN's lowest edge (SN_7_17 grown it past the active)
SN_TOP = 1.84              # SN's highest edge
# The opening must clear EVERYTHING the device occupies in y, and the gate PAD
# reaches higher than both the active and SN. dsh_nmos14 ignored it and produced
# three violations at once:
#   GP_11a    the ring's AA crossed the gate pad's corner
#   CT_4a     the ring came within X of the gate contact
#   SN_18&SP_18 the ring's SP cut into SN over the whole device area
# The pad top is 2.19 and its metal 2.37, so those set the upper bound.
GATE_PAD_TOP = 2.19
GATE_M1_TOP = 2.37
DEV_TOP = max(SN_TOP, GATE_PAD_TOP, GATE_M1_TOP)
SP_ENC = X              # SP_9
SN_RING_GAP = 0.10         # clearance between the ring's SP and the implants
AA_SP = X               # AA_4
RING = 0.42                # ring width (contact + 2 x AA_ENC)

failures = []


def check(name, ok, detail):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}: {detail}")
    if not ok:
        failures.append(name)


# ── the opening must clear the device AND its implants ──────────────────────
# Inner opening edges. On the top/bottom it is SN that governs; on the left/right
# it is the active plus implants. SN's x extent is DEVx -/+ X (SN_9).
SNx0, SNx1 = DEVx0 - 0.18, DEVx1 + 0.18
# The SP that guards the ring must stay clear of SN, so the ring's inner edge is
# set by SP's outer edge:  inner = SN edge +/- (gap + SP_ENC)
inner_x0 = SNx0 - (SN_RING_GAP + SP_ENC)
inner_x1 = SNx1 + (SN_RING_GAP + SP_ENC)
inner_y0 = SN_BOTTOM - (SN_RING_GAP + SP_ENC)
inner_y1 = DEV_TOP + (SN_RING_GAP + SP_ENC)

# The ring's outer edges are RING beyond the inner ones.
outer_x0 = inner_x0 - RING
outer_x1 = inner_x1 + RING
outer_y0 = inner_y0 - RING
outer_y1 = inner_y1 + RING

print("=" * 74)
print("Guard ring frame")
print("=" * 74)
print()
print(f"  device active  x {DEVx0:6.2f}..{DEVx1:6.2f}   y {DEVy0:6.2f}..{DEVy1:6.2f}")
print(f"  SN implant     x {SNx0:6.2f}..{SNx1:6.2f}   y {SN_BOTTOM:6.2f}..{SN_TOP:6.2f}")
print(f"  gate pad / M1  y up to {GATE_PAD_TOP:.2f} / {GATE_M1_TOP:.2f}  -> DEV_TOP {DEV_TOP:.2f}")
print(f"  ring opening   x {inner_x0:6.2f}..{inner_x1:6.2f}   y {inner_y0:6.2f}..{inner_y1:6.2f}")
print(f"  ring outer     x {outer_x0:6.2f}..{outer_x1:6.2f}   y {outer_y0:6.2f}..{outer_y1:6.2f}")
print()

# ── four sides, as a frame ─────────────────────────────────────────────────
sides = [
    ("bottom", outer_x0, outer_y0, outer_x1, outer_y0 + RING),
    ("top",    outer_x0, outer_y1 - RING, outer_x1, outer_y1),
    ("left",   outer_x0, outer_y0, outer_x0 + RING, outer_y1),
    ("right",  outer_x1 - RING, outer_y0, outer_x1, outer_y1),
]
for nm, x0, y0, x1, y1 in sides:
    print(f"  {nm:<6} ({x0:7.2f} {y0:7.2f})-({x1:7.2f} {y1:7.2f})")
print()

print("[geometric] the four sides must form a frame, not a filled block")
# Tuple layout is (name, x0, y0, x1, y1) -- index 4 is y1, index 3 is x1.
# The first version compared x1 against a y value, which is why all three
# geometric checks failed while the rasterisation proved the frame was correct.
check("bottom side is below the opening", sides[0][4] <= inner_y0 + 1e-9,
      f"bottom top y {sides[0][4]:.2f} <= opening bottom y {inner_y0:.2f}")
check("top side is above the opening", sides[1][2] >= inner_y1 - 1e-9,
      f"top bottom y {sides[1][2]:.2f} >= opening top y {inner_y1:.2f}")
check("no vertical overlap between the horizontal sides",
      sides[0][4] < sides[1][2],
      f"{sides[0][4]:.2f} < {sides[1][2]:.2f} (they must NOT overlap, or the frame fills in)")

print()
print("[clearance] ring to the device implants")
# The ring is OUTSIDE the implant, so the gap is (implant edge - ring's inner edge).
# The previous version subtracted the other way round and reported -0.28 for a
# correct 0.28 gap -- a check whose sign is inverted is worse than no check.
gap_x = (SNx0 - sides[2][3])
gap_y = (SN_BOTTOM - sides[0][4])
check("AA_4 from SN's edge (x)", gap_x >= AA_SP - 1e-9, f"{gap_x:.2f} >= {AA_SP}")
check("ring's SP clear of SN (x)", gap_x >= SN_RING_GAP + SP_ENC - 1e-9,
      f"{gap_x:.2f} >= {SN_RING_GAP + SP_ENC:.2f}")
check("ring's SP clear of SN (y)", gap_y >= SN_RING_GAP + SP_ENC - 1e-9,
      f"{gap_y:.2f} >= {SN_RING_GAP + SP_ENC:.2f}")

# ── rasterise and count holes ──────────────────────────────────────────────
print()
print("[topological] rasterise at 10 nm and count components / holes")
SCALE = 100  # cells per um
W = int((outer_x1 - outer_x0) * SCALE) + 2
H = int((outer_y1 - outer_y0) * SCALE) + 2
grid = [[0] * W for _ in range(H)]


def fill(x0, y0, x1, y1):
    ix0 = int(round((x0 - outer_x0) * SCALE))
    ix1 = int(round((x1 - outer_x0) * SCALE))
    iy0 = int(round((y0 - outer_y0) * SCALE))
    iy1 = int(round((y1 - outer_y0) * SCALE))
    for y in range(max(0, iy0), min(H, iy1)):
        row = grid[y]
        for x in range(max(0, ix0), min(W, ix1)):
            row[x] = 1


for nm, x0, y0, x1, y1 in sides:
    fill(x0, y0, x1, y1)

# connected components of filled cells (4-neighbour)
seen = [[False] * W for _ in range(H)]
components = 0
for y in range(H):
    for x in range(W):
        if grid[y][x] and not seen[y][x]:
            components += 1
            stack = [(x, y)]
            seen[y][x] = True
            while stack:
                cx, cy = stack.pop()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and grid[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))

# holes: flood the EMPTY cells from the border; any empty cell not reached is a hole
empty_seen = [[False] * W for _ in range(H)]
stack = [(x, 0) for x in range(W)] + [(x, H - 1) for x in range(W)]
stack += [(0, y) for y in range(H)] + [(W - 1, y) for y in range(H)]
while stack:
    cx, cy = stack.pop()
    if not (0 <= cx < W and 0 <= cy < H):
        continue
    if grid[cy][cx] or empty_seen[cy][cx]:
        continue
    empty_seen[cy][cx] = True
    stack.extend([(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)])

hole_cells = 0
for y in range(H):
    for x in range(W):
        if not grid[y][x] and not empty_seen[y][x]:
            hole_cells += 1

print(f"        raster {W}x{H} cells at 10 nm")
print(f"        filled components : {components}")
print(f"        enclosed empty cells (a hole): {hole_cells}")
check("the ring is ONE connected piece", components == 1, f"{components} component(s)")
check("the ring has an enclosed opening", hole_cells > 0,
      f"{hole_cells} enclosed cell(s)" if hole_cells else "NO hole -- this is a solid bar, not a ring")

print()
print("=" * 74)
print(f"{len(failures)} failure(s)" if failures else "ALL CHECKS PASSED")
print("=" * 74)
print()
print("SKILL rows:")
for nm, x0, y0, x1, y1 in sides:
    print(f'    list("AA" {x0:.2f} {y0:.2f} {x1:.2f} {y1:.2f})    ; {nm}')
print(f'    list("SP" {outer_x0 - SP_ENC:.2f} {outer_y0 - SP_ENC:.2f} '
      f'{outer_x1 + SP_ENC:.2f} {outer_y1 + SP_ENC:.2f})')
