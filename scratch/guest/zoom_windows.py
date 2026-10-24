# zoom_windows.py -- set a comparable zoom on two Virtuoso layout windows.

# Why XTEST and not SKILL: hiZoomIn / hiFitAll are interactive graphics commands.
# Calling them from the CIW evaluator parks the evaluator inside the C call until
# the user clicks, which wedges the whole SKILL channel (documented in AGENTS.md
# section 3). Sending the same keystrokes through XTEST runs them in the window's
# own event loop, where they belong and where they cannot block the bridge.
#
# f = fit the cell to the window. That is enough to make the two screenshots
# comparable: both cells have the same bbox, so fitting both gives the same scale.

import ctypes
import subprocess
import sys
import time

libX11 = ctypes.CDLL("libX11.so.6")
libXtst = ctypes.CDLL("libXtst.so.6")

display = libX11.XOpenDisplay(None)
if not display:
    sys.exit("cannot open display")

XK_f = 0x0066
XK_Escape = 0xFF1B


def focus(window_id):
    """Raise and focus one window so the following key goes to it, not elsewhere."""
    libX11.XRaiseWindow(display, window_id)
    libX11.XSetInputFocus(display, window_id, 2, 0)  # 2 = RevertToParent
    libX11.XSync(display, 0)
    time.sleep(0.4)


def key(code):
    keycode = libX11.XKeysymToKeycode(display, code)
    libXtst.XTestFakeKeyEvent(display, keycode, True, 0)
    libXtst.XTestFakeKeyEvent(display, keycode, False, 0)
    libX11.XSync(display, 0)
    time.sleep(0.3)


def window_ids():
    """Client window ids for the two dsh_nmos layout windows, via xdotool-free path.

    xwininfo is present on this guest; xdotool is not. Match on the window title,
    which carries the cell name, so the mapping cannot silently drift to the
    wrong window when other layouts are open.
    """
    out = subprocess.check_output(["bash", "-lc", "xwininfo -root -tree"]).decode("utf8", "replace")
    found = {}
    for line in out.splitlines():
        for cell in ("dsh_nmos2", "dsh_nmos"):
            if cell in line:
                parts = line.split()
                for part in parts:
                    if part.startswith("0x"):
                        # The longest-matching title wins: dsh_nmos2 contains dsh_nmos.
                        if cell not in found or len(cell) > len(found[cell][0]):
                            found[cell] = (cell, int(part, 16), line.strip())
    return found


found = window_ids()
for cell in ("dsh_nmos", "dsh_nmos2"):
    if cell not in found:
        print("MISSING window for %s" % cell)
        continue
    _, wid, line = found[cell]
    # Cancel any pending interactive command before sending a new one: an armed
    # zoom waiting for a click would consume the 'f' and stay armed.
    focus(wid)
    key(XK_Escape)
    focus(wid)
    key(XK_f)
    print("zoomed %-10s window=0x%x" % (cell, wid))
    print("   %s" % line[:110])
