@echo off
color 1F
mode con: cols=80 lines=30
if not exist node_modules (
    echo Installing dependencies...
    npm install
)


echo   ____         _         _      _                                 
echo  ^|  _ \       ^(_^)       ^| ^|    ^| ^|                                
echo  ^| ^|_^) ^| _ __  _   __ _ ^| ^|__  ^| ^|_  ___  _ __    __ _   ___  ___ 
echo  ^|  _ ^< ^| '__^|^| ^| / _` ^|^| '_ \ ^| __^|/ __^|^| '_ \  / _` ^| / __^|/ _ \
echo  ^| ^|_^) ^|^| ^|   ^| ^|^| ^(_^| ^|^| ^| ^| ^|^| ^|_ \__ \^| ^|_^) ^|^| ^(_^| ^|^| ^(__^|  __/
echo  ^|____/ ^|_^|__ ^|_^| \__, ^|^|_^| ^|_^| \__^|^|___/^| .__/  \__,_^| \___^|\___^|
echo  ^|__ \ ^|  __ \     __/ ^|                 ^| ^|                      
echo     ^) ^|^| ^|  ^| ^|  _^|___/ ___ __  __       ^|_^|                      
echo    / / ^| ^|  ^| ^| / _ \  / __^|\ \/ /                                
echo   / /_ ^| ^|__^| ^|^| ^(_^) ^|^| ^(__  ^>  ^<                                 
echo  ^|____^|^|_____/  \___/  \___^|/_/\_\ 
echo.
set /p "zipFile=Drag your zip file here and press Enter: "
node BrightspaceToDoc.js "%zipFile%"
pause






                                                        
                                                        