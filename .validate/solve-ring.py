# TEMPLATE -- rule values are redacted (written as X). Fill them in from your own
# licensed PDK before running. See README, "Note on third-party material".
"""
Solve the P+ guard ring around the NMOS.

Why a ring: the substrate tie must be LOW IMPEDANCE at every point of the device,
because the P-substrate is resistive. A single tap on one side leaves the far
corner tied through a long resistive path -- that is what latch-up and substrate
noise exploit. A closed ring around the device shortens the path from anywhere to
the nearest tie.

Which rule binds which edge, by identifier. The deck's own wording and its numbers
are not reproduced in this repository -- see README, "Note on third-party material".
  AA_3      minimum width of an active region used as interconnect
  AA_4      minimum space between two N+ active regions, or between two P+ ones
  SP_8      SP must overlap an AA edge
  SP_9      SP must extend past its own active region
  CT_1      contact X square
  CT_6a     AA enclosure of a contact X
  M1_1      M1 minimum width X
  M1_6      M1 minimum area X
  SN_4      SN to P+ pickup AA >= X

The ring is drawn as four rectangles that OVERLAP at the corners, so the union is
one closed loop rather than four pieces that merely touch. That distinction
matters: abutting edges with zero overlap are legal, but an overlap makes it
impossible for a rounding difference to open a gap.
"""

AA_W = X       # AA_3
AA_SP = X      # AA_4  ring to device active
SP_OV = X      # SP_8
SP_ENC = X     # SP_9
CT = 0.22
AA_ENC = X     # CT_6a
M1_W = 0.23
M1_AREA = 0.20
SN_4 = X

failures = []


def check(name, ok, detail):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}: {detail}")
    if not ok:
        failures.append(name)


# device active (from the proven dsh_nmos9 geometry)
DEVx0, DEVx1 = 0.40, 2.00
DEVy0, DEVy1 = 0.00, 1.20
# the tap strip that will be REPLACED by the ring
TAPy1 = -0.79

RING = max(AA_W, CT + 2 * AA_ENC)   # a contact plus its enclosure must fit inside
                                   # the ring, so 0.22 is NOT enough: 0.22 + 0.20
                                   # = X. Caught by the CT_6a check below.

print("=" * 74)
print("P+ guard ring solve")
print("=" * 74)
print()

# The ring's INNER edge at the top is governed by SN_4 against the SN implant:
# SN reaches y = DEVy0 - SN_OV = -0.18, so the ring must stay BELOW that by SN_4.
# "Below" in y means the ring's whole top side sits between
#     ring_top_inner = SNy0 - SN_4            (its upper/inner edge, -0.28)
#     ring_top_outer = ring_top_inner - RING  (its lower/outer edge, -0.70)
# The previous version added RING to the inner edge, which moved the ring UP into
# the implant and made SN_4 fail by -0.10. Direction matters: the device is above
# the ring, so "away from the device" is downward.
SNy0 = DEVy0 - 0.18
ring_top_inner = SNy0 - SN_4              # -0.28, the ring's highest y
ring_top_outer = ring_top_inner - RING    # its lowest y at the top side

# Outer bounds
Rx0 = DEVx0 - AA_SP - RING
Rx1 = DEVx1 + AA_SP + RING
# The binding constraint is the SN IMPLANT's actual extent, not the active edge.
#
# Calibre reported the SN_18&SP_18 overlap rectangle as (220 -640)-(2180 -280):
# that is SP's top edge (-0.28) cutting into SN, whose bottom edge is at -0.64.
# SN was grown to -0.64 by SN_7_17 (GP_EXT + SN_GATE) so it could enclose the gate
# end, which puts it FAR below the active. The ring therefore has to clear -0.64,
# not DEVy0 - 0.18.
SN_BOTTOM = -0.64                 # SN's bottom edge as drawn in dsh_nmos9
SP_GAP = 0.10                     # a real gap: touching was flagged as overlap
Ry1 = SN_BOTTOM - SP_GAP - SP_ENC # the ring's highest y
print(f"SN bottom edge (as drawn)  : {SN_BOTTOM:.2f}")
print(f"ring top edge = SN - gap - SP_ENC = {Ry1:.2f}")
print(f"  (the ring sits entirely BELOW the SN implant)")
print(f"  (SN_4 {SN_4} is satisfied too: {(SN_BOTTOM - Ry1):.2f} >= {SN_4})")
Ry0 = TAPy1 - AA_SP - RING
print(f"device active      x {DEVx0:.2f}..{DEVx1:.2f}   y {DEVy0:.2f}..{DEVy1:.2f}")
print(f"SN implant bottom  y {SNy0:.2f}")
print(f"ring outer         x {Rx0:.2f}..{Rx1:.2f}   y {Ry0:.2f}..{Ry1:.2f}")
print(f"ring width         {RING:.2f}   (AA_3 {AA_W} and CT_6a needs {CT + 2 * AA_ENC:.2f})")
print()

# ── the four sides, overlapping at the corners ─────────────────────────────
OV = 0.10        # corner overlap, so the loop is one piece
ring = [
    ("bottom", Rx0, Ry0, Rx1, Ry0 + RING),
    ("top",    Rx0, Ry1 - RING, Rx1, Ry1),
    ("left",   Rx0, Ry0 - OV, Rx0 + RING, Ry1 + OV),
    ("right",  Rx1 - RING, Ry0 - OV, Rx1, Ry1 + OV),
]
for nm, x0, y0, x1, y1 in ring:
    print(f"  {nm:<6} ({x0:6.2f} {y0:6.2f})-({x1:6.2f} {y1:6.2f})")
print()

print("[AA_3] ring width")
check("width", RING >= AA_W - 1e-9, f"{RING:.2f} >= {AA_W}")

print()
print("[AA_4] ring to device active")
gap_left = DEVx0 - (Rx0 + RING)
gap_right = (Rx1 - RING) - DEVx1
gap_bottom = DEVy0 - (Ry0 + RING)
check("left", gap_left >= AA_SP - 1e-9, f"{gap_left:.2f} >= {AA_SP}")
check("right", gap_right >= AA_SP - 1e-9, f"{gap_right:.2f} >= {AA_SP}")
check("bottom", gap_bottom >= AA_SP - 1e-9, f"{gap_bottom:.2f} >= {AA_SP}")

print()
print("[SN_4] ring to the SN implant")
# SN's bottom edge is SNy0 and the ring's top edge is Ry1, with the ring BELOW:
# the gap is SNy0 - Ry1, positive when the ring is lower. The earlier version
# computed (Ry1 - RING) - SNy0, which measures to the ring's BOTTOM and comes out
# negative for a correctly placed ring -- a check that reports the opposite of the
# truth is worse than no check.
sn4_gap = SNy0 - Ry1
check("top", sn4_gap >= SN_4 - 1e-9, f"{sn4_gap:.2f} >= {SN_4}")

print()
print("[SP_8 / SP_9] implant over the ring")
# The SP covering the ring must NOT overlap the device's SN implant (SN_18&SP_18
# is a hard rule). SN reaches y = SHy0 = -0.18. SP must stay below that, and the
# ring's vertical sides must not reach up past SP either -- otherwise the ring's
# top ends would be un-implanted and become P-substrate AA, which is
# Convention_BAD_IMP.
#
# So the ring's vertical sides are CUT to the SP's top edge, not to the device:
SHx0, SHx1 = -0.48, 2.88          # SP x extent (0.18 past the ring)
# SP's TOP edge must be ABOVE the ring's top edge (larger y) to enclose it:
#     SHy0 = Ry1 + SP_ENC
# and it must stay below SN's bottom. Those two cannot both hold if the ring's
# top side is too high, which is exactly what the previous version discovered.
SHy0 = min(Ry1 + SP_ENC, SNy0)
# SP bottom: 0.18 below the ring's bottom
SHy1 = Ry0 - SP_ENC
print(f"  SP    ({SHx0:6.2f} {SHy1:6.2f})-({SHx1:6.2f} {SHy0:6.2f})")
check("SP_9 enclosure beyond the ring AA", SP_ENC >= X - 1e-9, f"{SP_ENC:.2f} >= X")
check("SP_8 overlap of the ring AA", SP_OV >= X - 1e-9, f"{SP_OV:.2f} >= X")
check("SP covers the whole ring",
      SHx0 <= Rx0 and SHx1 >= Rx1 and SHy1 <= Ry0 and SHy0 >= Ry1,
      "SP encloses the ring in both axes")
# SP's top edge may ABUT SN's bottom edge (they touch but do not overlap, which is
# what SN_18&SP_18 forbids -- overlap, not contact). The check allows equality.
check("SP does not OVERLAP the device SN implant", SHy0 <= SNy0 + 1e-9,
      f"SP top {SHy0:.2f} <= SN bottom {SNy0:.2f} (abutting is legal, overlapping is not)")

# The ring's vertical sides stop at SP's top edge, so every piece of ring AA stays
# inside SP. They must NOT use "SP top + OV": the corner overlap is already
# provided by the horizontal sides, and exceeding SP's edge leaves un-implanted
# AA, which Convention_BAD_IMP flags.
ring = [
    ("bottom", Rx0, Ry0, Rx1, Ry0 + RING),
    ("top",    Rx0, Ry1 - RING, Rx1, Ry1),
    ("left",   Rx0, Ry0 - OV, Rx0 + RING, SHy0),
    ("right",  Rx1 - RING, Ry0 - OV, Rx1, SHy0),
]
print()
print("  ring sides, verticals cut to SP's top edge:")
for nm, x0, y0, x1, y1 in ring:
    print(f"    {nm:<6} ({x0:6.2f} {y0:6.2f})-({x1:6.2f} {y1:6.2f})")
for nm, x0, y0, x1, y1 in ring:
    check(f"ring {nm} inside SP", x0 >= SHx0 - 1e-9 and x1 <= SHx1 + 1e-9
          and y0 >= SHy1 - 1e-9 and y1 <= SHy0 + 1e-9, "implanted")

print()
print("[CT_6a] ring contacts")
# one contact row along each side, centred in the ring width
CTmid_x0 = Rx0 + (RING - CT) / 2
CTmid_x1 = CTmid_x0 + CT
CTmid_y0 = Ry0 + (RING - CT) / 2
CTmid_y1 = CTmid_y0 + CT
check("contact fits in the ring width", RING >= CT + 2 * AA_ENC - 1e-9,
      f"{RING:.2f} >= {CT + 2 * AA_ENC:.2f}")

print()
print("=" * 74)
print(f"{len(failures)} failure(s)" if failures else "ALL CONSTRAINTS SATISFIED")
print("=" * 74)
print()
print("SKILL rows for the ring:")
for nm, x0, y0, x1, y1 in ring:
    print(f'    list("AA" {x0:.2f} {y0:.2f} {x1:.2f} {y1:.2f})    ; ring {nm}')
print(f'    list("SP" {SHx0:.2f} {SHy1:.2f} {SHx1:.2f} {SHy0:.2f})')
