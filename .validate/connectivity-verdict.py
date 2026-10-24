"""
Correct my own connectivity analysis: is "D and S on one diffusion" actually wrong?

connectivity.py walked the geometry naively and concluded NET 1 contains both the
D and S labels, i.e. source and drain are shorted. That conclusion needs checking,
because a MOSFET is SUPPOSED to have one continuous piece of diffusion with the
gate crossing it: the gate field creates the channel, and the two ends of the
diffusion are the source and the drain.

So which is it? The decisive evidence is not the geometry walk -- it is what the
extractor produced:

    .SUBCKT dsh_nmos12 D B G S
    ** N=4 EP=4 IP=0 FDC=1
    M0 S G D B <model> L=1.8e-07 W=1.2e-06

N=4 nets and EP=4 external ports: Calibre counted four DISTINCT nets, with S and
D on different ones. If the single diffusion bar had shorted them, the extraction
would have collapsed to 3 nets and LVS would have failed with "Nets 3 vs 4". It
did not; it reported 4/4.

Why: in MOSFET extraction the region of active UNDER the gate is not part of the
source/drain diffusion. The device model splits the diffusion at the channel, so
a continuous bar with a gate across it yields two terminals, not one. That is
standard and correct.

CONCLUSION: "D and S are the same net" was WRONG. My connectivity.py is a
layer-overlap walk with no device model, so it cannot see the gate cut. It is
still useful for finding genuinely floating shapes -- which it did -- but it must
not be used to judge device topology.

What it legitimately found:
  NET 4 (the N-well pickup) touches nothing. That one is real.
  NET 7 (NW) and NET 8 (its SN) are separate shapes. Also real.
"""

print("=" * 76)
print("Which of connectivity.py's findings survive")
print("=" * 76)
print()
rows = [
    ("D and S shorted by one diffusion", "WRONG", "gate splits the diffusion in extraction; N=4 proves it"),
    ("N-well pickup floats",             "REAL",  "NET 4 touches nothing"),
    ("NW is a separate shape",           "REAL",  "and a standalone NMOS needs no NW at all"),
    ("substrate tie is one edge only",   "REAL",  "a single strip, not a distributed ring"),
]
for claim, verdict, why in rows:
    print(f"  [{verdict:<5}] {claim}")
    print(f"            {why}")
print()
print("=" * 76)
print("What a standalone NMOS actually needs")
print("=" * 76)
print()
print("  active bar            yes, continuous, gate crossing it")
print("  gate                  yes")
print("  substrate tie         yes, and it should be a RING around the device,")
print("                        not a strip on one side")
print("  N-well                NO. An NMOS sits in the P-well, and PW is derived")
print("                        by the deck. The N-well I added serves nothing,")
print("                        which is why it is floating.")
print()
print("So the N-well was a mistake of mine, not a missing feature: it satisfies")
print("NW_3 and Convention_FLT_NW and is electrically pointless. Removing it and")
print("adding a real P+ guard ring is the correct construction.")
