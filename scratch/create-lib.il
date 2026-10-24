/* Draw in DSH_LAYOUT using the bridge's own library recipe.
 *
 * The correction that mattered, taken from
 * virtuoso_bridge/virtuoso/library/management.py:
 *   ddCreateLib(NAME PATH)        -> PATH is the LIBRARY directory, not a techfile
 *   techBindTechFile(LIB TECHLIB) -> TECHLIB is a technology LIBRARY NAME, not a
 *                                    techfile path
 * and the binding is verified the way the bridge verifies it:
 *   techGetTechLibName(LIB) == TECHLIB
 * Passing a techfile path to either call does not raise; it just leaves the
 * cellview unable to resolve layer names, which is why every dbCreateRect failed
 * with no usable error message.
 *
 * Other rules obeyed: errset returns (value) or nil, so unwrap with car();
 * `if(...)` never appears as a function argument; every step is guarded.
 */
let((lib cv bound techName n made saved msg libName cellName techOk readPath
     r1 r2 r3 r4 r5 shapeText)
  lib = ddGetObj("DSH_LAYOUT")
  readPath = "NO-PATH"
  techName = "NO-TECHLIB"
  techOk = "NOT-BOUND"
  when(lib
    readPath = lib~>readPath
    bound = errset(techBindTechFile(lib "VB_DEMO") t)
    techName = car(errset(techGetTechLibName(lib) t))
    when(techName == "VB_DEMO" techOk = "bound-to-VB_DEMO"))

  cv = nil
  when(lib
    cv = car(errset(dbOpenCellViewByType("DSH_LAYOUT" "dsh_demo" "layout" "maskLayout" "a") t)))

  made = 0
  when(cv
    r1 = errset(dbCreateRect(cv list("Metal1" "drawing") list(list(0 8) list(40 12))) t)
    r2 = errset(dbCreateRect(cv list("Metal1" "drawing") list(list(18 0) list(22 20))) t)
    r3 = errset(dbCreateRect(cv list("Poly" "drawing") list(list(2 2) list(6 6))) t)
    r4 = errset(dbCreateRect(cv list("Metal2" "drawing") list(list(30 14) list(38 18))) t)
    r5 = errset(dbCreateRect(cv list("Cont" "drawing") list(list(33 15) list(35 17))) t))
  foreach(r list(r1 r2 r3 r4 r5)
    when(r made = made + 1))

  saved = nil
  when(cv
    saved = car(errset(dbSave(cv) t)))

  if(cv then n = length(cv~>shapes) else n = 0)
  if(lib then libName = lib~>name else libName = "NO-LIB")
  if(cv then cellName = cv~>cellName else cellName = "NO-CV")
  shapeText = ""
  when(cv
    foreach(s cv~>shapes
      shapeText = strcat(shapeText sprintf(nil "  %s %L %L\n" s~>objType s~>lpp s~>bBox))))

  msg = sprintf(nil "lib=%L path=%L cv=%L techlib=%L state=%L made=%d saved=%L shapes=%d\n%s"
    libName readPath cellName techName techOk made saved n shapeText)
  msg)
