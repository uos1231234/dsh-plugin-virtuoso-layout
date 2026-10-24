; Set the view on window 26 so the cell fills the canvas.
; 'f' (fit) did nothing here because the window was already at a legal zoom --
; the cell is simply small on screen. hiZoomAbsoluteScale is what the status bar
; was already showing, so drive that directly with a scale that suits a
; 2.06 x 3.81 um cell in a ~600 px canvas.
let(( w out )
  out = ""
  w = hiGetCurrentWindow()
  out = strcat(out sprintf(nil "current=%L\n" w))
  when( w
    errset( hiZoomAbsoluteScale(w 0.35) )
    ; and centre it on the cell
    errset( hiSetCurrentWindow(w) )
    out = strcat(out sprintf(nil "after zoom: %L\n" w~>viewBox)) )
  out)