# ==============================================================================
# TianQue DNS - Open Source China ISP IP Database Auto-Updater (PowerShell)
# ==============================================================================

$OutputFile = "geoip_rules.txt"
$BaseUrl = "https://cdn.jsdelivr.net/gh/gaoyifan/china-operator-ip@ip-lists"

Write-Host "Downloading latest China ISP IP ranges..." -ForegroundColor Cyan

$Rules = @()
$Rules += "# TianQue DNS - Auto-generated ISP routing rules"
$Rules += "# Generated at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$Rules += ""

# Download Telecom (Chinanet)
try {
    $Telecom = Invoke-WebRequest -Uri "$BaseUrl/chinanet.txt" -UseBasicParsing
    $Telecom.Content -split "`n" | ForEach-Object {
        $line = $_.Trim()
        if ($line) { $Rules += "$line ct" }
    }
    Write-Host "✓ Telecom (Chinanet) rules processed" -ForegroundColor Green
} catch {
    Write-Warning "Failed to download Telecom data: $_"
}

# Download Unicom (Unicom)
try {
    $Unicom = Invoke-WebRequest -Uri "$BaseUrl/unicom.txt" -UseBasicParsing
    $Unicom.Content -split "`n" | ForEach-Object {
        $line = $_.Trim()
        if ($line) { $Rules += "$line cu" }
    }
    Write-Host "✓ Unicom (Unicom) rules processed" -ForegroundColor Green
} catch {
    Write-Warning "Failed to download Unicom data: $_"
}

# Download Mobile (CMCC)
try {
    $Mobile = Invoke-WebRequest -Uri "$BaseUrl/cmcc.txt" -UseBasicParsing
    $Mobile.Content -split "`n" | ForEach-Object {
        $line = $_.Trim()
        if ($line) { $Rules += "$line cm" }
    }
    Write-Host "✓ Mobile (CMCC) rules processed" -ForegroundColor Green
} catch {
    Write-Warning "Failed to download Mobile data: $_"
}

# Output to file
$Rules | Out-File -FilePath $OutputFile -Encoding utf8
Write-Host "✓ Successfully generated $OutputFile!" -ForegroundColor Cyan
