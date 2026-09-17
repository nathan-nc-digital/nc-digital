param([ValidateSet('Status','Sync','Enquiry','Reply','Ticket','Notification','RetryNotification')][string]$Mode = 'Status', [switch]$Drain)
$ErrorActionPreference = 'Stop'
$liveRoot = Split-Path -Parent $PSScriptRoot
$testPath = Join-Path $liveRoot '.tmp\crm-live-test.json'
$origin = 'https://nc-digital.co.uk'
try {
    $credential = Import-Clixml -LiteralPath (Join-Path $liveRoot '.tmp\crm-release-secrets.xml')
    $settings = $credential.GetNetworkCredential().Password | ConvertFrom-Json
    $headers = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('nathan:' + $settings.ADMIN_PASSWORD)); Origin = $origin }
    function Invoke-CrmAdmin {
        param([string]$Route, $Body)
        $request = @{ Uri = $origin + '/admin/crm/api/' + $Route; Headers = $headers; TimeoutSec = 30; MaximumRedirection = 0; ErrorAction = 'Stop' }
        if ($null -ne $Body) { $request.Method = 'POST'; $request.ContentType = 'application/json'; $request.Body = ConvertTo-Json -InputObject $Body -Compress }
        Invoke-RestMethod @request
    }
    if ($Mode -eq 'Status') {
        $status = Invoke-CrmAdmin 'setup'
        $public = Invoke-RestMethod -Uri ($origin + '/api/enquiries/config') -TimeoutSec 30
        $page = Invoke-WebRequest -UseBasicParsing -Uri ($origin + '/admin/crm/') -Headers $headers -TimeoutSec 30
        if ($page.StatusCode -ne 200 -or !$page.Content.Contains('CLIENT WORKSPACE')) { throw 'CRM page missing.' }
        foreach ($path in @('/admin/crm/', '/admin/crm/api/setup')) {
            foreach ($role in @('anonymous','ben')) {
                $accessHeaders = @{}
                if ($role -eq 'ben') { $accessHeaders.Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('ben:' + $settings.BEN_PASSWORD)) }
                $responseCode = 0
                try { $accessResponse = Invoke-WebRequest -UseBasicParsing -Uri ($origin + $path) -Headers $accessHeaders -TimeoutSec 30; $responseCode = [int]$accessResponse.StatusCode } catch { $responseCode = [int]$_.Exception.Response.StatusCode }
                if ($responseCode -ne 401) { throw 'CRM access check failed.' }
            }
        }
        $benHeaders = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('ben:' + $settings.BEN_PASSWORD)) }
        $benJobs = Invoke-WebRequest -UseBasicParsing -Uri ($origin + '/admin/jobs/') -Headers $benHeaders -TimeoutSec 30
        if ($benJobs.StatusCode -ne 200) { throw 'Ben jobs access failed.' }
        [ordered]@{ enabled = $status.enabled; public_capture_enabled = $public.enabled; database_ready = $status.database_ready; zoho_configured = $status.configured; notifications_configured = $status.notifications_configured; last_sync = $status.last_sync; sync_error = $status.sync_error; crm_page = 'OK'; anonymous_and_ben_crm_access = 'blocked'; ben_jobs_access = 'OK' } | ConvertTo-Json
        exit 0
    }
    if ($Mode -eq 'Notification') {
        $payload = @{ access_key = $settings.WEB3FORMS_ACCESS_KEY; name = 'NC Digital CRM test'; email = 'info@nc-digital.co.uk'; subject = 'NC Digital CRM notification connection test'; message = 'Authorised notification connection test. This is not a customer enquiry.' } | ConvertTo-Json -Compress
        try {
            $response = Invoke-RestMethod -Uri 'https://api.web3forms.com/submit' -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction Stop
            [ordered]@{ http = 200; success = [bool]$response.success; provider_code = if ($response.code) { [string]$response.code } else { $null }; provider_message_class = if ($response.success) { 'accepted' } else { 'rejected' } } | ConvertTo-Json
        } catch {
            $statusCode = 0; if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
            [ordered]@{ http = $statusCode; success = $false; provider_code = $null; provider_message_class = 'transport_or_http_failure' } | ConvertTo-Json
        }
        exit 0
    }
    if ($Mode -eq 'Sync') {
        $totalImported = 0
        $pages = 0
        do {
            $result = Invoke-CrmAdmin 'sync' @{}
            $totalImported += $result.imported
            $pages++
        } while ($Drain -and $result.more -and !$result.busy -and $pages -lt 10)
        @{ imported = $totalImported; pages = $pages; busy = [bool]$result.busy; more = [bool]$result.more } | ConvertTo-Json
        exit 0
    }
    if ($Mode -eq 'Enquiry') {
        if (!(Test-Path -LiteralPath $testPath)) {
            @{ submission_key = [guid]::NewGuid().ToString(); reply_request_key = [guid]::NewGuid().ToString(); subject = 'NC Digital CRM connection test ' + (Get-Date -Format 'yyyyMMdd-HHmmss'); email = 'info@nc-digital.co.uk' } | ConvertTo-Json | Set-Content -LiteralPath $testPath -Encoding UTF8
        }
        $test = Get-Content -LiteralPath $testPath -Raw | ConvertFrom-Json
        $body = @{ name = 'Nathan - CRM test'; email = $test.email; subject = $test.subject; message = 'Authorised CRM connection test. Please verify this enquiry is captured and a reply can be sent. This is not a customer enquiry.'; from_page = '/contact/'; submission_key = $test.submission_key }
        $result = Invoke-RestMethod -Uri ($origin + '/api/enquiries') -Method Post -Headers @{ Origin = $origin } -ContentType 'application/json' -Body (ConvertTo-Json -InputObject $body -Compress) -TimeoutSec 30
        if (!$result.success) { throw 'Test enquiry was not confirmed.' }
        $list = Invoke-CrmAdmin ('list?q=' + [Uri]::EscapeDataString($test.subject))
        $matching = @($list.tickets | Where-Object { $_.subject -eq $test.subject -and $_.email -eq $test.email })
        if ($matching.Count -ne 1) { throw 'Expected exactly one test ticket.' }
        $test | Add-Member -NotePropertyName ticket_id -NotePropertyValue $matching[0].id -Force
        $test | Add-Member -NotePropertyName reference -NotePropertyValue $matching[0].reference -Force
        $test | ConvertTo-Json | Set-Content -LiteralPath $testPath -Encoding UTF8
        @{ enquiry = 'captured'; reference = $test.reference; recipient = $test.email; matching_tickets = $matching.Count } | ConvertTo-Json
        exit 0
    }
    $test = Get-Content -LiteralPath $testPath -Raw | ConvertFrom-Json
    if (!$test.ticket_id -or $test.email -ne 'info@nc-digital.co.uk') { throw 'Test ticket is missing or unexpected.' }
    $ticket = Invoke-CrmAdmin ('ticket?id=' + [Uri]::EscapeDataString($test.ticket_id))
    if ($ticket.ticket.email -ne $test.email -or $ticket.ticket.subject -ne $test.subject) { throw 'Test ticket identity check failed.' }
    if ($Mode -eq 'RetryNotification') {
        $notification = @($ticket.messages | Where-Object { $_.kind -eq 'notification' -and $_.delivery -eq 'failed' }) | Select-Object -First 1
        if (!$notification) { throw 'No failed test notification is available to retry.' }
        $null = Invoke-CrmAdmin 'retry' @{ message_id = $notification.id }
        @{ notification = 'requeued'; reference = $test.reference } | ConvertTo-Json
        exit 0
    }
    if ($Mode -eq 'Reply') {
        $ticket = Invoke-CrmAdmin 'message' @{ id = $test.ticket_id; kind = 'outbound'; request_key = $test.reply_request_key; body = 'Hi Nathan, this is the authorised NC Digital CRM test reply. Please reply to this email with "CRM reply received" so we can verify the response appears in the same CRM conversation. Thanks, Nathan' }
    }
    [ordered]@{ reference = $test.reference; subject = $test.subject; status = $ticket.ticket.status; messages = @($ticket.messages | Select-Object kind,delivery,provider_id,created_at,error) } | ConvertTo-Json -Depth 5
} catch {
    $httpCode = 0
    if ($_.Exception.Response) { $httpCode = [int]$_.Exception.Response.StatusCode }
    Write-Host ('Live CRM check failed. Mode: {0}; error type: {1}; line: {2}; HTTP: {3}. Details withheld to protect credentials.' -f $Mode, $_.Exception.GetType().Name, $_.InvocationInfo.ScriptLineNumber, $httpCode)
    exit 1
} finally {
    if ($credential) { $credential.Password.Dispose() }
    $settings = $headers = $benHeaders = $accessHeaders = $null
}
