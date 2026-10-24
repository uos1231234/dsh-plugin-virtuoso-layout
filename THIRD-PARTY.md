# Third-party material

This file exists because `LICENSE` must contain the MIT text and nothing else: GitHub
identifies a licence by matching the file against the standard template, and any
appended paragraph makes the repository report `NOASSERTION` instead of `MIT`. The
notices that used to live at the bottom of `LICENSE` are here instead, where they are
easier to read anyway.

## Dependencies

### virtuoso-bridge-lite — MIT

<https://github.com/Arcadia-1/virtuoso-bridge-lite>

Copyright (c) 2025-2026 Zhishuai Zhang, Xintian Li, Nan Sun, Lu Jie (Tsinghua University)

This project is a **dependency, not a vendored copy**. It is not included in this
repository; install it from its own repository, where its licence and its history live.
The `ramic_bridge.il` SKILL layer it provides — a socket that evaluates SKILL inside a
live CIW — is the mechanism this plugin is built on. See the acknowledgements in
[`README.md`](README.md).

### Cadence Virtuoso, Siemens Calibre

Neither is redistributed here in any form. The plugin drives an installation you already
have, and the DRC/LVS verdicts quoted in the documents are Calibre's own output from the
author's machine.

## Foundry material — deliberately absent

No foundry PDK, rule deck, or Calibre output containing rule text is included in this
repository. Foundry decks are confidential material, distributed by the foundry only to
licensed customers under their own terms.

What the documents here *do* contain is rule **identifiers** (`GP_11a`, `NW_3`, …) and
the reasoning behind each geometry decision, because that is the part that transfers to
another process. Where a rule's own wording would have been quoted, it is paraphrased or
elided. Obtain the decks from your foundry.
