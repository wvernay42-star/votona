# Installe la relance quotidienne des inactifs Votona sur ce PC (tous les
# jours à 6h), en une seule commande. À lancer depuis la racine du dépôt :
#
#   powershell -ExecutionPolicy Bypass -File scripts\installer-relance.ps1
#
# Étapes : vérifie Node.js, demande les clés (une seule fois, stockées dans
# .env.local, ignoré par git), fait un essai à blanc, puis crée la tâche
# planifiée "Votona - relance inactifs". Relançable sans risque : les clés
# existantes sont gardées et la tâche est simplement mise à jour.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$TaskName = 'Votona - relance inactifs'

function Fail($msg) {
  Write-Host ''
  Write-Host "ÉCHEC : $msg" -ForegroundColor Red
  exit 1
}

Write-Host '== 1/4 Node.js' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js introuvable. Installe la version LTS depuis https://nodejs.org puis relance ce script.'
}
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) { Fail "Node.js 18 ou plus récent requis (version actuelle : $(& node -v))." }
Write-Host "OK ($(& node -v))"

Write-Host '== 2/4 Clés Supabase et Brevo' -ForegroundColor Cyan
$envFile = Join-Path $Root '.env.local'
$hasKeys = $false
if (Test-Path $envFile) {
  $content = Get-Content $envFile -Raw
  $hasKeys = ($content -match '(?m)^SUPABASE_SERVICE_ROLE_KEY=\S') -and ($content -match '(?m)^BREVO_API_KEY=\S')
}
if ($hasKeys) {
  Write-Host 'Déjà présentes dans .env.local (supprime ce fichier pour les ressaisir).'
} else {
  Write-Host 'Tu les trouves dans Vercel > projet votona > Settings > Environment Variables.'
  $sbKey = (Read-Host 'Colle SUPABASE_SERVICE_ROLE_KEY').Trim()
  $brKey = (Read-Host 'Colle BREVO_API_KEY').Trim()
  if (-not $sbKey -or -not $brKey) { Fail 'Clé vide.' }
  $text = "SUPABASE_SERVICE_ROLE_KEY=$sbKey`r`nBREVO_API_KEY=$brKey`r`n"
  [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
  Write-Host 'Enregistrées dans .env.local (ignoré par git).'
}

Write-Host '== 3/4 Essai à blanc (aucun email envoyé)' -ForegroundColor Cyan
& node scripts\relance-inactifs.js --dry-run
if ($LASTEXITCODE -ne 0) { Fail "L'essai à blanc a échoué (clés incorrectes ?). Supprime .env.local et relance ce script." }

Write-Host '== 4/4 Tâche planifiée tous les jours à 6h' -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute (Join-Path $Root 'scripts\relance-inactifs.cmd') -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At '06:00'
# StartWhenAvailable : rattrape le passage manqué si le PC était éteint à 6h.
# WakeToRun : sort le PC de veille pour l'exécuter.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Relance email des utilisateurs inactifs Votona + notifications de parrainage (scripts\relance-inactifs.js).' -Force | Out-Null
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "OK : prochaine exécution le $($info.NextRunTime)"

Write-Host ''
Write-Host 'Terminé.' -ForegroundColor Green
Write-Host "Journal des exécutions : $Root\logs\relance-inactifs.log"
Write-Host "Lancer tout de suite  : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Désinstaller           : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
