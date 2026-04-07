$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspaceRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envFile = Join-Path $workspaceRoot ".env"

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  $line = Get-Content $Path | Where-Object {
    $_ -match "^$Name="
  } | Select-Object -First 1

  if (-not $line) {
    return $null
  }

  return ($line -split "=", 2)[1].Trim()
}

function Resolve-ForkUrl {
  $candidates = @(
    $env:MOONWELL_FORK_RPC_URL,
    $env:BASE_UPSTREAM_RPC_URL,
    $env:BASE_FORK_RPC_URL,
    (Get-DotEnvValue -Path $envFile -Name "BASE_UPSTREAM_RPC_URL"),
    (Get-DotEnvValue -Path $envFile -Name "BASE_FORK_RPC_URL"),
    (Get-DotEnvValue -Path $envFile -Name "BASE_RPC_URL")
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    if ($candidate -notmatch "127\.0\.0\.1|localhost") {
      return $candidate
    }
  }

  throw "Set MOONWELL_FORK_RPC_URL or BASE_UPSTREAM_RPC_URL to a non-local Base archive RPC before running npm run anvil:moonwell."
}

function Wait-ForAnvil {
  param([int]$Attempts = 30)

  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      cast block latest --rpc-url http://127.0.0.1:8545 | Out-Null
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  throw "Anvil did not become ready on http://127.0.0.1:8545"
}

function Warm-Fork {
  $addresses = @(
    "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
    "0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0",
    "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    "0x628ff693426583D9a7FB391E54366292F509D457",
    "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5",
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x4200000000000000000000000000000000000006",
    "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"
  )

  foreach ($address in $addresses) {
    cast code $address --rpc-url http://127.0.0.1:8545 2>$null | Out-Null
    cast balance $address --rpc-url http://127.0.0.1:8545 2>$null | Out-Null
  }
}

$forkUrl = Resolve-ForkUrl
Write-Host "Starting Moonwell Anvil fork at block 18500000..."

$anvil = Start-Process anvil -ArgumentList @(
  "--fork-url", $forkUrl,
  "--fork-block-number", "18500000",
  "--block-base-fee-per-gas", "0",
  "--silent",
  "--port", "8545",
  "--host", "127.0.0.1"
) -PassThru -NoNewWindow

try {
  Wait-ForAnvil
  Warm-Fork
  Write-Host "Moonwell fork ready on http://127.0.0.1:8545"
  Write-Host "Run npm run test:moonwell:quick, npm run test:moonwell:handler, or npm run test:moonwell:liquidation in another terminal."
  Wait-Process -Id $anvil.Id
} finally {
  if ($anvil -and -not $anvil.HasExited) {
    Stop-Process -Id $anvil.Id -Force
  }
}
