@echo off
color 1F
mode con: cols=80 lines=30
echo " ____  ____   __    ___  _  _  ____  ____  ____   __    ___  ____ "
echo "(  _ \(  _ \ (  )  / __)/ )( \(_  _)/ ___)(  _ \ / _\  / __)(  __)"
echo " ) _ ( )   /  )(  ( (_ \) __ (  )(  \___ \ ) __//    \( (__  ) _) "
echo "(____/(__\_) (__)  \___/\_)(_/ (__) (____/(__)  \_/\_/ \___)(____)"
echo "       ____   __         ____   __    ___  _  _                   "
echo "      (_  _) /  \       (    \ /  \  / __)( \/ )                  "
echo "        )(  (  O )       ) D ((  O )( (__  )  (                   "
echo "       (__)  \__/       (____/ \__/  \___)(_/\_)                  "                                                                                                           ";
echo.
set /p "zipFile=Drag your zip file here and press Enter: "
node BrightspaceToDoc.js "%zipFile%"
pause