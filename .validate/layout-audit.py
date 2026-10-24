"""
Audit the DSH_NMOS/dsh_nmos layout for symmetry and process-standard violations.

Why this exists: the claim "the layout looks asymmetric" is a judgement, and a
judgement cannot be fixed. This turns it into measurements with a verdict per
rule, so the fix is a list of moves rather than a re-draw.

Every check prints PASS/FAIL plus the measured numbers. Coordinates are the ones
read back from the live Virtuoso database, not from the script that drew them —
the point is to test what is actually in the cellview.

Usage: python layout-audit.py
"""

import sys

# (layer, purpose, x0, y0, x1, y1) exactly as reported by cv~>shapes
RECTS = [
    ("AA", 0.300,  0.000, 2.100,  1.200),
    ("AA", 0.300, -0.900, 2.100, -0.500),
    ("GP", 1.110, -0.300, 1.290,  1.680),
    ("GP", 1.030,  1.200, 1.370,  1.680),
    ("SN", 0.200, -0.100, 2.200,  1.300),
    ("SP", 0.200, -1.000, 2.200, -0.400),
    ("CT", 1.090,  1.320, 1.310,  1.540),
    ("CT", 0.600,  0.160, 0.820,  0.380),
    ("CT", 0.600,  0.720, 0.820,  0.940),
    ("CT", 1.580,  0.160, 1.800,  0.380),
    ("CT", 1.580,  0.720, 1.800,  0.940),
    ("CT", 0.990, -0.810, 1.210, -0.590),
    ("CT", 1.610, -0.810, 1.830, -0.590),
    ("M1", 1.010,  1.240, 1.390,  1.620),
    ("M1", 0.500,  0.100, 0.900,  1.000),
    ("M1", 1.500,  0.100, 1.900,  1.000),
    ("M1", 0.910, -0.880, 1.290, -0.520),
    ("M1", 1.530, -0.880, 1.910, -0.520),
]

# The audit is meant to be re-run against the NEXT cell too, so a plain
# "layer x0 y0 x1 y1" text dump from cv~>shapes can replace the table above:
#
#   virtuoso_eval '...' | python layout-audit.py --rects rects.txt
#
# One line per rectangle. This keeps the rules in one place and stops the second
# layout from being judged by a different, hand-written standard.
if '--rects' in sys.argv:
    path = sys.argv[sys.argv.index('--rects') + 1]
    RECTS = []
    with open(path) as handle:
        for line in handle:
            parts = line.split()
            if len(parts) == 5:
                layer = parts[0]
                RECTS.append((layer, *(float(v) for v in parts[1:])))

failures = []
passes = []


def check(name, ok, detail):
    (passes if ok else failures).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"        {detail}")


def by_layer(layer):
    return [r for r in RECTS if r[0] == layer]


def cx(r):
    return (r[1] + r[3]) / 2.0


def cy(r):
    return (r[2] + r[4]) / 2.0


def w(r):
    return round(r[3] - r[1], 4)


def h(r):
    return round(r[4] - r[2], 4)


print("=" * 74)
print("DSH_NMOS / dsh_nmos — symmetry and process audit")
print("=" * 74)
print()

# ── The reference axis ────────────────────────────────────────────────────────
# A MOS device is left-right symmetric about its centre. If the drawn geometry
# has one, that is the axis every other check should be measured against.
all_x = [r[1] for r in RECTS] + [r[3] for r in RECTS]
drawing_centre = (min(all_x) + max(all_x)) / 2.0
print(f"drawing bbox x: {min(all_x):.3f} .. {max(all_x):.3f}")
print(f"geometric centre x = {drawing_centre:.3f}")
print()

# ── 1. Gate finger position ───────────────────────────────────────────────────
print("[1] Gate finger is centred on the device")
gate = [r for r in by_layer("GP") if h(r) > 1.0][0]
gate_cx = cx(gate)
# The device body is the upper AA bar.
body = [r for r in by_layer("AA") if r[4] > 0][0]
body_cx = cx(body)
offset = gate_cx - body_cx
check(
    "gate finger centred on the AA body",
    abs(offset) < 1e-9,
    f"gate centre x={gate_cx:.3f}, AA body centre x={body_cx:.3f}, "
    f"offset={offset:+.3f} um",
)
gate_len = w(gate)
check(
    "gate length = 0.18 um (SMIC 0.18 drawn gate)",
    abs(gate_len - 0.18) < 1e-9,
    f"drawn gate length = {gate_len:.3f} um",
)

# ── 2. Contact symmetry about the gate ───────────────────────────────────────
print()
print("[2] Contacts are symmetric about the gate axis")
drain_cts = [r for r in by_layer("CT") if cx(r) < gate_cx]
source_cts = [r for r in by_layer("CT") if cx(r) > gate_cx]
print(f"        {len(drain_cts)} contact(s) left of gate, {len(source_cts)} right")
check(
    "equal contact count on each side of the gate",
    len(drain_cts) == len(source_cts),
    f"left={len(drain_cts)}, right={len(source_cts)}",
)
if len(drain_cts) == len(source_cts) and drain_cts:
    # Mirror every left contact about the gate centre and find its partner.
    worst = 0.0
    for left in sorted(drain_cts, key=cy):
        mirrored = 2 * gate_cx - cx(left)
        partner = min(source_cts, key=lambda r: abs(cx(r) - mirrored) + abs(cy(r) - cy(left)))
        dx = abs(cx(partner) - mirrored)
        dy = abs(cy(partner) - cy(left))
        worst = max(worst, dx, dy)
    check(
        "each contact has a mirrored partner across the gate axis",
        worst < 1e-6,
        f"worst mirror error = {worst * 1000:.3f} nm",
    )
    # Also check the pair separation is what the design implies.
    left_xs = sorted({round(cx(r), 3) for r in drain_cts})
    right_xs = sorted({round(cx(r), 3) for r in source_cts})
    expected = [round(2 * gate_cx - x, 3) for x in left_xs]
    check(
        "contact column x-positions are exact mirrors",
        sorted(expected) == right_xs,
        f"left columns {left_xs} -> expected mirrors {sorted(expected)}, actual right {right_xs}",
    )

# ── 3. The implant / metal rectangles: same mirror test ──────────────────────
print()
print("[3] Overlay layers are symmetric about the gate axis")
for layer in ("SN", "SP"):
    for r in by_layer(layer):
        check(
            f"{layer} rectangle centred on the gate axis",
            abs(cx(r) - gate_cx) < 1e-9,
            f"{layer} centre x={cx(r):.3f}, gate axis x={gate_cx:.3f}, "
            f"offset={cx(r) - gate_cx:+.3f} um",
        )

for layer in ("M1",):
    rects = by_layer(layer)
    print(f"        {layer}: {len(rects)} rectangles")
    worst = 0.0
    for r in rects:
        mirrored = 2 * gate_cx - cx(r)
        partner = min(rects, key=lambda o: abs(cx(o) - mirrored) + abs(cy(o) - cy(r)))
        if partner is r:
            worst = max(worst, abs(cx(r) - gate_cx))
        else:
            worst = max(worst, abs(cx(partner) - mirrored), abs(cy(partner) - cy(r)))
    check(
        f"{layer} rectangles form a mirrored set (or sit on the axis)",
        worst < 1e-6,
        f"worst mirror error = {worst * 1000:.3f} nm",
    )

# ── 4. Enclosure / overlap rules (the "standard-ness" part) ─────────────────
print()
print("[4] Process enclosure rules (SMIC 0.18 typical minimums)")


def contains(a, b):
    """Does rectangle a fully contain rectangle b?"""
    return a[1] <= b[1] and a[2] <= b[2] and a[3] >= b[3] and a[4] >= b[4]


def margin(outer, inner):
    """Smallest enclosure of inner by outer, per side."""
    return min(inner[1] - outer[1], inner[2] - outer[2], outer[3] - inner[3], outer[4] - inner[4])


aa_rects = by_layer("AA")
ct_rects = by_layer("CT")
m1_rects = by_layer("M1")

# Not every contact belongs on active. A contact that lands on the gate pad is a
# GATE contact: it must sit inside GP and must NOT be inside AA (that would short
# gate to channel). Treating all contacts as diffusion contacts was a bug in the
# first version of this audit -- it flagged a correct gate contact as a defect.
gp_rects = by_layer("GP")


def on_gate(contact):
    return [g for g in gp_rects if contains(g, contact)]


for i, c in enumerate(ct_rects):
    if on_gate(c):
        margin_gp = max(margin(g, c) for g in on_gate(c))
        check(
            f"CT#{i + 1} is a GATE contact: inside GP, clear of AA",
            not any(contains(a, c) for a in aa_rects),
            f"inside GP with margin {margin_gp:.3f} um; "
            + ("correctly clear of AA" if not any(contains(a, c) for a in aa_rects) else "but it ALSO sits inside AA"),
        )
        continue
    inside = [a for a in aa_rects if contains(a, c)]
    check(
        f"CT#{i + 1} is a DIFFUSION contact: lies inside AA",
        bool(inside),
        f"CT bbox ({c[1]:.2f} {c[2]:.2f})-({c[3]:.2f} {c[4]:.2f}) "
        + (f"enclosed by AA with margin {min(margin(a, c) for a in inside):.3f} um" if inside else "NOT inside any AA"),
    )
# Every contact must be covered by metal.
for i, c in enumerate(ct_rects):
    covering = [m for m in m1_rects if contains(m, c)]
    check(
        f"CT#{i + 1} covered by M1",
        bool(covering),
        f"margin over contact = {min(margin(m, c) for m in covering):.3f} um" if covering else "no M1 covers this contact",
    )

# Implants must enclose active with the implant overlap margin.
for layer, target in (("SN", aa_rects[0]), ("SP", aa_rects[1])):
    imp = by_layer(layer)[0]
    check(
        f"{layer} encloses its AA bar with >= X um overlap",
        contains(imp, target) and margin(imp, target) >= 0.10 - 1e-9,
        f"{layer} margin = {margin(imp, target):.3f} um",
    )

# ── 5. Contact size vs SMIC minimum ─────────────────────────────────────────
print()
print("[5] Contact geometry")
sizes = {(w(c), h(c)) for c in ct_rects}
check("all contacts are the same 0.22 x 0.22 um", sizes == {(0.22, 0.22)}, f"observed sizes {sorted(sizes)}")

# ── 6. Alignment grid ────────────────────────────────────────────────────────
print()
print("[6] Everything on the 10 nm manufacturing grid")
off_grid = []
for r in RECTS:
    for v in (r[1], r[2], r[3], r[4]):
        if abs(v * 100 - round(v * 100)) > 1e-9:
            off_grid.append((r[0], v))
check("all edges are multiples of 0.01 um", not off_grid, f"off-grid edges: {off_grid[:6]}" if off_grid else "none")

# ── 7. The one rule that cannot be judged from the database ─────────────────
print()
print("=" * 74)
print(f"RESULT: {len(passes)} passed, {len(failures)} failed")
if failures:
    print()
    print("Failures:")
    for f in failures:
        print(f"  - {f}")
print("=" * 74)
print()
print("NOT CHECKED (needs a rule deck, not geometry):")
print("  - DRC spacing / width / notch rules against smic18ee")
print("  - Well and substrate tie requirements")
print("  - LOD / WPE / STI stress effects")
print("  - Whether the device W/L matches the intended schematic")
sys.exit(1 if failures else 0)
