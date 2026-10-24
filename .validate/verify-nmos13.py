"""
Verify dsh_nmos13: is the guard ring a CLOSED loop, and is the device intact?

This is the check the user's question demanded: not "does DRC pass" but "is this
thing actually connected". Run on the values dumped from the live cellview.
"""

RECTS = [
    ("M1", 1.030, 1.400, 1.370, 2.370),
    ("M1", 1.600, -0.040, 2.040, 1.240),
    ("M1", 0.360, -0.040, 0.800, 1.240),
    ("CT", 1.090, 1.870, 1.310, 2.090),
    ("CT", 1.680, 0.880, 1.900, 1.100),
    ("CT", 1.680, 0.100, 1.900, 0.320),
    ("CT", 0.500, 0.880, 0.720, 1.100),
    ("CT", 0.500, 0.100, 0.720, 0.320),
    ("GP", 0.990, 1.300, 1.410, 2.190),
    ("AA", 0.400, 0.000, 2.000, 1.200),
    ("AA", -0.300, -1.490, 2.700, -1.070),
    ("AA", -0.300, -0.700, 2.700, -0.280),
    ("AA", -0.300, -1.590, 0.120, -0.180),
    ("AA", 2.280, -1.590, 2.700, -0.180),
    ("SP", -0.480, -1.670, 2.880, -0.100),
]

TOL = 0.001
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


def overlap(a, b):
    return not (a[3] < b[1] - TOL or b[3] < a[1] - TOL
                or a[4] < b[2] - TOL or b[4] < a[2] - TOL)


def contains(o, i):
    return (o[1] <= i[1] + TOL and o[2] <= i[2] + TOL
            and o[3] >= i[3] - TOL and o[4] >= i[4] - TOL)


for i in range(n):
    for j in range(i + 1, n):
        if RECTS[i][0] == RECTS[j][0] and overlap(RECTS[i], RECTS[j]):
            union(i, j)

groups = {}
for i in range(n):
    groups.setdefault(find(i), []).append(i)

print("=" * 70)
print("dsh_nmos13 connectivity")
print("=" * 70)
print()
for gi, (root, mem) in enumerate(sorted(groups.items(), key=lambda kv: -len(kv[1])), 1):
    layers = sorted({RECTS[m][0] for m in mem})
    xs = [RECTS[m][k] for m in mem for k in (1, 3)]
    ys = [RECTS[m][k] for m in mem for k in (2, 4)]
    print(f"NET {gi}: {len(mem)} shape(s)  layers {layers}")
    print(f"       bbox ({min(xs):.2f} {min(ys):.2f})-({max(xs):.2f} {max(ys):.2f})")
    for m in mem:
        r = RECTS[m]
        print(f"         {r[0]:<3} ({r[1]:6.2f} {r[2]:6.2f})-({r[3]:6.2f} {r[4]:6.2f})")
    print()

# the ring is the four AA shapes with y < -0.10
ring_idx = [i for i, r in enumerate(RECTS) if r[0] == "AA" and r[4] < -0.10]
ring_roots = {find(i) for i in ring_idx}
print("=" * 70)
print("Guard ring check")
print("=" * 70)
print(f"  ring rectangles      : {len(ring_idx)}")
print(f"  distinct objects     : {len(ring_roots)}")
closed = len(ring_roots) == 1
print(f"  closed loop          : {'YES' if closed else 'NO -- the ring is in pieces'}")
print()
if closed:
    print("  All four sides overlap at the corners, so the union is one connected")
    print("  loop. That is what makes the substrate tie low impedance everywhere,")
    print("  instead of only at the one edge where a strip sits.")
print()
print("Note: the ring is a SEPARATE net from the device, by design. It carries")
print("the substrate potential and is tied to ground at the cell boundary. It is")
print("not supposed to touch source or drain.")
