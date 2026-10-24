; Save the VB_DEMO / demo_showcase layout cellview that window 21 has open with
; unsaved edits.  dbOpenCellViewByType() with mode "a" hands back the SAME
; cellview the layout editor is already editing, so dbSave() persists exactly
; the user's unsaved edits -- and this program never touches any other window
; (window 20 holds the user's unsaved schematic, which must not be saved).
prog((cv res)
  cv = dbOpenCellViewByType("VB_DEMO" "demo_showcase" "layout" "maskLayout" "a")
  if(cv then
    res = dbSave(cv)
    sprintf(nil "saved=%L lib=%s cell=%s view=%s" res cv~>lib~>name cv~>cell~>name cv~>viewName)
  else
    "could not open VB_DEMO demo_showcase layout"
  )
)
