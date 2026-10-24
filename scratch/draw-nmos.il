;; DSH / virtoso-layout : draw one simple but REAL single-finger NMOS.
;;
;; Reference = a pre-existing hand-drawn cell in the same library tree
;; (<GUEST_HOME>/project/<ref_lib>/<ref_cell>/nmos,
;; 31 rects, bbox (0.715 -0.835) (4.965 1.34), tech smic18ee) whose layer stack is
;;     AA drawing / GP drawing / CT drawing / SN drawing / SP drawing / M1 drawing
;; and whose conventions are: gate L = 0.18 um, contact 0.22 x 0.22,
;; implant over active by 0.10, metal over contact by ~0.08.  This cell imitates that
;; stack and those conventions at single-finger scale - it is NOT a copy of the cell.
;;
;; NOT claimed to be DRC-clean: the SMIC deck is not available here
;; (<GUEST_HOME>/project/<ref_lib>/rules is 0 bytes), so no rule checker was run.

procedure( DSH_NMOS_RECT(cv ln x0 y0 x1 y1)
  dbCreateRect(cv list(ln "drawing") list(list(x0 y0) list(x1 y1)))
)

let((out lib cv)
  out = ""
  lib = ddGetObj("DSH_NMOS")
  if(lib then
    out = strcat(out "LIB             exists\n")
  else
    lib = ddCreateLib("DSH_NMOS" "<GUEST_HOME>/DSH_NMOS")
    out = strcat(out sprintf(nil "LIB             created %L\n" lib))
  )
  out = strcat(out sprintf(nil "TECH bind       %L\n" errset(techBindTechFile(lib "smic18ee"))))
  out = strcat(out sprintf(nil "TECH attached   %L\n" errset(techGetTechLibName(lib))))

  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos" "layout" "maskLayout" "a")
  out = strcat(out sprintf(nil "CELLVIEW open   %L\n" cv))

  ;; 1. active: W = 1.20 um device bar, plus a p+ tap bar below it
  DSH_NMOS_RECT(cv "AA" 0.30  0.00 2.10  1.20)
  DSH_NMOS_RECT(cv "AA" 0.30 -0.90 2.10 -0.50)
  ;; 2. gate: L = 0.18 um finger, plus a wider pad above the active for its contact
  DSH_NMOS_RECT(cv "GP" 1.11 -0.30 1.29 1.68)
  DSH_NMOS_RECT(cv "GP" 1.03  1.20 1.37 1.68)
  ;; 3. implants: n+ over the device, p+ over the tap
  DSH_NMOS_RECT(cv "SN" 0.20 -0.10 2.20 1.30)
  DSH_NMOS_RECT(cv "SP" 0.20 -1.00 2.20 -0.40)
  ;; 4. contacts, 0.22 x 0.22
  DSH_NMOS_RECT(cv "CT" 1.09  1.32 1.31  1.54)   ; gate
  DSH_NMOS_RECT(cv "CT" 0.60  0.16 0.82  0.38)   ; source, two rows
  DSH_NMOS_RECT(cv "CT" 0.60  0.72 0.82  0.94)
  DSH_NMOS_RECT(cv "CT" 1.58  0.16 1.80  0.38)   ; drain, two rows
  DSH_NMOS_RECT(cv "CT" 1.58  0.72 1.80  0.94)
  DSH_NMOS_RECT(cv "CT" 0.99 -0.81 1.21 -0.59)   ; bulk tap
  DSH_NMOS_RECT(cv "CT" 1.61 -0.81 1.83 -0.59)
  ;; 5. metal 1
  DSH_NMOS_RECT(cv "M1" 1.01  1.24 1.39  1.62)   ; gate strap
  DSH_NMOS_RECT(cv "M1" 0.50  0.10 0.90  1.00)   ; source
  DSH_NMOS_RECT(cv "M1" 1.50  0.10 1.90  1.00)   ; drain
  DSH_NMOS_RECT(cv "M1" 0.91 -0.88 1.29 -0.52)   ; bulk tap
  DSH_NMOS_RECT(cv "M1" 1.53 -0.88 1.91 -0.52)

  out = strcat(out sprintf(nil "SHAPES drawn    %L\n" length(cv~>shapes)))
  out = strcat(out sprintf(nil "SAVE            %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "SAVED shapes    %L\n" length(cv~>shapes)))
  out = strcat(out sprintf(nil "BBOX            %L\n" cv~>bBox))
  out
)
