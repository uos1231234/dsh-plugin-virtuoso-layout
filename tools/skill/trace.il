;; trace.il — bisect which SKILL operation fails, by writing a progress marker
;; after each step. Cheap and decisive compared with guessing at the line number.
let((p d)
  p = outfile("/tmp/dsh_trace.txt" "w")
  fprintf(p "1 outfile ok\n")
  d = ddGetObj("OSC_DESIGN")
  fprintf(p "2 ddGetObj=%L\n" d)
  when(d
    fprintf(p "3 cells=%d\n" length(d->cells))
    foreach(c d->cells
      fprintf(p "4 cell %s views=%d\n" c->name length(c->views))
    )
  )
  fprintf(p "5 done\n")
  close(p)
  t
)
