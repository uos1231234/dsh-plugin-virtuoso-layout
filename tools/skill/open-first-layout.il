;; open-first-layout.il — report views for the user's own libraries, then open the
;; first real maskLayout found, READ-ONLY, so the layout canvas can be inspected.
;;
;; Mode "r" is deliberate: this proves visibility without any chance of touching
;; the user's design data on disk.
let((p target)
  p = outfile("/tmp/dsh_views.txt" "w")
  target = nil
  foreach(libname '("OSC_DESIGN" "VB_DEMO" "GPDK090")
    let((d)
      d = ddGetObj(libname)
      when(d
        foreach(c d->cells
          fprintf(p "%s/%s:" libname c->name)
          foreach(v c->views
            fprintf(p " %s[%s]" v->name v->viewType)
            when(v->viewType == "maskLayout" && null(target)
              target = list(libname c->name v->name)
            )
          )
          fprintf(p "\n")
        )
      )
    )
  )
  fprintf(p "TARGET=%L\n" target)
  when(target
    let((cv win)
      cv = dbOpenCellViewByType(nth(0 target) nth(1 target) nth(2 target) "maskLayout" "r")
      fprintf(p "OPENED=%L\n" cv)
      when(cv
        win = hiGetCurrentWindow()
        fprintf(p "WINDOW=%L\n" win)
      )
    )
  )
  close(p)
  t
)
