# Push local data.json + data-snapshot.json to the GitHub Gist that the
# deployed Vercel app reads from.
#
# Usage:
#   .\push-to-gist.ps1 -GistId "abc123" -Token "ghp_xxx"
#
# Or set them as env vars and just run .\push-to-gist.ps1:
#   $env:GIST_ID = "abc123"
#   $env:GITHUB_TOKEN = "ghp_xxx"

param(
  [string]$GistId = $env:GIST_ID,
  [string]$Token  = $env:GITHUB_TOKEN
)

if (-not $GistId) { Write-Error "Missing GistId. Pass -GistId or set `$env:GIST_ID."; exit 1 }
if (-not $Token)  { Write-Error "Missing Token. Pass -Token or set `$env:GITHUB_TOKEN."; exit 1 }

# Trim any whitespace/newlines that snuck in via copy-paste — .NET rejects
# CR/LF inside HTTP header values, so the Authorization header would fail.
$GistId = $GistId.Trim()
$Token  = $Token.Trim()

# Script lives in scripts/; data files live in ../data/
$root         = Split-Path $PSScriptRoot -Parent
$dataPath     = Join-Path $root "data\data.json"
$snapshotPath = Join-Path $root "data\data-snapshot.json"

if (-not (Test-Path $dataPath))     { Write-Error "data.json not found at $dataPath"; exit 1 }
if (-not (Test-Path $snapshotPath)) { Write-Error "data-snapshot.json not found at $snapshotPath"; exit 1 }

Write-Host "Reading local files..."
# Use .NET directly — Get-Content -Raw wraps the string in a PSObject in
# Windows PowerShell 5.1, which makes ConvertTo-Json serialize it as
# {"value": "..."} instead of a plain string, and GitHub rejects that.
$dataJson     = [System.IO.File]::ReadAllText($dataPath)
$snapshotJson = [System.IO.File]::ReadAllText($snapshotPath)
Write-Host ("  data.json:          {0:N0} bytes" -f $dataJson.Length)
Write-Host ("  data-snapshot.json: {0:N0} bytes" -f $snapshotJson.Length)

$payload = @{
  files = @{
    "data.json"          = @{ content = $dataJson }
    "data-snapshot.json" = @{ content = $snapshotJson }
  }
} | ConvertTo-Json -Depth 6 -Compress

Write-Host "Pushing to gist $GistId ..."
try {
  $resp = Invoke-RestMethod -Method Patch `
    -Uri "https://api.github.com/gists/$GistId" `
    -Headers @{
      Authorization = "token $Token"
      "User-Agent"  = "visa-platform-push"
      Accept        = "application/vnd.github+json"
    } `
    -ContentType "application/json; charset=utf-8" `
    -Body $payload

  Write-Host "Success." -ForegroundColor Green
  Write-Host ("  Gist URL:        {0}" -f $resp.html_url)
  Write-Host ("  Updated at:      {0}" -f $resp.updated_at)
  Write-Host ("  Files in gist:   {0}" -f ($resp.files.PSObject.Properties.Name -join ', '))
} catch {
  Write-Error ("Push failed: {0}" -f $_.Exception.Message)
  if ($_.ErrorDetails.Message) { Write-Error $_.ErrorDetails.Message }
  exit 1
}
