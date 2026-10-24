;; open-layout.il — open CMP_MAIN read-only and report the resulting window.
;;
;; NOTE FOR FUTURE SKILL FILES: do not put round brackets in comments. The bridge
;; load path appears to scan the raw text, so a bracket inside a comment breaks
;; the load with a misleading "error while loading file at line <EOF>" message.
;; Keep comments bracket-free and this file loads cleanly.
let((p d c v cv win)
  p = outfile("/tmp/dsh_open.txt" "w")
  fprintf(p "A start\n")
  d = ddGetObj("OSC_DESIGN")
  c = ddGetObj("OSC_DESIGN" "CMP_MAIN")
  fprintf(p "B lib=%L cell=%L\n" d c)
  when(c
    fprintf(p "C views=%d\n" length(c->views))
    v = car(c->views)
    fprintf(p "D view=%s type=%s\n" v->name v->viewType)
    cv = dbOpenCellViewByType("OSC_DESIGN" "CMP_MAIN" v->name v->viewType "r")
    fprintf(p "E opened=%L\n" cv)
    win = hiGetCurrentWindow()
    fprintf(p "F win=%L\n" win)
  )
  fprintf(p "G done\n")
  close(p)
  t
)
