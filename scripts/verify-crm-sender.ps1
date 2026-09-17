param([switch]$SendTest)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$credential=Import-Clixml -LiteralPath (Join-Path $root '.tmp\crm-release-secrets.xml')
try {
  $settings=$credential.GetNetworkCredential().Password | ConvertFrom-Json
  $token=Invoke-RestMethod -Uri 'https://accounts.zoho.eu/oauth/v2/token' -Method Post -ContentType 'application/x-www-form-urlencoded' -Body @{grant_type='refresh_token';refresh_token=$settings.ZOHO_REFRESH_TOKEN;client_id=$settings.ZOHO_CLIENT_ID;client_secret=$settings.ZOHO_CLIENT_SECRET} -MaximumRedirection 0 -TimeoutSec 30
  if (!$token.access_token) {throw 'No access token'}
  $headers=@{Authorization='Zoho-oauthtoken '+$token.access_token}
  $base='https://mail.zoho.eu/api/accounts/'+$settings.ZOHO_ACCOUNT_ID
  $account=Invoke-RestMethod -Uri $base -Headers $headers -MaximumRedirection 0 -TimeoutSec 30
  $sender=@($account.data.sendMailDetails | Where-Object fromAddress -eq 'nathan@nc-digital.co.uk')
  [ordered]@{accountDisplayName=$account.data.displayName;senderDisplayNames=@($sender | ForEach-Object displayName)} | ConvertTo-Json -Compress
  $receiptPath=Join-Path $root '.tmp\crm-sender-test.json'
  if ($SendTest) {
    $payload=@{fromAddress='NC Digital <nathan@nc-digital.co.uk>';toAddress='info@nc-digital.co.uk';subject='NC Digital sender display verification';content='This is the authorised CRM sender-name test. Future CRM emails should display NC Digital as the sender.';mailFormat='plaintext';encoding='UTF-8'}
    $sent=Invoke-RestMethod -Uri ($base+'/messages') -Headers $headers -Method Post -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Compress) -MaximumRedirection 0 -TimeoutSec 30
    if (!$sent.data.messageId -or [int]$sent.status.code -ge 400) {throw 'No valid sending receipt'}
    @{messageId=[string]$sent.data.messageId} | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
  }
  $receipt=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $original=Invoke-WebRequest -Uri ($base+'/messages/'+$receipt.messageId+'/originalmessage') -Headers $headers -MaximumRedirection 0 -TimeoutSec 30
  $mime=$original.Content
  if ($mime -is [byte[]]) {$mime=[Text.Encoding]::UTF8.GetString($mime)}
  if ($mime.TrimStart().StartsWith('{')) {
    $parsed=$mime | ConvertFrom-Json
    $mime=$parsed.data.content
    if (!$mime) {$mime=$parsed.data.originalMessage}
    if (!$mime) {Write-Output ('Response data fields: '+($parsed.data.PSObject.Properties.Name -join ','));throw 'MIME response unavailable'}
  }
  $from=[regex]::Match($mime,'(?im)^From:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*').Value
  if (!$from) {throw 'Sender header unavailable'}
  [ordered]@{messageId=$receipt.messageId;senderHeader=$from;verified=($from -match 'NC Digital' -and $from -match 'nathan@nc-digital.co.uk')} | ConvertTo-Json -Compress
} catch {Write-Error ('Sender verification failed: '+$_.Exception.GetType().Name+' at line '+$_.InvocationInfo.ScriptLineNumber);exit 1}
finally {$credential.Password.Dispose();$settings=$token=$headers=$account=$original=$null}
