# Fetch the shared dev .env from Azure Key Vault (ww-kv-dev-ae, resource group WW-AE).
# Usage: .\scripts\fetch-env.ps1 [-Force]
# Requires: az login (Entra ID account with vault access — see readme "Secrets & Access")
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$dest = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if ((Test-Path $dest) -and -not $Force) { throw ".env already exists - rerun with -Force to overwrite" }
$lines = az keyvault secret show --vault-name ww-kv-dev-ae --name ww-website-dotenv --query value -o tsv
if (-not $lines) { throw "empty secret or no access - check 'az login' and vault permissions" }
[IO.File]::WriteAllText($dest, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ".env written ($((Get-Item $dest).Length) bytes) from ww-kv-dev-ae/ww-website-dotenv"
