#!/usr/bin/env python2
"""probe_daemon.py - diagnose the Virtuoso bridge daemon from inside the guest.

Answers three questions in one shot:
  1. which processes make up the bridge (python daemon, cdsServIpc, virtuoso),
     their state, and - crucially - their kernel wait channel (wchan);
  2. what the TCP table says about the daemon port;
  3. does a fresh localhost connection get accepted, and does it answer.

A daemon sitting in accept()/poll() on the listen socket means it is idle and
healthy.  A daemon sitting in a read on its IPC link to SKILL means SKILL never
returned - a wedged interpreter, not a broken tunnel.
"""
import glob
import os
import socket
import sys
import time

PORT = 65452


def readfile(path, limit=4096):
    try:
        fh = open(path)
        data = fh.read(limit)
        fh.close()
        return data
    except Exception as exc:
        return "<%s>" % exc


def scan_procs():
    print("=== bridge processes ===")
    pids = sorted(glob.glob("/proc/[0-9]*"), key=lambda p: int(p.split("/")[-1]))
    for pdir in pids:
        cmd = readfile(pdir + "/cmdline").replace("\x00", " ").strip()
        if not cmd:
            continue
        if not ("ramic_bridge" in cmd or "cdsServIpc" in cmd
                or "virtuoso" in cmd or "dfII" in cmd):
            continue
        stat = readfile(pdir + "/stat").strip()
        tail = stat.rsplit(")", 1)
        state = tail[1].split()[0] if len(tail) > 1 else "?"
        wchan = readfile(pdir + "/wchan").strip() or "-"
        pid = pdir.split("/")[-1]
        fds = glob.glob(pdir + "/fd/*")
        print("pid=%-6s ppid=%-6s state=%-2s wchan=%-26s fds=%-4d %s"
              % (pid, readfile(pdir + "/stat").split()[3] if len(stat.split()) > 3 else "?",
                 state, wchan, len(fds), cmd[:140]))
    print("")


def scan_sockets():
    print("=== tcp entries for port %d ===" % PORT)
    hexport = ":%04X" % PORT
    found = 0
    for name in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            lines = open(name).read().splitlines()[1:]
        except Exception:
            continue
        for line in lines:
            parts = line.split()
            if len(parts) < 10:
                continue
            if parts[1].endswith(hexport) or parts[2].endswith(hexport):
                print("  %-16s local=%-24s remote=%-24s st=%s inode=%s"
                      % (os.path.basename(name), parts[1], parts[2], parts[3],
                         parts[9]))
                found += 1
    if not found:
        print("  (none)")
    print("")


def probe(payload, label, timeout=4.0):
    print("=== tcp probe: %s ===" % label)
    sock = socket.socket()
    sock.settimeout(timeout)
    start = time.time()
    try:
        sock.connect(("127.0.0.1", PORT))
    except Exception as exc:
        print("  connect FAIL after %.2fs: %s: %s"
              % (time.time() - start, type(exc).__name__, exc))
        return
    print("  connect OK in %.2fs" % (time.time() - start))
    if payload:
        try:
            sock.sendall(payload)
            print("  sent    %r" % payload[:70])
        except Exception as exc:
            print("  send    FAIL %s: %s" % (type(exc).__name__, exc))
    try:
        data = sock.recv(4096)
        print("  recv    %d bytes: %r" % (len(data), data[:220]))
    except Exception as exc:
        print("  recv    FAIL after %.2fs: %s: %s"
              % (time.time() - start, type(exc).__name__, exc))
    try:
        sock.close()
    except Exception:
        pass
    print("")


if __name__ == "__main__":
    scan_procs()
    scan_sockets()
    probe(None, "connect only (no payload)")
    if len(sys.argv) > 1:
        probe(sys.argv[1] + "\n", "with payload")
