#!/usr/bin/env python2
"""x11_drive.py - tiny X11 driver for the Virtuoso guest (python2 + ctypes, no deps).

Why: the bridge daemon answers SKILL over its own socket.  When that socket is
dead (e.g. an interactive SKILL command never returned), the ONLY remaining way
to reach the CIW interpreter is the X server: focus the CIW window and type.

Commands
  list                          root children: id, map state, geometry, names
  info <id>                     one window's attributes
  focus <id>                    raise + XSetInputFocus
  key <id> <keysym-name>        one key, e.g. Escape, Return, Tab
  type <id> <text-file>         type a file's contents (\n -> Return)
  click <id> <x> <y>            fake button-1 click at absolute screen coords

Run it inside the guest with DISPLAY pointing at the Virtuoso display:
  python2 x11_drive.py list
"""
import ctypes
import ctypes.util
import os
import sys
import time

c_int = ctypes.c_int
c_uint = ctypes.c_uint
c_long = ctypes.c_long
c_ulong = ctypes.c_ulong
c_void_p = ctypes.c_void_p
c_char_p = ctypes.c_char_p
c_ubyte = ctypes.c_ubyte


def _lib(cands):
    for cand in cands:
        if not cand:
            continue
        try:
            return ctypes.CDLL(cand)
        except OSError:
            continue
    return None


X11 = _lib([ctypes.util.find_library("X11"), "libX11.so.6", "libX11.so"])
XTST = _lib([ctypes.util.find_library("Xtst"), "libXtst.so.6", "libXtst.so"])
if X11 is None:
    sys.stderr.write("FATAL: libX11 not found\n")
    sys.exit(2)


class XWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("x", c_int), ("y", c_int), ("width", c_int), ("height", c_int),
        ("border_width", c_int), ("depth", c_int), ("visual", c_void_p),
        ("root", c_ulong), ("cls", c_int), ("bit_gravity", c_int),
        ("win_gravity", c_int), ("backing_store", c_int),
        ("backing_planes", c_ulong), ("backing_pixel", c_ulong),
        ("save_under", c_int), ("colormap", c_ulong), ("map_installed", c_int),
        ("map_state", c_int), ("all_event_masks", c_long),
        ("your_event_mask", c_long), ("do_not_propagate_mask", c_long),
        ("override_redirect", c_int), ("screen", c_void_p),
    ]


X11.XOpenDisplay.restype = c_void_p
X11.XOpenDisplay.argtypes = [c_char_p]
X11.XDefaultRootWindow.restype = c_ulong
X11.XDefaultRootWindow.argtypes = [c_void_p]
X11.XQueryTree.argtypes = [c_void_p, c_ulong, ctypes.POINTER(c_ulong),
                           ctypes.POINTER(c_ulong),
                           ctypes.POINTER(ctypes.POINTER(c_ulong)),
                           ctypes.POINTER(c_uint)]
X11.XFetchName.argtypes = [c_void_p, c_ulong, ctypes.POINTER(c_char_p)]
X11.XInternAtom.restype = c_ulong
X11.XInternAtom.argtypes = [c_void_p, c_char_p, c_int]
X11.XGetWindowProperty.argtypes = [
    c_void_p, c_ulong, c_ulong, c_long, c_long, c_int, c_ulong,
    ctypes.POINTER(c_ulong), ctypes.POINTER(c_int), ctypes.POINTER(c_ulong),
    ctypes.POINTER(c_ulong), ctypes.POINTER(ctypes.POINTER(c_ubyte))]
X11.XGetWindowAttributes.argtypes = [c_void_p, c_ulong,
                                     ctypes.POINTER(XWindowAttributes)]
X11.XGetInputFocus.argtypes = [c_void_p, ctypes.POINTER(c_ulong),
                               ctypes.POINTER(c_int)]
X11.XSetInputFocus.argtypes = [c_void_p, c_ulong, c_int, c_ulong]
X11.XRaiseWindow.argtypes = [c_void_p, c_ulong]
X11.XStringToKeysym.restype = c_ulong
X11.XStringToKeysym.argtypes = [c_char_p]
X11.XKeysymToKeycode.restype = c_ubyte
X11.XKeysymToKeycode.argtypes = [c_void_p, c_ulong]
X11.XDisplayKeycodes.argtypes = [c_void_p, ctypes.POINTER(c_uint),
                                 ctypes.POINTER(c_uint)]
X11.XGetKeyboardMapping.restype = ctypes.POINTER(c_ulong)
X11.XGetKeyboardMapping.argtypes = [c_void_p, c_uint, c_int,
                                    ctypes.POINTER(c_int)]
X11.XFree.argtypes = [c_void_p]
X11.XFlush.argtypes = [c_void_p]
X11.XSync.argtypes = [c_void_p, c_int]
XTST.XTestFakeKeyEvent.argtypes = [c_void_p, c_uint, c_int, c_ulong]
XTST.XTestFakeButtonEvent.argtypes = [c_void_p, c_uint, c_int, c_ulong]
XTST.XTestFakeMotionEvent.argtypes = [c_void_p, c_int, c_int, c_int, c_ulong]

SHIFT_L = 0xFFE1
MODE_SWITCH = 0xFF7E
MAP_STATE = {0: "unmapped", 1: "unviewable", 2: "mapped"}


def open_display():
    dpy = X11.XOpenDisplay(None)
    if not dpy:
        sys.stderr.write("FATAL: cannot open DISPLAY=%s\n"
                         % os.environ.get("DISPLAY"))
        sys.exit(2)
    return dpy


def children(dpy, win):
    root = c_ulong()
    parent = c_ulong()
    kids = ctypes.POINTER(c_ulong)()
    n = c_uint()
    if not X11.XQueryTree(dpy, win, ctypes.byref(root), ctypes.byref(parent),
                          ctypes.byref(kids), ctypes.byref(n)):
        return []
    out = [kids[i] for i in range(n.value)]
    if kids:
        X11.XFree(kids)
    return out


def attrs(dpy, win):
    a = XWindowAttributes()
    if not X11.XGetWindowAttributes(dpy, win, ctypes.byref(a)):
        return None
    return a


def name_of(dpy, win):
    p = c_char_p()
    txt = ""
    if X11.XFetchName(dpy, win, ctypes.byref(p)) and p.value:
        txt = p.value
        X11.XFree(p)
    return txt


def net_name(dpy, win):
    atom = X11.XInternAtom(dpy, b"_NET_WM_NAME", 0)
    if not atom:
        return ""
    actual_type = c_ulong()
    actual_format = c_int()
    nitems = c_ulong()
    after = c_ulong()
    prop = ctypes.POINTER(c_ubyte)()
    if X11.XGetWindowProperty(dpy, win, atom, 0, 1024, 0, 0,
                              ctypes.byref(actual_type),
                              ctypes.byref(actual_format),
                              ctypes.byref(nitems), ctypes.byref(after),
                              ctypes.byref(prop)) != 0:
        return ""
    if not prop:
        return ""
    txt = "".join(chr(prop[i]) for i in range(nitems.value))
    X11.XFree(prop)
    return txt


def focus_window(dpy, win):
    X11.XRaiseWindow(dpy, win)
    X11.XSetInputFocus(dpy, win, 2, 0)  # RevertToParent, CurrentTime
    X11.XSync(dpy, 0)
    time.sleep(0.25)


def build_keymap(dpy):
    mn = c_uint()
    mx = c_uint()
    X11.XDisplayKeycodes(dpy, ctypes.byref(mn), ctypes.byref(mx))
    per = c_int()
    ptr = X11.XGetKeyboardMapping(dpy, mn.value, mx.value - mn.value + 1,
                                  ctypes.byref(per))
    table = {}
    if not ptr:
        return table, {}
    nper = per.value
    for i in range(mx.value - mn.value + 1):
        kc = mn.value + i
        for lvl in range(min(nper, 4)):
            ks = ptr[i * nper + lvl]
            if ks and ks not in table:
                table[int(ks)] = (kc, lvl)
    X11.XFree(ptr)
    return table, {"min": mn.value, "max": mx.value, "per": nper}


def tap(dpy, keycode, level):
    if level == 1:
        XTST.XTestFakeKeyEvent(dpy, X11.XKeysymToKeycode(dpy, SHIFT_L), 1, 0)
    elif level >= 2:
        XTST.XTestFakeKeyEvent(dpy, X11.XKeysymToKeycode(dpy, MODE_SWITCH), 1, 0)
    XTST.XTestFakeKeyEvent(dpy, keycode, 1, 0)
    XTST.XTestFakeKeyEvent(dpy, keycode, 0, 0)
    if level == 1:
        XTST.XTestFakeKeyEvent(dpy, X11.XKeysymToKeycode(dpy, SHIFT_L), 0, 0)
    elif level >= 2:
        XTST.XTestFakeKeyEvent(dpy, X11.XKeysymToKeycode(dpy, MODE_SWITCH), 0, 0)
    X11.XFlush(dpy)
    time.sleep(0.05)


def keysym_for(ch):
    if ch == "\n":
        return X11.XStringToKeysym(b"Return")
    if ch == " ":
        return X11.XStringToKeysym(b"space")
    if ch == "\t":
        return X11.XStringToKeysym(b"Tab")
    o = ord(ch)
    if o < 0x100:
        return o  # Latin-1 keysyms equal the character code
    return X11.XStringToKeysym(ch)


def type_text(dpy, table, text, quiet=False):
    sent = 0
    missed = []
    for ch in text:
        ks = keysym_for(ch)
        if not ks or ks not in table:
            missed.append(ch)
            continue
        kc, lvl = table[ks]
        tap(dpy, kc, lvl)
        sent += 1
    if not quiet:
        sys.stdout.write("typed %d chars, missed %d %r\n"
                         % (sent, len(missed), "".join(missed)))
    return sent, missed


def parse_window(tok):
    return int(tok, 0)


def cmd_list(dpy, args):
    root = X11.XDefaultRootWindow(dpy)
    focus_win = c_ulong()
    revert = c_int()
    X11.XGetInputFocus(dpy, ctypes.byref(focus_win), ctypes.byref(revert))
    print("root=0x%x focus=0x%x" % (root, focus_win.value))
    for win in children(dpy, root):
        a = attrs(dpy, win)
        if a is None:
            print("0x%x  <no attrs>" % win)
            continue
        print("0x%-10x %-9s %4dx%-4d %+5d%+5d  name=%-28r net=%-40r%s"
              % (win, MAP_STATE.get(a.map_state, "?"), a.width, a.height,
                 a.x, a.y, name_of(dpy, win), net_name(dpy, win),
                 "  <-- FOCUS" if win == focus_win.value else ""))
        for kid in children(dpy, win):
            ka = attrs(dpy, kid)
            if ka is None:
                continue
            print("    0x%-10x %-9s %4dx%-4d %+5d%+5d  name=%r%s"
                  % (kid, MAP_STATE.get(ka.map_state, "?"), ka.width,
                     ka.height, ka.x, ka.y, name_of(dpy, kid),
                     "  <-- FOCUS" if kid == focus_win.value else ""))
    return 0


def main(argv):
    if len(argv) < 2:
        sys.stderr.write(__doc__)
        return 2
    cmd = argv[1]
    dpy = open_display()
    if cmd == "list":
        return cmd_list(dpy, argv[2:])
    if cmd == "info":
        win = parse_window(argv[2])
        a = attrs(dpy, win)
        if a is None:
            print("no attributes for 0x%x" % win)
            return 1
        print("0x%x %s %dx%d %+d%+d depth=%d name=%r net=%r"
              % (win, MAP_STATE.get(a.map_state, "?"), a.width, a.height,
                 a.x, a.y, a.depth, name_of(dpy, win), net_name(dpy, win)))
        return 0
    if cmd == "focus":
        focus_window(dpy, parse_window(argv[2]))
        print("focused 0x%x" % parse_window(argv[2]))
        return 0
    if cmd == "key":
        win = parse_window(argv[2])
        ks = X11.XStringToKeysym(argv[3])
        if not ks:
            print("unknown keysym %r" % argv[3])
            return 2
        kc = X11.XKeysymToKeycode(dpy, ks)
        focus_window(dpy, win)
        if not kc:
            print("keysym %r has no keycode" % argv[3])
            return 2
        tap(dpy, kc, 0)
        print("sent %s (keysym 0x%x keycode %d) to 0x%x" % (argv[3], ks, kc, win))
        return 0
    if cmd == "type":
        win = parse_window(argv[2])
        with open(argv[3], "rb") as fh:
            text = fh.read()
        table, meta = build_keymap(dpy)
        focus_window(dpy, win)
        sent, missed = type_text(dpy, table, text)
        return 0 if not missed else 1
    if cmd == "click":
        win = parse_window(argv[2])
        x = int(argv[3])
        y = int(argv[4])
        focus_window(dpy, win)
        XTST.XTestFakeMotionEvent(dpy, -1, x, y, 0)
        X11.XFlush(dpy)
        time.sleep(0.15)
        XTST.XTestFakeButtonEvent(dpy, 1, 1, 0)
        XTST.XTestFakeButtonEvent(dpy, 1, 0, 0)
        X11.XFlush(dpy)
        print("clicked (%d,%d) in 0x%x" % (x, y, win))
        return 0
    sys.stderr.write("unknown command %r\n" % cmd)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
