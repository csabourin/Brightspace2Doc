@echo off
echo Checking for npm...
where npm >nul 2>nul
if %errorlevel% == 0 (
    echo npm is already installed.
    goto runScript
) else (
    echo Nodejs is not installed.
    :installPrompt
    echo Do you want to install npm? ^(Y/N^)
    set /p choice=
   if /I "%choice%"=="Y" goto install
    if /I "%choice%"=="y" goto install
    if /I "%choice%"=="N" goto end
    if /I "%choice%"=="n" goto end
    echo Invalid choice. Please enter Y or N.
    goto installPrompt
    :install
    echo Installing npm...
    start "" "https://nodejs.org/en/download/"
    echo Please download and install Node.js from the link above, which includes npm.
)
echo Exiting script...
pause
goto end
:runScript
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
:end
pause
