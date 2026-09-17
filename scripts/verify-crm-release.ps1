param([switch]$DownloadBackup,[switch]$RunBackup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$credential = Import-Clixml -LiteralPath (Join-Path $root '.tmp\crm-release-secrets.xml')
try {
  $settings = $credential.GetNetworkCredential().Password | ConvertFrom-Json
  $headers = @{Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('nathan:' + $settings.ADMIN_PASSWORD))}
  $origin = 'https://nc-digital.co.uk'
  $results = [ordered]@{}
  if ($RunBackup) {
    $backupHeaders = $headers.Clone(); $backupHeaders.Origin = $origin
    $results['manual_backup'] = Invoke-RestMethod -Uri ($origin + '/admin/crm/api/workspace/backup-now') -Headers $backupHeaders -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 90
  }
  foreach ($route in @('options','today','reports','list?entity=contacts','list?entity=accounts&tag=Hosting','health')) {
    $data = Invoke-RestMethod -Uri ($origin + '/admin/crm/api/workspace/' + $route) -Headers $headers -TimeoutSec 30
    $results[$route] = 'OK'
    if ($route -eq 'health') { $results['mailbox_sync_error'] = $data.sync_error; $results['backup'] = $data.backup }
  }
  $page = Invoke-WebRequest -Uri ($origin + '/admin/crm/') -Headers $headers -TimeoutSec 30
  if (!$page.Content.Contains('data-view="reports"') -or !$page.Content.Contains('data-view="contacts"')) {throw 'New CRM shell missing'}
  $results['new_crm_shell'] = 'OK'
  if ($DownloadBackup) {
    Invoke-WebRequest -Uri ($origin + '/admin/crm/api/workspace/backup') -Headers $headers -TimeoutSec 60 -OutFile (Join-Path $root '.tmp\crm-live-cloud-backup.json.gz')
    $results['backup_download'] = 'OK'
  }
  $results | ConvertTo-Json -Depth 5
} catch { Write-Error ('CRM verification failed: '+$_.Exception.GetType().Name+' at line '+$_.InvocationInfo.ScriptLineNumber); exit 1 }
finally { $credential.Password.Dispose(); $settings=$headers=$null }
