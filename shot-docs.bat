@echo off
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE% set EDGE="C:\Program Files\Microsoft\Edge\Application\msedge.exe"
start /wait "" %EDGE% --headless=new --disable-gpu --hide-scrollbars --window-size=1500,1700 --virtual-time-budget=12000 --user-data-dir="%~dp0_u_dc" --host-resolver-rules="MAP frenzo.tech 45.153.130.144" --ignore-certificate-errors --screenshot="%~dp0shot-docs.png" "https://frenzo.tech/?d=mint"