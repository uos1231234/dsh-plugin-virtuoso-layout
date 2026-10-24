"""Extract the failing DRC checks with their rule text and coordinates.

The Calibre ASCII results database has no indentation and no delimiters: a rule
name line, a count line, then N result entries. Parsing it by eye is how a
"24 violations" number stays unexamined, so this prints each failing rule with
its human-readable description and the actual polygons Calibre flagged.

Usage: python drc-detail.py <results file> [--rule NAME]
"""

import sys

path = sys.argv[1]
want = None
if '--rule' in sys.argv:
    want = sys.argv[sys.argv.index('--rule') + 1]

lines = open(path, encoding='latin-1').read().splitlines()

# A rule block is: RULE_NAME / "n n2 flags date" / description lines / results.
# The count line is recognisable by its leading two integers, and the block ends
# at the next line that is a bare rule name (no spaces, no digits-only).
blocks = []
i = 0
while i < len(lines):
    name = lines[i].strip()
    if (
        name
        and i + 1 < len(lines)
        and lines[i + 1].split()[:2] and all(p.isdigit() for p in lines[i + 1].split()[:2])
        and ' ' not in name
    ):
        try:
            count = int(lines[i + 1].split()[0])
        except (ValueError, IndexError):
            i += 1
            continue
        j = i + 2
        desc = []
        # Description: everything up to the first results entry or the next rule.
        while j < len(lines):
            probe = lines[j].strip()
            if not probe:
                j += 1
                continue
            if probe.startswith('Rule File Pathname:'):
                j += 1
                continue
            # A results entry starts with 'r' followed by layer info, or 'p'.
            if probe.startswith('r ') or probe.startswith('p ') or probe[:1] in 'rpl' and len(probe.split()) > 3:
                break
            if ' ' not in probe:
                break
            desc.append(probe)
            j += 1
        results = []
        while j < len(lines) and len(results) < count:
            probe = lines[j].strip()
            if probe.startswith('r ') or probe.startswith('p '):
                results.append(probe)
            j += 1
            if probe and ' ' not in probe and len(results) >= count:
                break
        blocks.append((name, count, ' '.join(desc), results))
        i = j
        continue
    i += 1

total = 0
shown = 0
print("=" * 78)
print("Calibre DRC -- failing checks with rule text and flagged geometry")
print("=" * 78)
for name, count, desc, results in blocks:
    if count == 0:
        continue
    if want is not None and name != want:
        continue
    total += count
    shown += 1
    print()
    print(f"[{name}]  {count} violation(s)")
    print(f"  RULE: {desc}")
    for r in results[:6]:
        print(f"  GEOM: {r}")
    if len(results) > 6:
        print(f"  ... {len(results) - 6} more")
print()
print("=" * 78)
print(f"{shown} failing checks, {total} violations total")
print("=" * 78)
