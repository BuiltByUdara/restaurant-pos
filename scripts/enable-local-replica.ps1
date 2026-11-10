$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from PowerShell opened with Run as administrator.'
}
$mongoConfigPath = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.cfg'
$mongoConfigText = Get-Content -Raw -LiteralPath $mongoConfigPath
if ($mongoConfigText -notmatch '(?m)^replication:') {
  if ($mongoConfigText -notmatch '(?m)^#replication:') { throw 'Unexpected configuration; no changes made.' }
  Copy-Item -LiteralPath $mongoConfigPath -Destination ($mongoConfigPath + '.before-pos-replica-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.bak')
  $mongoConfigText = $mongoConfigText.Replace('#replication:', "replication:`r`n  replSetName: rs0")
  Set-Content -LiteralPath $mongoConfigPath -Value $mongoConfigText
} elseif ($mongoConfigText -notmatch 'replSetName:\s*rs0') {
  throw 'An existing different replica set is configured; no changes made.'
}
Restart-Service -Name MongoDB
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  node scripts/initialize-local-replica.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Replica initialization failed. Review the error above.' }
} finally { Pop-Location }
