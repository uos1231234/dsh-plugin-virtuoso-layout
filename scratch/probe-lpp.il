/* Why does dbCreateRect fail in the new library?
 *
 * Three candidate causes, tested against DSH_LAYOUT in one run:
 *   V1  the layer is not called "Metal1"      -> try the bridge's example name "M1"
 *   V2  the purpose is not called "drawing"
 *   V3  names do not resolve at all, but real LPP objects do
 * For V3 a genuine LPP object is borrowed from a VB_DEMO shape (opened read-only),
 * which also prints that shape's own layer/purpose, giving the authoritative name
 * in the same run. Nothing in VB_DEMO is modified.
 */
let((out srcCv dstCv srcLpp v1 v2 v3 nsrc)
  out = ""
  srcCv = car(errset(dbOpenCellViewByType("VB_DEMO" "demo_showcase" "layout" "maskLayout" "r") t))
  nsrc = 0
  srcLpp = nil
  when(srcCv
    nsrc = length(srcCv~>shapes)
    when(car(srcCv~>shapes)
      srcLpp = car(srcCv~>shapes)~>lpp))
  out = strcat(out sprintf(nil "VB_DEMO/demo_showcase shapes=%d first-lpp=%L\n" nsrc srcLpp))

  dstCv = car(errset(dbOpenCellViewByType("DSH_LAYOUT" "dsh_demo" "layout" "maskLayout" "a") t))
  out = strcat(out sprintf(nil "dst-cv=%L\n" dstCv))
  when(dstCv
    v1 = errset(dbCreateRect(dstCv list("Metal1" "drawing") list(list(0 0) list(2 2))) t)
    v2 = errset(dbCreateRect(dstCv list("M1" "drawing") list(list(4 0) list(6 2))) t)
    v3 = nil
    when(srcLpp
      v3 = errset(dbCreateRect(dstCv srcLpp list(list(8 0) list(10 2))) t)))
  out = strcat(out sprintf(nil "V1 Metal1/drawing -> %L\nV2 M1/drawing -> %L\nV3 borrowed-lpp -> %L\n" v1 v2 v3))
  out)
