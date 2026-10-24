/* Open the new cell in a layout window so it can be seen and screenshotted. */
let((win)
  win = car(errset(geOpen(?lib "DSH_LAYOUT" ?cell "dsh_demo" ?view "layout" ?viewType "maskLayout" ?mode "a") t))
  sprintf(nil "opened-window=%L" win))
