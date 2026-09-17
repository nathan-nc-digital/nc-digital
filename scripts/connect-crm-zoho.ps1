param([switch]$SelfTest, [switch]$StorageTest)

$ErrorActionPreference = 'Stop'

function Stop-CrmSetupFailure {
    param([string]$Message)
    # Only call with locally constructed messages, never provider text.
    $failure = [InvalidOperationException]::new($Message)
    $failure.Data['CrmSafeDiagnostic'] = $Message
    throw $failure
}

function Get-CrmProviderDiagnostic {
    param($Payload, $Failure)
    if ($Failure -and $Failure.ErrorDetails.Message) {
        try { $Payload = $Failure.ErrorDetails.Message | ConvertFrom-Json -ErrorAction Stop } catch { $Payload = $null }
    }
    # Exact allowlist: unknown errors, descriptions and response bodies stay private.
    $known = @{
        invalid_code = 'Zoho returned invalid_code. Generate a fresh code in the same EU Self Client and paste it immediately.'
        invalid_client = 'Zoho returned invalid_client. Check the Client ID and that the Self Client was created at api-console.zoho.eu.'
        invalid_client_secret = 'Zoho returned invalid_client_secret. Copy the Client Secret from the same EU Self Client.'
        invalid_scope = 'Zoho returned invalid_scope. Generate a code with the three scopes shown above.'
        invalid_redirect_uri = 'Zoho returned invalid_redirect_uri. This helper requires a Self Client, not a server-based client.'
        invalid_grant = 'Zoho returned invalid_grant. Generate a fresh code from the same EU Self Client.'
        access_denied = 'Zoho returned access_denied. Check account access and organisation policy.'
        OAUTH_SCOPE_MISMATCH = 'Zoho returned OAUTH_SCOPE_MISMATCH. Include ZohoMail.accounts.READ when generating the code.'
        INVALID_OAUTHTOKEN = 'Zoho returned INVALID_OAUTHTOKEN. Check the EU account region and generate a fresh code.'
    }
    foreach ($candidate in @($Payload.error, $Payload.data.errorCode)) {
        if ($candidate -is [string] -and $known.ContainsKey($candidate)) { return $known[$candidate] }
    }
    if ($Failure -and $Failure.Exception.Response) {
        $httpStatus = 0
        if ([int]::TryParse([string][int]$Failure.Exception.Response.StatusCode, [ref]$httpStatus) -and $httpStatus -ge 100 -and $httpStatus -le 599) {
            return ('Zoho returned HTTP {0}. Check API access, requested scopes and account policy.' -f $httpStatus)
        }
    }
    if ($Failure -and $Failure.Exception -is [System.Net.WebException]) {
        switch ($Failure.Exception.Status) {
            'NameResolutionFailure' { return 'DNS lookup failed. Check the internet connection and DNS settings.' }
            'ConnectFailure' { return 'Could not connect to Zoho. Check the internet connection, proxy and firewall.' }
            'Timeout' { return 'The Zoho request timed out. Retry with a fresh code.' }
            'TrustFailure' { return 'The HTTPS certificate check failed. Check Windows time and proxy settings.' }
            'SecureChannelFailure' { return 'The secure HTTPS connection failed. Check Windows TLS and proxy settings.' }
        }
    }
    return 'No recognised provider error was available. Raw error details were withheld to protect credentials.'
}

function Get-CrmZohoConnection {
    param([string]$ClientId, [string]$ClientSecret, [string]$Code, [scriptblock]$Transport)

    try {
        $token = & $Transport @{
            Method = 'Post'
            Uri = 'https://accounts.zoho.eu/oauth/v2/token'
            ContentType = 'application/x-www-form-urlencoded'
            Body = @{ grant_type = 'authorization_code'; client_id = $ClientId; client_secret = $ClientSecret; code = $Code }
        }
    } catch {
        Stop-CrmSetupFailure ('Authorisation request failed. ' + (Get-CrmProviderDiagnostic -Failure $_))
    }
    if (!$token.access_token -or !$token.refresh_token -or $token.error) {
        Stop-CrmSetupFailure ('Authorisation failed: Zoho did not issue the required tokens. ' + (Get-CrmProviderDiagnostic -Payload $token))
    }
    try {
        $accounts = & $Transport @{
            Method = 'Get'
            Uri = 'https://mail.zoho.eu/api/accounts'
            Headers = @{ Authorization = "Zoho-oauthtoken $($token.access_token)" }
        }
    } catch {
        Stop-CrmSetupFailure ('Authorisation succeeded, but the mailbox request failed. ' + (Get-CrmProviderDiagnostic -Failure $_))
    }
    if ($accounts.error -or $accounts.data.errorCode -or ($accounts.status.code -and [string]$accounts.status.code -ne '200')) {
        Stop-CrmSetupFailure ('Authorisation succeeded, but Zoho rejected the mailbox check. ' + (Get-CrmProviderDiagnostic -Payload $accounts))
    }
    $matching = @($accounts.data | Where-Object {
        $_.type -eq 'ZOHO_ACCOUNT' -and
        ($_.primaryEmailAddress -eq 'nathan@nc-digital.co.uk' -or $_.mailboxAddress -eq 'nathan@nc-digital.co.uk')
    })
    if ($matching.Count -ne 1 -or [string]$matching[0].accountId -notmatch '^\d+$') {
        Stop-CrmSetupFailure 'Mailbox verification failed: no unique native Nathan mailbox with a valid account ID was found. Sign in as nathan@nc-digital.co.uk and try again.'
    }
    if ($matching[0].enabled -eq $false -or $matching[0].outgoingBlocked -eq $true) {
        Stop-CrmSetupFailure 'Mailbox verification failed: Zoho reports that this mailbox is disabled or outgoing mail is blocked. Check its mail settings before continuing.'
    }
    return @{
        ZOHO_REGION = 'eu'
        ZOHO_ACCOUNT_ID = [string]$matching[0].accountId
        ZOHO_CLIENT_ID = $ClientId
        ZOHO_CLIENT_SECRET = $ClientSecret
        ZOHO_REFRESH_TOKEN = [string]$token.refresh_token
    }
}

function Read-CrmSecret {
    param([string]$Label)
    $secure = Read-Host $Label -AsSecureString
    try {
        $value = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
        if (!$value -or $value -match '[\r\n]') { Stop-CrmSetupFailure 'A required value was empty or contained a line break. Paste one complete value at each prompt.' }
        return $value
    } finally { $secure.Dispose() }
}

function New-CrmSecureString {
    param([Parameter(Mandatory)][string]$Value)
    # Use .NET directly: GUI-launched PowerShell may not resolve the Security module.
    $secureValue = [System.Security.SecureString]::new()
    try {
        for ($index = 0; $index -lt $Value.Length; $index++) {
            $secureValue.AppendChar($Value[$index])
        }
        $secureValue.MakeReadOnly()
        return $secureValue
    } catch {
        $secureValue.Dispose()
        throw
    }
}

function Save-CrmZohoCredential {
    param([System.Collections.IDictionary]$Connection, [string]$Path)
    $securePayload = $null
    $storageStep = 'preparing credential fields'
    try {
        # Copy only the required scalar values, stripping any PowerShell metadata.
        $plain = @{}
        foreach ($key in @('ZOHO_REGION', 'ZOHO_ACCOUNT_ID', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN')) {
            if ($Connection[$key] -isnot [string] -or [string]::IsNullOrWhiteSpace($Connection[$key])) {
                Stop-CrmSetupFailure 'Credential preparation failed: a required connection value is missing or is not text.'
            }
            $plain[$key] = [string]::new($Connection[$key].ToCharArray())
        }
        $storageStep = 'serialising credential fields to JSON'
        $json = ConvertTo-Json -InputObject $plain -Compress
        $storageStep = 'converting JSON to a Windows SecureString'
        $securePayload = New-CrmSecureString -Value $json
        $storageStep = 'constructing the Windows credential'
        $savedCredential = [PSCredential]::new('nathan@nc-digital.co.uk', $securePayload)
        $storageStep = 'encrypting and writing the credential file'
        $savedCredential | Export-Clixml -LiteralPath $Path -NoClobber
    } catch {
        if ($_.Exception.Data['CrmSafeDiagnostic']) { throw }
        # Runtime type names and line numbers contain no credential values.
        $errorKind = $_.Exception.GetType().Name
        Stop-CrmSetupFailure ('Local storage failed while {0}. Error type: {1}; script line: {2}. No raw error details were printed.' -f $storageStep, $errorKind, $_.InvocationInfo.ScriptLineNumber)
    } finally {
        if ($securePayload) { $securePayload.Dispose() }
        $plain = $json = $savedCredential = $securePayload = $null
    }
}

function Test-CrmCredentialStorage {
    param([string]$Directory)
    $probePath = Join-Path $Directory ('crm-zoho-storage-test-' + [guid]::NewGuid().ToString('N') + '.xml')
    $dummy = @{
        ZOHO_REGION = 'eu'; ZOHO_ACCOUNT_ID = '1234567890123456789'
        ZOHO_CLIENT_ID = 'dummy-client'; ZOHO_CLIENT_SECRET = 'dummy-secret'; ZOHO_REFRESH_TOKEN = 'dummy-refresh'
    }
    try {
        $null = New-Item -ItemType Directory -Path $Directory -Force
        Save-CrmZohoCredential -Connection $dummy -Path $probePath
        $probeXml = Get-Content -LiteralPath $probePath -Raw
        if ($probeXml.Contains('dummy-secret') -or $probeXml.Contains('dummy-refresh')) {
            Stop-CrmSetupFailure 'Local storage test failed: the synthetic credential was not encrypted.'
        }
        $probe = Import-Clixml -LiteralPath $probePath
        $decodedProbe = $probe.GetNetworkCredential().Password | ConvertFrom-Json
        foreach ($key in $dummy.Keys) {
            if ($decodedProbe.$key -cne $dummy[$key]) { Stop-CrmSetupFailure 'Local storage test failed: the synthetic credential could not be restored accurately.' }
        }
    } catch {
        if ($_.Exception.Data['CrmSafeDiagnostic']) { throw }
        Stop-CrmSetupFailure ('Local storage test failed while creating or verifying its temporary file. Error type: {0}; script line: {1}.' -f $_.Exception.GetType().Name, $_.InvocationInfo.ScriptLineNumber)
    } finally {
        # Delete only this uniquely named synthetic probe, never a connection file.
        if (Test-Path -LiteralPath $probePath) { Remove-Item -LiteralPath $probePath -Force }
        if ($probe) { $probe.Password.Dispose() }
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This helper requires Windows so credentials can be protected with Windows encryption.'
}

if ($SelfTest) {
    Test-CrmCredentialStorage -Directory (Join-Path (Split-Path -Parent $PSScriptRoot) '.tmp')
    $script:testCalls = 0
    $mock = {
        param($request)
        $script:testCalls++
        if ($script:testCalls -eq 1) {
            if ($request.Uri -ne 'https://accounts.zoho.eu/oauth/v2/token' -or $request.Body.code -ne 'fake-code') { throw 'Bad token request' }
            return @{ access_token = 'fake-access'; refresh_token = 'fake-refresh' }
        }
        if ($request.Method -ne 'Get' -or $request.Uri -ne 'https://mail.zoho.eu/api/accounts') { throw 'Bad mailbox request' }
        return @{ data = @(@{ type = 'ZOHO_ACCOUNT'; primaryEmailAddress = 'nathan@nc-digital.co.uk'; accountId = '1234567890123456789'; enabled = $true }) }
    }
    $result = Get-CrmZohoConnection 'fake-client' 'fake-secret' 'fake-code' $mock
    if ($result.ZOHO_ACCOUNT_ID -ne '1234567890123456789' -or $script:testCalls -ne 2) { throw 'Mailbox test failed' }
    $protected = New-CrmSecureString -Value ($result | ConvertTo-Json -Compress)
    $credential = [PSCredential]::new('nathan@nc-digital.co.uk', $protected)
    $xml = [System.Management.Automation.PSSerializer]::Serialize($credential)
    if ($xml.Contains('fake-secret') -or $xml.Contains('fake-refresh')) { throw 'Credential encryption test failed' }
    $restored = [System.Management.Automation.PSSerializer]::Deserialize($xml)
    $decoded = $restored.GetNetworkCredential().Password | ConvertFrom-Json
    if ($decoded.ZOHO_REFRESH_TOKEN -ne 'fake-refresh') { throw 'Credential round-trip failed' }
    $protected.Dispose()
    $wrongAccount = {
        param($request)
        if ($request.Method -eq 'Post') { return @{ access_token = 'fake-access'; refresh_token = 'fake-refresh' } }
        return @{ data = @(@{ type = 'ZOHO_ACCOUNT'; primaryEmailAddress = 'wrong@example.com'; accountId = '123' }) }
    }
    $rejected = $false
    try { $null = Get-CrmZohoConnection 'fake-client' 'fake-secret' 'fake-code' $wrongAccount } catch { $rejected = $true }
    if (!$rejected) { throw 'Wrong mailbox was accepted' }
    $safeFailure = $false
    try { $null = Get-CrmZohoConnection 'fake-client' 'fake-secret' 'fake-code' { throw 'fake-secret provider error' } } catch {
        $safeFailure = !$_.Exception.Message.Contains('fake-secret')
    }
    if (!$safeFailure) { throw 'Provider error was not sanitised' }
    $diagnostic = $null
    try {
        $null = Get-CrmZohoConnection 'fake-client' 'fake-secret' 'fake-code' { return @{ error = 'invalid_code'; error_description = 'fake-secret' } }
    } catch { $diagnostic = $_.Exception.Data['CrmSafeDiagnostic'] }
    if (!$diagnostic -or !$diagnostic.Contains('invalid_code') -or $diagnostic.Contains('fake-secret')) { throw 'Token error diagnostic failed' }
    $unknown = Get-CrmProviderDiagnostic -Payload @{ error = 'fake-secret'; data = @{ errorCode = 'fake-refresh' } }
    if ($unknown.Contains('fake-secret') -or $unknown.Contains('fake-refresh')) { throw 'Unknown provider error leaked' }
    $httpFailure = [System.Management.Automation.ErrorRecord]::new([Exception]::new('fake-secret'), 'mock', 'NotSpecified', $null)
    $httpFailure.ErrorDetails = [System.Management.Automation.ErrorDetails]::new('{"error":"invalid_client_secret","description":"fake-secret"}')
    $httpDiagnostic = Get-CrmProviderDiagnostic -Failure $httpFailure
    if (!$httpDiagnostic.Contains('invalid_client_secret') -or $httpDiagnostic.Contains('fake-secret')) { throw 'HTTP error body diagnostic failed' }
    $httpFailure.ErrorDetails = [System.Management.Automation.ErrorDetails]::new('non-JSON fake-secret')
    if ((Get-CrmProviderDiagnostic -Failure $httpFailure).Contains('fake-secret')) { throw 'Non-JSON error body leaked' }
    $mailboxFailure = {
        param($request)
        if ($request.Method -eq 'Post') { return @{ access_token = 'fake-access'; refresh_token = 'fake-refresh' } }
        return @{ status = @{ code = 401 }; data = @{ errorCode = 'OAUTH_SCOPE_MISMATCH'; message = 'fake-secret' } }
    }
    $diagnostic = $null
    try { $null = Get-CrmZohoConnection 'fake-client' 'fake-secret' 'fake-code' $mailboxFailure } catch { $diagnostic = $_.Exception.Data['CrmSafeDiagnostic'] }
    if (!$diagnostic -or !$diagnostic.Contains('OAUTH_SCOPE_MISMATCH') -or $diagnostic.Contains('fake-secret')) { throw 'Mailbox error diagnostic failed' }
    Write-Host 'PASS: actual credential file save/restore, EU token request, read-only mailbox check, exact account ID, encrypted round-trip, wrong mailbox rejection, safe token/mailbox/HTTP diagnostics, unknown and non-JSON errors withheld. No network requests made.'
    exit 0
}

$crmRoot = Split-Path -Parent $PSScriptRoot
$crmSecretDirectory = Join-Path $crmRoot '.tmp'
$crmSecretPath = Join-Path $crmSecretDirectory ('crm-zoho-credentials-' + [guid]::NewGuid().ToString('N') + '.xml')

Write-Host 'NC Digital - Zoho EU connection'
Write-Host 'This checks the mailbox and saves Windows-encrypted credentials locally.'
Write-Host 'It does not send emails, upload credentials to Cloudflare or activate the CRM.'
Write-Host 'Paste values only into these hidden prompts, not into chat.'

$setupStage = 'testing local encrypted credential storage'
$protected = $null
try {
    Write-Host 'Checking local encryption and file storage with dummy credentials...'
    Test-CrmCredentialStorage -Directory $crmSecretDirectory
    Write-Host 'Local encrypted storage check passed.' -ForegroundColor Green
    if ($StorageTest) { exit 0 }
    $setupStage = 'reading Client ID'
    $clientId = Read-CrmSecret 'Paste Client ID, then Enter'
    $setupStage = 'reading Client Secret'
    $clientSecret = Read-CrmSecret 'Paste Client Secret, then Enter'
    Write-Host ''
    Write-Host 'Now open Generate Code in Zoho and enter these scopes:'
    Write-Host 'ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE'
    Write-Host 'Description: NC Digital enquiries CRM'
    Write-Host 'Choose the longest available expiry, create the code, then paste it below.'
    $setupStage = 'reading the newly generated code'
    $code = Read-CrmSecret 'Paste the newly generated code, then Enter'
    $setupStage = 'authorising and checking the mailbox'
    Write-Host 'Checking authorisation and mailbox access...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $connection = Get-CrmZohoConnection $clientId $clientSecret $code {
        param($request)
        Invoke-RestMethod @request -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction Stop -Verbose:$false -Debug:$false
    }
    $setupStage = 'saving encrypted credentials locally'
    Write-Host 'Mailbox verified. Saving Windows-encrypted credentials...'
    Save-CrmZohoCredential -Connection $connection -Path $crmSecretPath
    Write-Host ''
    Write-Host 'SUCCESS: Nathan mailbox verified. Credentials saved with Windows encryption.' -ForegroundColor Green
    Write-Host 'Tell Codex: Zoho setup succeeded. Do not share the file contents.'
    Write-Host 'The CRM is still inactive. Cloudflare setup and email testing remain.'
} catch {
    # Do not print exception objects: provider errors can contain credentials.
    Write-Host 'Setup did not complete. No emails were sent and no Cloudflare settings were changed.' -ForegroundColor Yellow
    Write-Host ('Failed step: ' + $setupStage) -ForegroundColor Yellow
    if ($_.Exception.Data['CrmSafeDiagnostic']) {
        Write-Host ('Diagnostic: ' + $_.Exception.Data['CrmSafeDiagnostic']) -ForegroundColor Yellow
    } else {
        Write-Host ('Diagnostic: Unexpected local error. Error type: {0}; script line: {1}. Raw error details were withheld to protect credentials.' -f $_.Exception.GetType().Name, $_.InvocationInfo.ScriptLineNumber) -ForegroundColor Yellow
    }
    Write-Host 'Tell Codex the Failed step and Diagnostic lines, without sharing credentials.'
    exit 1
} finally {
    if ($protected) { $protected.Dispose() }
    $clientId = $clientSecret = $code = $connection = $credential = $protected = $null
}
