; Which part of t2 breaks? Test the subtraction forms one at a time.
let(( a b c d out )
  a = (- 0.30 0.18)
  b = (- 0.00 0.18)
  c = (+ 2.10 0.18)
  d = (+ 1.20 0.18)
  out = sprintf(nil "a=%L b=%L c=%L d=%L" a b c d)
  out)