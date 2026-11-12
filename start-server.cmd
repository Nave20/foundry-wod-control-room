@echo off
title Control Room - mini-server
cd /d "%~dp0"
echo Mini-serveur de la salle de controle. Laisse cette fenetre ouverte pendant la partie ; ferme-la pour l'arreter.
echo.
python server\control_room_server.py http
echo.
echo Le serveur s'est arrete.
pause
