param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$bundlePath = Join-Path $releaseRoot '.tmp\crm-release-secrets.xml'
$secureBundle = $null
try {
    if ($PrepareOnly) {
        if (Test-Path -LiteralPath $bundlePath) { throw 'Release bundle already exists.' }
        $zohoFiles = @(Get-ChildItem -LiteralPath (Join-Path $releaseRoot '.tmp') -Filter 'crm-zoho-credentials-*.xml')
        if ($zohoFiles.Count -ne 1) { throw 'Expected exactly one saved Zoho connection.' }
        $zohoCredential = Import-Clixml -LiteralPath $zohoFiles[0].FullName
        $zoho = $zohoCredential.GetNetworkCredential().Password | ConvertFrom-Json
        $bundle = @{}
        foreach ($key in @('ZOHO_REGION','ZOHO_ACCOUNT_ID','ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET','ZOHO_REFRESH_TOKEN')) {
            if (!$zoho.$key -or $zoho.$key -isnot [string]) { throw 'Saved connection is incomplete.' }
            $bundle[$key] = [string]::new($zoho.$key.ToCharArray())
        }
        if ($bundle.ZOHO_REGION -ne 'eu' -or $bundle.ZOHO_ACCOUNT_ID -notmatch '^\d+$') { throw 'Unexpected Zoho region or account.' }
        $workerSource = Get-Content -LiteralPath (Join-Path $releaseRoot 'src\worker.js') -Raw
        foreach ($entry in @(@('ADMIN_PASS','ADMIN_PASSWORD'), @('BEN_PASS','BEN_PASSWORD'))) {
            $match = [regex]::Match($workerSource, ('const ' + $entry[0] + " = '([^']+)';"))
            if (!$match.Success) { throw 'Existing admin credential was not found.' }
            $bundle[$entry[1]] = $match.Groups[1].Value
        }
        $formSource = Get-Content -LiteralPath (Join-Path $releaseRoot 'src\components\EnquiryForm.astro') -Raw
        $formMatch = [regex]::Match($formSource, 'name="access_key" value="([a-f0-9-]+)"')
        if (!$formMatch.Success) { throw 'Existing notification destination key was not found.' }
        $bundle.WEB3FORMS_ACCESS_KEY = $formMatch.Groups[1].Value
        $bundleJson = ConvertTo-Json -InputObject $bundle -Compress
        $secureBundle = [System.Security.SecureString]::new()
        foreach ($letter in $bundleJson.ToCharArray()) { $secureBundle.AppendChar($letter) }
        $secureBundle.MakeReadOnly()
        [PSCredential]::new('crm-release', $secureBundle) | Export-Clixml -LiteralPath $bundlePath -NoClobber
        Write-Host 'Prepared Windows-encrypted release bundle: Zoho, existing admin passwords and notification key. No cloud changes.'
        exit 0
    }
    $releaseCredential = Import-Clixml -LiteralPath $bundlePath
    $uploadJson = $releaseCredential.GetNetworkCredential().Password
    $upload = $uploadJson | ConvertFrom-Json
    $expected = @('ZOHO_REGION','ZOHO_ACCOUNT_ID','ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET','ZOHO_REFRESH_TOKEN','ADMIN_PASSWORD','BEN_PASSWORD','WEB3FORMS_ACCESS_KEY')
    if (@($upload.PSObject.Properties).Count -ne $expected.Count) { throw 'Unexpected release bundle.' }
    foreach ($key in $expected) { if (!$upload.$key -or $upload.$key -isnot [string]) { throw 'Incomplete release bundle.' } }
    $cli = Join-Path (Split-Path -Parent (Get-Command wrangler.cmd).Source) 'node_modules\wrangler\bin\wrangler.js'
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command node.exe).Source
    $start.Arguments = '"' + $cli + '" secret bulk --name nc-digital'
    $start.WorkingDirectory = $releaseRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['WRANGLER_SEND_METRICS'] = 'false'
    $start.EnvironmentVariables['WRANGLER_LOG'] = 'error'
    $start.EnvironmentVariables['WRANGLER_LOG_SANITIZE'] = 'true'
    $uploadProcess = [System.Diagnostics.Process]::Start($start)
    $stdoutTask = $uploadProcess.StandardOutput.ReadToEndAsync()
    $stderrTask = $uploadProcess.StandardError.ReadToEndAsync()
    $uploadProcess.StandardInput.Write($uploadJson)
    $uploadProcess.StandardInput.Close()
    $uploadProcess.WaitForExit()
    $null = $stdoutTask.GetAwaiter().GetResult()
    $null = $stderrTask.GetAwaiter().GetResult()
    if ($uploadProcess.ExitCode -ne 0) { throw 'Cloudflare secret upload failed; output withheld.' }
    Write-Host 'Uploaded eight CRM/admin settings to the existing nc-digital Worker as Cloudflare secrets. Credential values were not printed or written as plaintext files.'
} catch {
    Write-Host ('CRM configuration failed. Error type: {0}; line: {1}. Details withheld to protect credentials.' -f $_.Exception.GetType().Name, $_.InvocationInfo.ScriptLineNumber)
    exit 1
} finally {
    if ($secureBundle) { $secureBundle.Dispose() }
    if ($zohoCredential) { $zohoCredential.Password.Dispose() }
    if ($releaseCredential) { $releaseCredential.Password.Dispose() }
    $bundle = $bundleJson = $workerSource = $zoho = $upload = $uploadJson = $null
}
