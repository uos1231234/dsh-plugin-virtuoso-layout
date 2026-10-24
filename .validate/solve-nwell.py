# TEMPLATE -- rule values are redacted (written as X). Fill them in from your own
# licensed PDK before running. See README, "Note on third-party material".
"""
Solve the N-well + N+ pickup structure, and record what the two experiments
established about "adding wells" on this PDK.

Why this file exists: "add the wells" turns out to mean two different things on
this process, and only one of them is drawing.

  PW is DERIVED, not drawn.
      The layer map has PWI (81:0), and the deck computes
          PWO = ((BULK NOT NWi) NOT PBi) NOT DNWi
          PW  = PWO NOT EXCLU
      so the P-well is "everything that is not N-well". Experiment 1 drew a box
      on layer "PW" and the deck's own statistics showed
          LAYER PWIi ... Original Geometry Count = 0
      i.e. the box never reached Calibre. The earlier cells were therefore not
      missing the P-well at all; it was implicit the whole time. What they were
      missing is the N-well, and the substrate tie.

  NW is drawn (14:0), and it is only legal with an N+ pickup:
          Convention_FLT_NW: "NW without N+ pick up"
          NW NOT INTERACT NTAPi
      Experiment 2 added NW alone -> that rule fired. Adding AA + SN + CT inside
      the well (an N+ tap) made it disappear.

The constraints below are the engineering consequences of the deck rules,
recorded as constants; the rule wording itself is not reproduced.
"""

NW_MIN_W = X      # NW_1  minimum width of the well
NW_MIN_DIM = X    # NW_3  a well NOT tied to the most positive supply must
                     #        satisfy the minimum in BOTH dimensions
AA_ENC = X        # CT_6a
CT = 0.22
SN_OV = X         # SN_9
M1_W = X          # M1_1
M1_AREA = X       # M1_6
M1_ENC = 0.14        # comfortable M1 enclosure of a contact

failures = []


def check(name, ok, detail):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}: {detail}")
    if not ok:
        failures.append(name)


print("=" * 74)
print("N-well + N+ pickup solve")
print("=" * 74)
print()

# ── The well: both dimensions >= 2.10 because it is not tied to VDD/VCC ─────
NWx0, NWy0 = 0.30, 2.60
NWW = max(NW_MIN_DIM, NW_MIN_W)
NWH = max(NW_MIN_DIM, NW_MIN_W)
NWx1, NWy1 = NWx0 + NWW, NWy0 + NWH
print(f"NW  x {NWx0:.2f}..{NWx1:.2f}  y {NWy0:.2f}..{NWy1:.2f}  "
      f"({NWW:.2f} x {NWH:.2f})")
check("NW_1 width", min(NWW, NWH) >= NW_MIN_W - 1e-9,
      f"{min(NWW, NWH):.2f} >= {NW_MIN_W}")
check("NW_3 both dimensions (not tied to VDD)", min(NWW, NWH) >= NW_MIN_DIM - 1e-9,
      f"{min(NWW, NWH):.2f} >= {NW_MIN_DIM}")

# ── The N+ pickup inside the well ──────────────────────────────────────────
# AA must be inside the well, and there must be room for SN to extend past it
# (SN_9, X) without SN reaching the well edge.
PICK_CLEAR = SN_OV + 0.06        # AA to well edge: SN_OV plus a margin
AAx0, AAx1 = NWx0 + PICK_CLEAR, NWx1 - PICK_CLEAR
AAy0, AAy1 = NWy0 + PICK_CLEAR, NWy1 - PICK_CLEAR
print(f"AA  x {AAx0:.2f}..{AAx1:.2f}  y {AAy0:.2f}..{AAy1:.2f}")
check("AA sits inside NW", AAx1 - AAx0 > 0 and AAy1 - AAy0 > 0,
      f"{AAx1 - AAx0:.2f} x {AAy1 - AAy0:.2f} inside the well")

SNx0, SNx1 = AAx0 - SN_OV, AAx1 + SN_OV
SNy0, SNy1 = AAy0 - SN_OV, AAy1 + SN_OV
print(f"SN  x {SNx0:.2f}..{SNx1:.2f}  y {SNy0:.2f}..{SNy1:.2f}")
check("SN inside NW", SNx0 >= NWx0 - 1e-9 and SNx1 <= NWx1 + 1e-9
      and SNy0 >= NWy0 - 1e-9 and SNy1 <= NWy1 + 1e-9,
      "SN does not cross the well edge")

# ── Contact and metal, centred, sized so M1_6 passes ───────────────────────
CTr = (CT / 2)
CTx = (AAx0 + AAx1) / 2 - CTr
CTy = (AAy0 + AAy1) / 2 - CTr
print(f"CT  x {CTx:.2f}..{CTx + CT:.2f}  y {CTy:.2f}..{CTy + CT:.2f}")
check("CT inside AA by AA_ENC",
      CTx - AAx0 >= AA_ENC - 1e-9 and AAx1 - (CTx + CT) >= AA_ENC - 1e-9
      and CTy - AAy0 >= AA_ENC - 1e-9 and AAy1 - (CTy + CT) >= AA_ENC - 1e-9,
      f"x {CTx - AAx0:.2f}/{AAx1 - (CTx + CT):.2f}, y {CTy - AAy0:.2f}/{AAy1 - (CTy + CT):.2f}")

# M1_6 was the failure here: X x X = X. The pickup metal has to be
# bigger than the contact plus a small enclosure -- size it FROM the area rule.
M1side = max(CT + 2 * M1_ENC, (M1_AREA) ** 0.5)
M1x0 = (AAx0 + AAx1) / 2 - M1side / 2
M1x1 = M1x0 + M1side
M1y0 = (AAy0 + AAy1) / 2 - M1side / 2
M1y1 = M1y0 + M1side
area = M1side * M1side
print(f"M1  {M1side:.2f} x {M1side:.2f} = {area:.3f} um^2")
check("M1_1 width", M1side >= M1_W - 1e-9, f"{M1side:.2f} >= {M1_W}")
check("M1_6 area", area >= M1_AREA - 1e-9, f"{area:.3f} >= {M1_AREA}")
check("M1 encloses CT", M1x0 <= CTx and M1x1 >= CTx + CT
      and M1y0 <= CTy and M1y1 >= CTy + CT, "contact is covered")

print()
print("=" * 74)
print(f"{len(failures)} failure(s)" if failures else "ALL CONSTRAINTS SATISFIED")
print("=" * 74)
print()
print("SKILL rows for the well + pickup:")
print(f'    list("NW" {NWx0:.2f} {NWy0:.2f} {NWx1:.2f} {NWy1:.2f})')
print(f'    list("AA" {AAx0:.2f} {AAy0:.2f} {AAx1:.2f} {AAy1:.2f})')
print(f'    list("SN" {SNx0:.2f} {SNy0:.2f} {SNx1:.2f} {SNy1:.2f})')
print(f'    list("CT" {CTx:.2f} {CTy:.2f} {CTx + CT:.2f} {CTy + CT:.2f})')
print(f'    list("M1" {M1x0:.2f} {M1y0:.2f} {M1x1:.2f} {M1y1:.2f})')
