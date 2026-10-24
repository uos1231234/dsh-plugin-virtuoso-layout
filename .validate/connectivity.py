"""
Geometric connectivity of dsh_nmos12: which shapes actually touch, and therefore
which nets exist.

The question this answers: "is this layout connected, or is it a pile of pieces?"

It matters because LVS reported CORRECT with N=4, and that can be read two ways:
  - four TERMINALS of one device (correct for a library cell), or
  - four disconnected islands with a device label on one of them (wrong).
Only a connectivity walk tells them apart.

Method: two shapes are connected when they share a layer and OVERLAP or ABUT
within a tolerance of 1 nm (the database grid). Contacts connect the layer above
and below when they are covered by both. This is what Calibre does, done by hand
so the answer can be inspected rather than trusted.

Usage: python connectivity.py [cell]
"""

import sys

# dsh_nmos12, read back from cv~>shapes (layer, x0, y0, x1, y1)
RECTS = [
    # --- device ---------------------------------------------------------
    ("AA", 0.40, 0.00, 2.00, 1.20),
    ("GP", 1.11, -0.32, 1.29, 1.52),
    ("GP", 0.99, 1.30, 1.41, 2.19),
    ("SN", 0.22, -0.64, 2.18, 1.84),
    ("CT", 0.50, 0.10, 0.72, 0.32),
    ("CT", 0.50, 0.88, 0.72, 1.10),
    ("CT", 1.68, 0.10, 1.90, 0.32),
    ("CT", 1.68, 0.88, 1.90, 1.10),
    ("CT", 1.09, 1.87, 1.31, 2.09),
    ("M1", 0.36, -0.04, 0.80, 1.24),
    ("M1", 1.60, -0.04, 2.04, 1.24),
    ("M1", 1.03, 1.40, 1.37, 2.37),
    # --- tap ------------------------------------------------------------
    ("AA", 0.40, -1.23, 2.00, -0.79),
    ("SP", 0.17, -1.44, 2.23, -0.75),
    ("CT", 0.52, -1.11, 0.74, -0.89),
    ("CT", 1.66, -1.11, 1.88, -0.89),
    ("M1", 0.40, -1.42, 0.92, -0.74),
    ("M1", 1.48, -1.42, 2.00, -0.74),
    # --- n-well + pickup ------------------------------------------------
    ("NW", 0.30, 2.60, 2.40, 4.70),
    ("AA", 0.54, 2.84, 2.16, 4.46),
    ("SN", 0.36, 2.66, 2.34, 4.64),
    ("CT", 1.24, 3.54, 1.46, 3.76),
    ("M1", 1.10, 3.40, 1.60, 3.90),
]

LABELS = [
    ("M1", 0.58, 0.60, "D"),
    ("M1", 1.82, 0.60, "S"),
    ("M1", 1.20, 2.10, "G"),
    ("M1", 0.66, -1.10, "B"),
]

TOL = 0.001  # 1 nm


def overlap(a, b, tol=TOL):
    """Do two rectangles touch or overlap?"""
    return not (
        a[3] < b[1] - tol or b[3] < a[1] - tol
        or a[4] < b[2] - tol or b[4] < a[2] - tol
    )


def contains(outer, inner, tol=TOL):
    return (
        outer[1] <= inner[1] + tol and outer[2] <= inner[2] + tol
        and outer[3] >= inner[3] - tol and outer[4] >= inner[4] - tol
    )


def center(r):
    return ((r[1] + r[3]) / 2, (r[2] + r[4]) / 2)


def inside_point(r, p, tol=TOL):
    return (r[1] - tol <= p[0] <= r[3] + tol) and (r[2] - tol <= p[1] <= r[4] + tol)


# ── build the graph ─────────────────────────────────────────────────────────
n = len(RECTS)
parent = list(range(n))


def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def union(i, j):
    ri, rj = find(i), find(j)
    if ri != rj:
        parent[ri] = rj


# same-layer overlap or abut
for i in range(n):
    for j in range(i + 1, n):
        if RECTS[i][0] == RECTS[j][0] and overlap(RECTS[i], RECTS[j]):
            union(i, j)

# a contact connects the layers it is covered by
for i, c in enumerate(RECTS):
    if c[0] != "CT":
        continue
    for j, s in enumerate(RECTS):
        if s[0] in ("AA", "GP") and contains(s, c):
            union(i, j)
        if s[0] == "M1" and contains(s, c):
            union(i, j)

groups = {}
for i, r in enumerate(RECTS):
    groups.setdefault(find(i), []).append(i)

print("=" * 74)
print("Connectivity of the layout -- what is actually one object")
print("=" * 74)
print()

for gi, (root, members) in enumerate(sorted(groups.items(), key=lambda kv: -len(kv[1])), 1):
    layers = sorted({RECTS[m][0] for m in members})
    xs = [RECTS[m][k] for m in members for k in (1, 3)]
    ys = [RECTS[m][k] for m in members for k in (2, 4)]
    print(f"NET {gi}: {len(members)} shape(s), layers {layers}")
    print(f"       bbox ({min(xs):.2f} {min(ys):.2f})-({max(xs):.2f} {max(ys):.2f})")
    for m in members:
        r = RECTS[m]
        print(f"         {r[0]:<3} ({r[1]:6.2f} {r[2]:6.2f})-({r[3]:6.2f} {r[4]:6.2f})")

    # which labels land on this net?
    here = []
    for lay, lx, ly, name in LABELS:
        for m in members:
            r = RECTS[m]
            if r[0] == lay and inside_point(r, (lx, ly)):
                here.append(name)
                break
    print(f"       labels: {here if here else 'NONE'}")
    print()

print("=" * 74)
print(f"{len(groups)} separate objects")
print("=" * 74)
print()

# ── the specific worry ──────────────────────────────────────────────────────
print("Does the N-well pickup connect to anything else?")
nw_root = find(next(i for i, r in enumerate(RECTS) if r[0] == "NW"))
nw_members = [i for i in range(n) if find(i) == nw_root]
nw_layers = sorted({RECTS[m][0] for m in nw_members})
dev_root = find(next(i for i, r in enumerate(RECTS) if r[0] == "AA" and r[2] >= 0))
dev_layers = sorted({RECTS[m][0] for m in groups[dev_root]})
print(f"  the NW group contains: {nw_layers}")
print(f"  device group layers : {dev_layers}")
print()
if "M1" in nw_layers:
    print("  The well pickup has its own M1 rectangle but it does NOT touch the")
    print("  device metal, so the well is a floating net: a labelled, DRC-clean,")
    print("  electrically pointless island unless something ties it to VDD.")
print()
print("Expected for a real NMOS cell: D, G, S, B as four terminals, all reachable,")
print("plus a substrate tie that is LOW IMPEDANCE and distributed around the device")
print("(a guard ring), not a single small tap on one side.")
