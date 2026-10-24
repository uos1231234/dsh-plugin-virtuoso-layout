; Find the actual failing expression by doing it in SMALL steps, each with its
; own errset, so the error text survives. The whole-body versions reported only
; "load ... at line N" because a failure inside a nested let propagates out of
; the wrapper without a locatable message.
;
; This also tests the one construct I suspect: (MxL0+MxL1)/2 written inline as a
; point coordinate. SKILL is happy with arithmetic in a list, but a bare
; parenthesised sum inside `list(...)` can be misread, so give it a name.

let(( out r )
  out = ""

  ; step 1: open + clear
  r = errset( let(( cv ) cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
                   foreach( s cv~>shapes dbDeleteObject(s) ) length(cv~>shapes) ) )
  out = strcat(out sprintf(nil "1 open+clear  %L\n" r))

  ; step 2: one rect with computed coordinates from named variables
  r = errset( let(( cv x0 x1 )
                   cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
                   x0 = 0.30  x1 = 2.90
                   dbCreateRect( cv list("AA" "drawing") list(list(x0 0.0) list(x1 1.4)) )
                   length(cv~>shapes) ) )
  out = strcat(out sprintf(nil "2 rect        %L\n" r))

  ; step 3: a label whose origin is computed from a named midpoint
  r = errset( let(( cv mx my )
                   cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
                   mx = (0.5 + 0.9) / 2
                   my = (0.1 + 1.1) / 2
                   dbCreateLabel( cv list("M1" "pin") list(mx my) "D" "centerCenter" "R0" "roman" 0.12 )
                   length(cv~>shapes) ) )
  out = strcat(out sprintf(nil "3 label named %L\n" r))

  ; step 4: the same label but with the midpoint inline, to see if THAT is the fault
  r = errset( let(( cv )
                   cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
                   dbCreateLabel( cv list("M1" "pin") list((0.5+0.9)/2 0.6) "X" "centerCenter" "R0" "roman" 0.12 )
                   length(cv~>shapes) ) )
  out = strcat(out sprintf(nil "4 label inline %L\n" r))

  ; step 5: nested let with many bindings (the construct used by the big script)
  r = errset( let(( a b c d ) a = 1.0 b = 2.0 c = 3.0 d = 4.0
                   let(( e f ) e = a + b  f = c + d  list(e f) ) ) )
  out = strcat(out sprintf(nil "5 nested let  %L\n" r))

  out)