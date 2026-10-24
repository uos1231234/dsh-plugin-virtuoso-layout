; Confirm the exact culprit: (- 0.00 0.18) vs (- 0.0 0.18) vs (- 0 0.18).
; Verified finding so far: t3 (which contains (- 0.00 0.18)) fails, while t1
; (which contains no subtraction) succeeds. Isolate which of the four lines
; breaks by evaluating them as separate top-level forms, in order -- the first
; one that fails stops the script, so the position tells us the culprit.
list(
  errset( - 0.30 0.18 )
  errset( - 0 0.18 )
  errset( - 0.0 0.18 )
  errset( + 2.10 0.18 )
  errset( + 1.20 0.18 ) )