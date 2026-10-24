;; lib-report.il — write a machine-readable library/cell report into the guest.
;;
;; Why a file instead of the expression value: `load` returns only `t`, and
;; inline SKILL through a shell argument gets re-quoted by the host shell before
;; it reaches the guest. Writing to a guest file and reading it back over ssh is
;; the channel that survives both problems.
let((p libs)
  p = outfile("/tmp/dsh_lib_report.txt" "w")
  libs = ddGetLibList()
  fprintf(p "libraries=%d\n" length(libs))
  foreach(l libs
    fprintf(p "lib\t%s\t%d\n" l->name length(l->cells))
    foreach(c l->cells
      fprintf(p "cell\t%s\t%s\t%d\n" l->name c->name length(c->views))
    )
  )
  close(p)
  t
)
