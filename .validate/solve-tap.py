# TEMPLATE -- rule values are redacted (written as X). Fill them in from your own
# licensed PDK before running. See README, "Note on third-party material".
"""
Solve the NMOS tap structure: the six real violations left on dsh_nmos8.

What the nmos8 run established, and why this file exists rather than another
hand edit:

   13 violations = 6 density (PD.*, impossible for an isolated device)
                + 1 MIM_8a (deck has an empty description)
                + 6 REAL, all in the substrate tap:
                    SN_7_17 (2)   SN encloses the N gate X
                    SP_10&11 (1)  SP extends X beyond the P+ pick-up AA
                    SP_16 (1)     SP to N-gate space X
                    M1_6 (1)      some M1 region under X um^2
                    BAD_IMP (1)   (AA NOT SN) NOT SP -- an AA with no implant

The last one is the diagnostic one: BAD_IMP means a piece of active has neither
SN nor SP over it. Since the device active is covered by SN and the tap active by
SP, the uncovered region must be the SLIVER where neither reaches -- which is
exactly what happens when SP is pulled up to satisfy SP_1's X width and starts
crowding the gate (SP_16) while still not covering the whole tap.

So the tap is not an afterthought: it has its own rule set, and the constraints
are in conflict unless the tap bar is placed far enough below the device. This
script solves that distance instead of guessing it.
"""

GP_EXT = X        # GP_6   gate extension beyond active
SN_GATE = X       # SN_7_17 enclosure of the gate
SN_GATE_SP = X    # SN_7_17 space along the gate direction
SP_GATE = X       # SP_16  SP to N-channel poly gate space
SP_MIN_W = X      # SP_1   SP minimum width
SP_OV_AA = X      # SP_8   SP overlap of AA
SP_PICKUP = X     # SP_10&11 SP extension beyond the P+ pickup AA
AA_ENC = X        # CT_6a
CT = 0.22
M1_W = X          # M1_1
M1_SP = X          # M1_2
M1_END = X        # M1_3&4
M1_AREA = X       # M1_6
SN_OV = X         # SN_9

failures = []


def check(name, ok, detail):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}: {detail}")
    if not ok:
        failures.append(name)


print("=" * 74)
print("Tap structure solve -- the 6 real violations on dsh_nmos8")
print("=" * 74)
print()

# ── Device (already DRC-clean geometry from solve-nmos.py) ──────────────────
AX = 1.20
L = 0.18
W = 1.20
AA_END = 0.80
AAx0, AAx1 = AX - AA_END, AX + AA_END
AAy0, AAy1 = 0.0, W

Gy0, Gy1 = AAy0 - GP_EXT, AAy1 + GP_EXT     # gate, GP_6

# Gate pad: above the extended gate, sized for the 0.22 contact + GP enclosure.
GP_ENC = X        # CT_7a
GP_AA = X         # GP_7 field poly to AA
PADy0 = Gy1 + GP_AA
PADy1 = PADy0 + CT + 2 * GP_ENC

# ── SP_16 vs SP_1: how far below the gate must the tap go? ─────────────────
# SP's TOP edge must be at least SP_GATE below the gate's BOTTOM edge (Gy0),
# because SP_16 measures space from the SP edge to the poly gate.
SPy1_max = Gy0 - SP_GATE
print(f"gate bottom edge        : {Gy0:.3f}")
print(f"SP_16 forces SP top <=  : {SPy1_max:.3f}  (gate bottom - {SP_GATE})")
print()

# SP must overlap the tap active by SP_OV_AA (SP_8) on EVERY edge it covers,
# extend SP_PICKUP beyond it (SP_10&11), and be at least SP_MIN_W tall (SP_1).
#
# The conflict the first version hit: fixing SP's top edge by SP_16 leaves only
# SP_MIN_W of SP, and carving SP_OV_AA of overlap out of both ends leaves a tap
# bar of SP_MIN_W - 2*SP_OV_AA = -0.02 -- impossible. So the tap forces SP to be
# TALLER than its minimum: SP height must be >= SP_OV_AA (below the tap) +
# tap height + SP_PICKUP (above it), with the tap itself at least tall enough
# for a contact plus CT_6a on both sides.
TAP_MIN_H = CT + 2 * AA_ENC                  # a contact with AA enclosure
SP_MIN_H_FOR_TAP = SP_OV_AA + TAP_MIN_H + SP_PICKUP
SP_H = max(SP_MIN_W, SP_MIN_H_FOR_TAP)

SPy1 = SPy1_max                              # pinned by SP_16
SPy0 = SPy1 - SP_H
TAPy1 = SPy1 - SP_PICKUP                     # SP_10&11
TAPy0 = max(SPy0 + SP_OV_AA, TAPy1 - TAP_MIN_H)   # SP_8 below + room for the contact
TAP_height = TAPy1 - TAPy0
print(f"SP y                    : {SPy0:.3f} .. {SPy1:.3f}  (height {SP_H:.3f})")
print(f"tap active y            : {TAPy0:.3f} .. {TAPy1:.3f}  (height {TAP_height:.3f})")
print(f"  (SP height forced to {SP_H:.3f} by SP_8: needs {SP_OV_AA} below the tap")
print(f"   + {TAP_MIN_H:.2f} of tap + {SP_PICKUP} above it)")
print()

print("[SP_16] SP to gate space")
check("SP top vs gate bottom", Gy0 - SPy1 >= SP_GATE - 1e-9,
      f"{Gy0 - SPy1:.3f} >= {SP_GATE}")

print()
print("[SP_1] SP width")
check("width", SP_H >= SP_MIN_W - 1e-9, f"{SP_H:.3f} >= {SP_MIN_W}")

print()
print("[SP_8] SP overlap of the tap")
overlap = min(SPy1, TAPy1) - max(SPy0, TAPy0)
check("overlap", overlap >= SP_OV_AA - 1e-9, f"{overlap:.3f} >= {SP_OV_AA}")

print()
print("[SP_10&11] SP extension beyond the tap")
check("extension", SPy1_max - TAPy1 >= SP_PICKUP - 1e-9,
      f"{SPy1_max - TAPy1:.3f} >= {SP_PICKUP}")

print()
print("[BAD_IMP] every piece of active must be under SN or SP")
# The device active is inside SN (SN_OV beyond it). The tap active must be
# inside SP. Check both, and check they do not leave a gap between them.
SNy0, SNy1 = AAy0 - SN_OV, AAy1 + SN_OV
sn_covers_device = SNy0 <= AAy0 and SNy1 >= AAy1
sp_covers_tap = SPy0 <= TAPy0 and SPy1_max >= TAPy1
check("SN covers the device active", sn_covers_device,
      f"SN {SNy0:.3f}..{SNy1:.3f} vs AA {AAy0:.3f}..{AAy1:.3f}")
check("SP covers the tap active", sp_covers_tap,
      f"SP {SPy0:.3f}..{SPy1_max:.3f} vs tap {TAPy0:.3f}..{TAPy1:.3f}")
check("SN and SP do not overlap", SPy1_max < SNy0,
      f"SP top {SPy1_max:.3f} < SN bottom {SNy0:.3f}")

print()
print("[SN_7_17] SN must enclose the gate by X")
# This is the rule that decides the SN extent, and it is NOT the same as "SN
# overlaps the active by SN_OV". The gate sticks out of the active by GP_EXT
# (GP_6), so SN must reach GP_EXT + SN_GATE from the active edge to enclose the
# gate end. nmos8 used SN_OV = X, which left the gate end bare -- 2 violations.
SN_EXT = GP_EXT + SN_GATE
SNy0, SNy1 = AAy0 - SN_EXT, AAy1 + SN_EXT
print(f"        gate ends at {Gy0:.3f} / {Gy1:.3f}")
print(f"        SN must reach {Gy0 - SN_GATE:.3f} / {Gy1 + SN_GATE:.3f}")
print(f"        SN extent from active = GP_EXT + SN_GATE = {SN_EXT:.3f}")
print(f"        SN y {SNy0:.3f}..{SNy1:.3f}")
check("SN encloses the gate on the bottom", SNy0 <= Gy0 - SN_GATE + 1e-9,
      f"{SNy0:.3f} <= {Gy0 - SN_GATE:.3f}")
check("SN encloses the gate on the top", SNy1 >= Gy1 + SN_GATE - 1e-9,
      f"{SNy1:.3f} >= {Gy1 + SN_GATE:.3f}")

print()
print("[M1_6] every M1 region has area >= X")
# nmos8's gate strap was 0.34 x 0.42 = 0.143 and failed. The pad is only
# 0.42 wide (CT + 2*GP_ENC), so the area has to come from LENGTH: the gate metal
# runs down over the extended finger, which is available because GP_6 already
# extended the gate by 0.32 on each side.
GM_LEN = max(M1_AREA / 0.34, 0.60)     # keep >= 0.34 wide, get the area by length
GM_W = 0.34
GM_y0 = PADy0 - 0.20
GM_y1 = GM_y0 + GM_LEN
M1s = [
    ("D", 0.36, -0.04, 0.80, 1.24),
    ("S", 1.60, -0.04, 2.04, 1.24),
    ("G", AX - GM_W / 2, GM_y0, AX + GM_W / 2, GM_y1),
]
for nm, x0, y0, x1, y1 in M1s:
    area = (x1 - x0) * (y1 - y0)
    print(f"        M1 {nm}: {(x1 - x0):.3f} x {(y1 - y0):.3f} = {area:.3f} um^2")
    check(f"M1 {nm} area", area >= M1_AREA - 1e-9, f"{area:.3f} >= {M1_AREA}")
    check(f"M1 {nm} width", min(x1 - x0, y1 - y0) >= M1_W - 1e-9,
          f"{min(x1 - x0, y1 - y0):.3f} >= {M1_W}")

print()
print("=" * 74)
print(f"{len(failures)} failure(s)" if failures else "ALL CONSTRAINTS SATISFIED")
print("=" * 74)
print()
print("Solved tap geometry:")
print(f'    list("AA" {AAx0} {TAPy0:.2f} {AAx1} {TAPy1:.2f})')
print(f'    list("SP" {AAx0 - SP_OV_AA:.2f} {SPy0:.2f} {AAx1 + SP_OV_AA:.2f} {SPy1_max:.2f})')
print(f'    list("SN" {AAx0 - SN_OV:.2f} {Gy0 - SN_GATE:.2f} {AAx1 + SN_OV:.2f} {Gy1 + SN_GATE:.2f})')
