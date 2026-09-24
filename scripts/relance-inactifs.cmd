@echo off
REM Lance la relance des inactifs et ajoute la sortie au journal
REM logs\relance-inactifs.log (a la racine du depot, ignore par git).
REM
REM Planifier tous les jours a 6h (a executer une fois dans un terminal) :
REM   schtasks /create /tn "Votona - relance inactifs" /sc daily /st 06:00 /tr "\"%CD%\scripts\relance-inactifs.cmd\""
REM (depuis la racine du depot). Pour tester tout de suite :
REM   schtasks /run /tn "Votona - relance inactifs"
cd /d "%~dp0.."
if not exist logs mkdir logs
node scripts\relance-inactifs.js %* >> logs\relance-inactifs.log 2>&1
