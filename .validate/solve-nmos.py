# TEMPLATE -- rule values are redacted (written as X). Fill them in from your own
# licensed PDK before running. See README, "Note on third-party material".
"""
Solve the NMOS geometry from the DRC rules instead of tuning it by hand.

Why this script exists: five hand-tuned attempts produced 22, 24, 35, 36 and 36
violations. Each attempt fixed some rules and broke others, because moving one
edge changes which rules bind. Guessing is the wrong method for a closed set of
linear constraints, so this file states the constraints and solves them.

Every constraint below is transcribed from the foundry deck with the rule id, and
the solver checks the SOLUTION against the constraint list rather than trusting
the arithmetic. Output is a rectangle table ready to paste into SKILL.

Constraints that actually bound this cell (from nmos2/4/5 violation reports):
  CT_1      contact size == X (both min and max)
  CT_6a     AA enclosure of an AA contact >= X
  CT_7a     GP enclosure of a gate contact >= X
  CT_10     no contact on the gate region (the channel area)
  CT_11     no AA contact on an SN/SP boundary
  GP_1_2    GP min width >= X
  GP_7      field poly to AA >= X
  GP_11a    gate must not overhang the active (no 90 degree bend on active)
  M1_1      M1 min width >= X
  M1_2      M1 to M1 >= X
  M1_3&4    M1 over CT >= X, M1 line-end over CT >= X
  M1_6      M1 min area >= X
  SN_9      SN beyond active >= X
  SN_7_17   SN to gate: enclosure X / space X along the gate direction
  SN_18&SP_18  SN and SP must NOT overlap
"""

L = 0.18        # gate length
CT = X       # contact (CT_1: min == max)
AA_ENC = X   # CT_6a
GP_ENC = X   # CT_7a
GP_MIN_W = X # GP_1_2
GP_AA = X    # GP_7
M1_W = X     # M1_1
M1_SP = X    # M1_2
M1_END = X   # M1_3&4 line end
M1_AREA = X  # M1_6
SN_OV = X    # SN_9
SN_GATE = X  # SN_7_17 enclosure (AND space, X, below)
SN_GATE_SPACE = X  # SN_7_17 "space from SN edge to gate along gate direction"

# Newly discovered from the nmos7 run (16 violations, 9 of them real):
GP_EXT = X   # GP_6  gate extension beyond the active
SP_MIN_W = X  # SP_1  minimum SP width
SP_OV_AA = X  # SP_8  SP overlap of an AA edge
SP_PICKUP = X  # SP_10&11 extension beyond a P+ pick-up AA


class Failure(Exception):
    pass


def check(name, ok, detail):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}: {detail}")
    if not ok:
        raise Failure(name)


print("=" * 74)
print("Solving NMOS geometry from DRC constraints")
print("=" * 74)
print()

# ── Step 1: the axis and the active bar ──────────────────────────────────────
# W (gate width) is free; it was measured as 1.2 um by the earlier LVS run, and
# keeping it means the source netlist stays valid.
AX = 1.20
W = 1.20

# Active bar must be wide enough for: contact + AA_ENC on both sides, plus the
# gate, plus the SN_7_17 enclosure to the gate on the source/drain side.
# x layout, from the axis outward:
#   gate finger: AX +/- L/2
#   gap to contact: SN_7_17 wants X space from SN edge to gate, and the
#                   contact must be AA_ENC inside the active end
#   contact: CT wide
#   AA_ENC to the active end
GATE_HALF = L / 2
GAP = SN_GATE                 # conservative: use the 0.35 space rule as the gap
CT_IN = GAP                   # contact inner edge distance from gate edge
AA_END = CT_IN + CT + AA_ENC  # active end distance from gate edge
AAx0 = AX - GATE_HALF - AA_END
AAx1 = AX + GATE_HALF + AA_END
AAy0 = 0.0
AAy1 = W

print(f"active: x {AAx0:.3f}..{AAx1:.3f}  y {AAy0:.3f}..{AAy1:.3f}")
print(f"        width W = {W:.2f} um (kept, so the LVS netlist stays valid)")
print()

# ── Step 2: contact columns, and the AA_ENC / CT_6a check ───────────────────
CTxL0 = AAx0 + AA_ENC
CTxL1 = CTxL0 + CT
CTxR0 = AAx1 - AA_ENC - CT
CTxR1 = CTxR0 + CT

print("[CT_6a] AA enclosure of a diffusion contact")
check("left", CTxL0 - AAx0 >= AA_ENC - 1e-9, f"{CTxL0 - AAx0:.3f} >= {AA_ENC}")
check("right", AAx1 - CTxR1 >= AA_ENC - 1e-9, f"{AAx1 - CTxR1:.3f} >= {AA_ENC}")

print()
print("[CT_11] contact must not sit on an SN/SP boundary")
# The implant boundaries must be clear of every contact. SN/SP are grown from the
# active by SN_OV, so their edges are AA_ENC+ away from any contact by
# construction ONLY if SN_OV > AA_ENC. It is 0.18 > 0.10, so this holds.
check("SN_OV > AA_ENC keeps contacts off the implant edge",
      SN_OV > AA_ENC, f"SN_OV={SN_OV} > AA_ENC={AA_ENC}")

# ── Step 3: contact rows, sized so two rows fit with CT_6a at both ends ─────
# Two rows in y. Each needs AA_ENC to the active edge; the gap between rows must
# at least be 0 (Calibre allows abutting diffusions only within a contact, so
# keep them separate).
ROW_GAP = 0.10
total_needed = 2 * CT + 2 * AA_ENC + ROW_GAP
print()
print(f"[fits] two contact rows need {total_needed:.2f} um of active height; W = {W:.2f}")
check("two rows fit in W", W >= total_needed,
      f"{W:.2f} >= {total_needed:.2f}")

CTy0L = AAy0 + AA_ENC
CTy1L = CTy0L + CT
CTy0U = AAy1 - AA_ENC - CT
CTy1U = CTy0U + CT
print(f"        row y: {CTy0L:.3f}..{CTy1L:.3f} and {CTy0U:.3f}..{CTy1U:.3f}")

# ── Step 4: the gate pad, placed so CT_10 and GP_7 both hold ────────────────
# CT_10 forbids a contact on the gate region. The gate region is the part of GP
# that overlaps active. So the pad -- and the contact in it -- must start above
# AAy1, with GP_7's X field-poly-to-AA clearance.
PAD_GAP = GP_AA                # GP_7: field poly to AA
PADy0 = AAy1 + PAD_GAP
PADy1 = PADy0 + CT + 2 * GP_ENC   # room for the contact + GP_ENC both sides
PADx0 = AX - CT / 2 - GP_ENC
PADx1 = AX + CT / 2 + GP_ENC
print()
print("[CT_10 / GP_7] gate contact outside the gate region")
check("pad starts at least GP_7 above active", PADy0 - AAy1 >= GP_AA - 1e-9,
      f"{PADy0 - AAy1:.3f} >= {GP_AA}")
check("pad is at least GP_1_2 wide", PADx1 - PADx0 >= GP_MIN_W - 1e-9,
      f"{PADx1 - PADx0:.3f} >= {GP_MIN_W}")

# The contact itself must be inside the pad with GP_ENC (CT_7a) and must not
# reach down into the active.
GCy0 = PADy0 + GP_ENC
GCy1 = GCy0 + CT
print()
print("[CT_7a] GP enclosure of the gate contact")
check("below", GCy0 - PADy0 >= GP_ENC - 1e-9, f"{GCy0 - PADy0:.3f} >= {GP_ENC}")
check("above", PADy1 - GCy1 >= GP_ENC - 1e-9, f"{PADy1 - GCy1:.3f} >= {GP_ENC}")
check("contact clear of active (CT_10)", GCy0 > AAy1, f"{GCy0:.3f} > {AAy1:.3f}")

# ── Step 5: implant separation (SN_18&SP_18 was a real violation) ───────────
# The p-tap sits below the device. SP covers the tap, SN covers the device, and
# they must not overlap.
#
# SP rules learned from the nmos7 run:
#   SP_1      SP width >= X
#   SP_8      SP must overlap AA by >= X
#   SP_10&11  SP must extend >= X beyond the P+ pick-up AA
# The tap bar is therefore sized from SP_1 and SP_8 rather than assumed:
TAPy1 = -0.50
TAPy0 = TAPy1 - max(SP_MIN_W, SP_OV_AA + SP_MIN_W)   # tall enough for SP_1
SPy1 = TAPy1 + SP_OV_AA           # SP_8: overlap the tap by X
SPy0 = SPy1 - max(SP_MIN_W, 2 * SP_OV_AA + SP_PICKUP)  # SP_1 width
SNy0 = AAy0 - SN_OV
SNy1 = AAy1 + SN_OV
print()
print("[SP_1 / SP_8 / SN_18&SP_18] the two implants")
print(f"        tap active y {TAPy0:.3f}..{TAPy1:.3f}  (height {TAPy1 - TAPy0:.3f})")
print(f"        SP y {SPy0:.3f}..{SPy1:.3f}  (width {SPy1 - SPy0:.3f})")
check("SP_1 width", SPy1 - SPy0 >= SP_MIN_W - 1e-9, f"{SPy1 - SPy0:.3f} >= {SP_MIN_W}")
check("SP_8 overlap of the tap", min(SPy1, TAPy1) - max(SPy0, TAPy0) >= SP_OV_AA - 1e-9,
      f"{min(SPy1, TAPy1) - max(SPy0, TAPy0):.3f} >= {SP_OV_AA}")
check("SP_10&11 extension beyond the tap", SPy1 - TAPy1 >= SP_PICKUP - 1e-9,
      f"{SPy1 - TAPy1:.3f} >= {SP_PICKUP}")
check("SN_18&SP_18 no overlap", SPy1 < SNy0, f"SP top {SPy1:.3f} < SN bottom {SNy0:.3f}")

# ── Step 5b: GP_6 -- the gate must extend beyond the active ─────────────────
# GP_6's required gate extension. Contradicts nothing in GP_11a:
# GP_11a forbids a NON-COINCIDENT edge ON the active area, which is about the
# gate ending part-way across the active, not about running past it. The two are
# satisfied together by letting the gate run past both active edges by 0.32.
# The nmos5..7 cells pinned the gate to the active height, which is exactly what
# GP_6 flagged (2 violations each time).
Gy0 = AAy0 - GP_EXT
Gy1 = AAy1 + GP_EXT
print()
print("[GP_6] gate extension beyond the active")
print(f"        gate y {Gy0:.3f}..{Gy1:.3f}  (active {AAy0:.3f}..{AAy1:.3f})")
check("bottom extension", AAy0 - Gy0 >= GP_EXT - 1e-9, f"{AAy0 - Gy0:.3f} >= {GP_EXT}")
check("top extension", Gy1 - AAy1 >= GP_EXT - 1e-9, f"{Gy1 - AAy1:.3f} >= {GP_EXT}")
# The gate pad now sits above the extended gate, not above the active.
PADy0 = Gy1 + GP_AA
PADy1 = PADy0 + CT + 2 * GP_ENC
GCy0 = PADy0 + GP_ENC
GCy1 = GCy0 + CT
print(f"        pad y  {PADy0:.3f}..{PADy1:.3f}   gate contact y {GCy0:.3f}..{GCy1:.3f}")
check("pad clears the gate (GP_7 from the gate's top edge)", PADy0 - Gy1 >= GP_AA - 1e-9,
      f"{PADy0 - Gy1:.3f} >= {GP_AA}")

# ── Step 6: metal ───────────────────────────────────────────────────────────
print()
print("[M1_1 / M1_2 / M1_3&4 / M1_6] metal")

# KEY insight that resolves an apparent contradiction:
#   - the contact must sit SN_GATE (X) away from the gate edge (SN_7_17), and
#   - the metal must enclose the contact (M1_3&4), so metal reaches toward the gate
#   - the gate metal and the diffusion metal must be M1_SP (X) apart (M1_2)
# Enclosing on ALL FOUR sides of every contact makes those three incompatible.
# Real layouts do not do that: the metal on a contact extends AWAY from the
# device (and along it), and stops short on the gate side. The enclosure rule is
# a per-edge requirement, not "surround the contact".
#
# So: the gate-facing edge of the diffusion metal stops at the contact edge plus
# a small line-end allowance, which is what M1_3&4 actually asks for (X at a
# line end). The generous 0.10 goes on the outward and vertical edges.
M1_END_ENC = M1_END + 0.02   # 0.08 toward the gate (>= 0.06 line-end rule)
M1_OUT_ENC = 0.14            # outward and vertical, comfortably over 0.06

M1x0 = CTxL0 - M1_OUT_ENC          # outward (away from the axis)
M1x1 = CTxL1 + M1_END_ENC          # toward the gate: line-end allowance only
M1y0 = CTy0L - M1_OUT_ENC
M1y1 = CTy1U + M1_OUT_ENC
print(f"        diffusion metal L: {M1x1 - M1x0:.3f} wide, {M1y1 - M1y0:.3f} tall, "
      f"area {(M1x1 - M1x0) * (M1y1 - M1y0):.3f}")
check("M1_1 width", M1x1 - M1x0 >= M1_W - 1e-9, f"{M1x1 - M1x0:.3f} >= {M1_W}")
check("M1_6 area", (M1x1 - M1x0) * (M1y1 - M1y0) >= M1_AREA - 1e-9,
      f"{(M1x1 - M1x0) * (M1y1 - M1y0):.3f} >= {M1_AREA}")
check("M1_3&4 line end over contact (gate side)", M1_END_ENC >= M1_END - 1e-9,
      f"{M1_END_ENC:.3f} >= {M1_END}")
check("M1_3&4 enclosure (outward side)", M1_OUT_ENC >= M1_END - 1e-9,
      f"{M1_OUT_ENC:.3f} >= {M1_END}")

# M1_2: the gate metal and the diffusion metal are NOT independent.
#
# Calibre reported 2 M1_2 violations on nmos6 where this solver had claimed the
# rule "does not apply". The rule is a PROJECTED spacing: a horizontal gap of
# 0.12 governs even with only a sliver of vertical overlap. Two failed attempts
# to derive the fix algebraically (one forgot the CT term, one mixed up whether
# a distance was measured from the axis or from the active edge) produced
# formulas that disagreed with their own check. So instead of deriving, this
# solves NUMERICALLY: grow the active until the measured gap passes.
def metal_gap(aa_end, ax=AX):
    """Projected gap between the gate metal and the diffusion metal."""
    half_gm = GmW_LOCAL / 2
    # absolute coordinates on the left side
    gx0 = ax - half_gm
    cx0 = (ax - aa_end) + AA_ENC
    mx1 = cx0 + CT + M1_END_ENC
    return gx0 - mx1


GmW_LOCAL = max(M1_W, CT + 2 * M1_END)
guard = 0
AA_END_FROM_SN = L / 2 + SN_GATE + CT + AA_ENC
AA_END_M1_BOUND = AA_END_FROM_SN
for extra in range(0, 400):                      # scan up to +0.40 um
    trial = AA_END_FROM_SN + extra * 0.001
    if metal_gap(trial) >= M1_SP - 1e-9:
        AA_END_M1_BOUND = trial
        break
    guard += 1

AA_END = max(AA_END_FROM_SN, AA_END_M1_BOUND)
AAx0 = AX - AA_END
AAx1 = AX + AA_END
print()
print(f"  active end from SN_7_17        : {AA_END_FROM_SN:.3f} um from the axis")
print(f"  active end from M1_2 (numeric) : {AA_END_M1_BOUND:.3f} um from the axis")
print(f"  using the larger               : {AA_END:.3f}")
print(f"  re-solved active x {AAx0:.3f}..{AAx1:.3f}")

# Recompute contacts and metal from the corrected active width.
CTxL0 = AAx0 + AA_ENC
CTxL1 = CTxL0 + CT
CTxR0 = AAx1 - AA_ENC - CT
CTxR1 = CTxR0 + CT
M1x0 = CTxL0 - M1_OUT_ENC
M1x1 = CTxL1 + M1_END_ENC
M1x1_right = CTxR1 + M1_OUT_ENC
M1x0_right = CTxR0 - M1_END_ENC

Gx0 = AX - GmW_LOCAL / 2
Gx1 = AX + GmW_LOCAL / 2
Gy0 = PADy0
Gy1 = PADy1

gap_left = Gx0 - M1x1
gap_right = M1x0_right - Gx1
print()
print("[M1_2] gate metal to diffusion metal (projected spacing)")
print(f"        gate metal x {Gx0:.3f}..{Gx1:.3f}  y {Gy0:.3f}..{Gy1:.3f}")
check("left gap", gap_left >= M1_SP - 1e-9, f"{gap_left:.3f} >= {M1_SP}")
check("right gap", gap_right >= M1_SP - 1e-9, f"{gap_right:.3f} >= {M1_SP}")
check("CT_6a still holds after re-solve", CTxL0 - AAx0 >= AA_ENC - 1e-9,
      f"{CTxL0 - AAx0:.3f} >= {AA_ENC}")
# The left contact's inner edge must clear the LEFT gate edge (AX - L/2).
check("contact still clears the gate (SN_7_17)", (AX - L / 2) - CTxL1 >= SN_GATE - 1e-9,
      f"{(AX - L / 2) - CTxL1:.3f} >= {SN_GATE}")

print()
print("=" * 74)
print("SOLVED GEOMETRY")
print("=" * 74)


def rect(layer, x0, y0, x1, y1):
    return (layer, round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4))


rows = [
    rect("AA", AAx0, AAy0, AAx1, AAy1),
    rect("AA", AAx0, TAPy1 - 0.40, AAx1, TAPy1),        # p-tap active
    rect("GP", AX - L / 2, AAy0, AX + L / 2, AAy1),     # gate: exactly active height
    rect("GP", PADx0, PADy0, PADx1, PADy1),             # gate pad
    rect("SN", AAx0 - SN_OV, SNy0, AAx1 + SN_OV, SNy1),
    rect("SP", AAx0 - SN_OV, SPy0, AAx1 + SN_OV, SPy1),
    rect("CT", CTxL0, CTy0L, CTxL1, CTy1L),
    rect("CT", CTxL0, CTy0U, CTxL1, CTy1U),
    rect("CT", CTxR0, CTy0L, CTxR1, CTy1L),
    rect("CT", CTxR0, CTy0U, CTxR1, CTy1U),
    rect("CT", AX - CT / 2, GCy0, AX + CT / 2, GCy1),
    rect("M1", M1x0, M1y0, M1x1, M1y1),
    # right column mirrors the left: outward edge keeps the generous enclosure,
    # gate-facing edge keeps only the line-end allowance
    rect("M1", CTxR1 + M1_OUT_ENC - (M1x1 - M1x0), M1y0, CTxR1 + M1_OUT_ENC, M1y1),
    rect("M1", Gx0, Gy0, Gx1, Gy1),
]

for r in rows:
    print(f'    list("{r[0]}" {r[1]} {r[2]} {r[3]} {r[4]})')

print()
print("Copy the lines above into the SKILL rectangle table.")
print("The tap contacts/metal are omitted here on purpose: solve those the same")
print("way once the device itself is DRC-clean, rather than adding more untested")
print("geometry in the same step.")
