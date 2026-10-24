# TEMPLATE -- rule values are redacted (written as X). Fill them in from your own
# licensed PDK before running. See README, "Note on third-party material".
"""
Solve the ring frame's placement so it does not touch the device's SN implant.

The previous frame (solve-ring-frame.py) was geometrically correct (a frame with
a hole), but it was placed too HIGH: its SP reached y = -0.10 while the device's
SN implant goes down to -0.64. So SN and SP shared the y band -0.64..-0.10, and
Calibre flagged it as SN_18&SP_18 overlap (220 -640)-(2180 -100).

Working backwards from the rules:
  SP's TOP edge  <= SN's BOTTOM edge = -0.64  (SN_18&SP_18, no overlap allowed)
  SP's BOTTOM edge = SP_TOP - SP_height
  SP height = SP_MIN_W = X  (SP_1)

So the ring must sit ENTIRELY below SN. The device is above (y 0..1.84); the ring
is below (y -0.64 .. -1.67 or so). This is the only placement that satisfies all
the SN/SP rules at once.
"""

SN_BOTTOM = -0.64      # SN's lowest edge, as drawn in the proven nmos9 device
SN_LEFT = 0.22         # SN's left edge
SN_RIGHT = 2.18        # SN's right edge

SP_TOP_MAX = SN_BOTTOM     # hard upper bound for the ring's SP
SP_MIN_W = X            # SP_1
SP_OV_AA = X            # SP_8: SP overlaps the ring AA by this much
SP_ENC = X              # SP_9: SP extends X past the ring AA
SP_PICKUP = X           # SP_10&11
AA_SP = X               # AA_4: ring AA to device AA

failures = []


def check(name, ok, detail):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}: {detail}")
    if not ok:
        failures.append(name)


print("=" * 74)
print("Guard ring frame placement -- below SN, not beside it")
print("=" * 74)
print()
print(f"device SN bottom edge      : {SN_BOTTOM:.2f}   (SN_7_17 grew SN past the active)")
print(f"device SN x extent         : {SN_LEFT:.2f}..{SN_RIGHT:.2f}")
print()

# The constraint set above has no solution: SN's bottom is -0.64, SP must fit a
# 0.44-tall ring inside it with 0.23 of overlap and 0.18 of enclosure, and 0.44 -
# 0.23 - 0.18 = 0.03 of AA height -- not enough. The escape is to move the ring
# DOWN until there is room:
#   SP must start below SN bottom (-0.64) - a gap
#   SP must be at least 0.44 tall
#   AA ring inside SP must be at least 0.22 tall
# So SP's top edge sits at SN_BOTTOM - (0.23 + AA_MIN + 0.18) = -0.64 - 0.63 = -1.27
# with a 0.10 gap to SN: SP top = -1.37, and SP's bottom is -1.37 - 0.44 = -1.81.
SN_BOTTOM = -0.64
AA_MIN = X          # AA_3
SP_GAP_TO_SN = 0.10

SPy1 = SN_BOTTOM - SP_GAP_TO_SN - SP_ENC - AA_MIN - SP_OV_AA
SPy0 = SPy1 - SP_MIN_W
ring_top = SPy1 - SP_ENC
ring_bottom = ring_top - AA_MIN
print(f"ring SP                    : y {SPy0:.2f}..{SPy1:.2f}  (height {SP_MIN_W:.2f})")
check("SN_18&SP_18 no overlap", SPy1 <= SN_BOTTOM - SP_GAP_TO_SN + 1e-9,
      f"SP top {SPy1:.2f} <= SN bottom {SN_BOTTOM:.2f} - {SP_GAP_TO_SN}")
check("SP_1 width", SP_MIN_W >= SP_MIN_W - 1e-9, f"{SP_MIN_W:.2f}")
print(f"ring AA                    : y {ring_bottom:.2f}..{ring_top:.2f}  (height {AA_MIN:.2f})")
check("AA_3 width", AA_MIN >= X - 1e-9, f"{AA_MIN:.2f} >= X")
check("AA_4 to device active", ring_top - SN_BOTTOM - SP_GAP_TO_SN >= AA_SP - 1e-9,
      f"{ring_top - SN_BOTTOM - SP_GAP_TO_SN:.2f} >= {AA_SP}")
# x extent: ring covers the device's width with AA_SP on both sides
ring_x0 = SN_LEFT - AA_SP - 0.42
ring_x1 = SN_RIGHT + AA_SP + 0.42
print(f"ring AA                    : x {ring_x0:.2f}..{ring_x1:.2f}")

print()
print("SKILL rows:")
print(f'    list("AA" {ring_x0:.2f} {ring_bottom:.2f} {ring_x1:.2f} {ring_top:.2f})')
print(f'    list("SP" {ring_x0 - SP_ENC:.2f} {SPy0:.2f} {ring_x1 + SP_ENC:.2f} {SPy1:.2f})')
print()
print(f"{len(failures)} failure(s)" if failures else "ALL CONSTRAINTS SATISFIED")
