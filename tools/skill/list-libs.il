;; list-libs.il — enumerate libraries and their cell counts as a single string.
;; Passed to the bridge as a FILE: inline SKILL gets mangled by the shell's own
;; quoting rules before it ever reaches the guest.
let((s libs)
  libs = ddGetLibList()
  s = sprintf(nil "libraries=%d | " length(libs))
  foreach(l libs
    s = strcat(s l->name "(" sprintf(nil "%d" length(l->cells)) ") ")
  )
  s
)
