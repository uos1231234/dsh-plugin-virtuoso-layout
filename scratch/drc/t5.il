; Is the minus function itself broken? Check the four arithmetic forms that the
; geometry code depends on. This is the root of a whole cascade: if `-` fails,
; every derived coordinate fails, and because the failure happens inside a big
; let the only message is "load ... at line N", which names nothing.
;
; Do NOT wrap these in errset: errset would hide which one broke. Instead print
; each result and let the first failure abort.
let(( out )
  out = ""

  ; literal arithmetic without a function call
  out = strcat(out sprintf(nil "bare     3.0 - 0.18  = %L\n" (3.0 - 0.18)))
  out = strcat(out sprintf(nil "bare     0.0 - 0.18  = %L\n" (0.0 - 0.18)))

  ; function call form
  out = strcat(out sprintf(nil "func     (- 3.0 0.18) = %L\n" (- 3.0 0.18)))
  out = strcat(out sprintf(nil "func     (- 0.0 0.18) = %L\n" (- 0.0 0.18)))
  out

  out)