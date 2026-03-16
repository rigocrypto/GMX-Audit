$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force outputs\logs, outputs\repro | Out-Null

$logPath = "outputs/logs/full-run.log"
"# GMX Bug Hunt Run - $(Get-Date -Format o)" | Set-Content -Path $logPath -Encoding utf8
"## Tool inventory" | Add-Content -Path $logPath

function Get-RpcUrl([string]$primaryName, [string]$secondaryName) {
  if (-not [string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$primaryName" -ErrorAction SilentlyContinue).Value)) {
    return (Get-Item -Path "Env:$primaryName").Value
  }
  if (-not [string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$secondaryName" -ErrorAction SilentlyContinue).Value)) {
    return (Get-Item -Path "Env:$secondaryName").Value
  }
  return $null
}

function Invoke-Rpc([string]$rpcUrl, [string]$method, [object[]]$params) {
  $body = @{
    jsonrpc = "2.0"
    method = $method
    params = $params
    id = 1
  } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri $rpcUrl -ContentType "application/json" -Body $body
}

function Resolve-ForkBlockHex([string]$chainName) {
  $raw = $null
  if ($chainName -eq "avalanche") {
    $raw = $env:AVALANCHE_FORK_BLOCK_NUMBER
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = $env:AVALANCHE_FORK_BLOCK }
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = $env:FORK_BLOCK_NUMBER }
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = $env:FORK_BLOCK }
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = "80400000" }
  } else {
    $raw = $env:FORK_BLOCK_NUMBER
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = $env:FORK_BLOCK }
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = "420000000" }
  }

  if ($raw.Trim().ToLower() -eq "latest") {
    return "latest"
  }

  $blockNumber = [int64]$raw
  return "0x" + $blockNumber.ToString("X")
}

$nodeVersion = (node --version).Trim()
$npmVersion = (npm --version).Trim()
$hardhatVersion = (npx hardhat --version).Trim()

$forgeVersion = "not-installed"
try {
  $forgeVersion = ((forge --version) -join "`n").Trim()
} catch {
  $forgeVersion = "not-installed"
}

$slitherVersion = "not-installed"
try {
  $slitherVersion = ((slither --version) -join "`n").Trim()
} catch {
  $slitherVersion = "not-installed"
}

$nodeVersion | Tee-Object -FilePath $logPath -Append | Out-Null
$npmVersion | Tee-Object -FilePath $logPath -Append | Out-Null
$hardhatVersion | Tee-Object -FilePath $logPath -Append | Out-Null
$forgeVersion | Tee-Object -FilePath $logPath -Append | Out-Null
$slitherVersion | Tee-Object -FilePath $logPath -Append | Out-Null

"## RPC health" | Add-Content -Path $logPath

$arbRpc = Get-RpcUrl "ARBITRUM_RPC_URL" "ARBITRUM_RPC"
$avaRpc = Get-RpcUrl "AVALANCHE_RPC_URL" "AVALANCHE_RPC"

$matrixRows = @()

foreach ($entry in @(
  @{ chain = "arbitrum"; rpc = $arbRpc; forkHex = Resolve-ForkBlockHex "arbitrum" },
  @{ chain = "avalanche"; rpc = $avaRpc; forkHex = Resolve-ForkBlockHex "avalanche" }
)) {
  $rpcHost = "unset"
  $liveBlock = "error"
  $archiveStatus = "missing_rpc"
  $archiveDetail = "rpc not configured"

  if (-not [string]::IsNullOrWhiteSpace($entry.rpc)) {
    $rpcHost = ([uri]$entry.rpc).Host
    try {
      $live = Invoke-Rpc -rpcUrl $entry.rpc -method "eth_blockNumber" -params @()
      if ($live.error) {
        $liveBlock = "error"
      } else {
        $liveBlock = $live.result
      }
    } catch {
      $liveBlock = "error"
    }

    if ($entry.forkHex -eq "latest") {
      $archiveStatus = "not_applicable"
      $archiveDetail = "fork block set to latest"
    } else {
      try {
        $probe = Invoke-Rpc -rpcUrl $entry.rpc -method "eth_getBalance" -params @("0x0000000000000000000000000000000000000001", $entry.forkHex)
        if ($probe.error) {
          $archiveStatus = "archive_fail"
          $archiveDetail = $probe.error.message
        } else {
          $archiveStatus = "archive_ok"
          $archiveDetail = "historical state available"
        }
      } catch {
        $archiveStatus = "archive_fail"
        $archiveDetail = $_.Exception.Message
      }
    }
  }

  "${($entry.chain)}_live_block=$liveBlock" | Tee-Object -FilePath $logPath -Append | Out-Null
  "${($entry.chain)}_archive_probe=$archiveStatus detail=$archiveDetail" | Tee-Object -FilePath $logPath -Append | Out-Null

  $matrixRows += [ordered]@{
    chain = $entry.chain
    rpcHost = $rpcHost
    forkBlockHex = $entry.forkHex
    liveBlock = $liveBlock
    archiveProbe = $archiveStatus
    archiveDetail = $archiveDetail
  }
}

$matrixMd = @("| chain | rpc | forkBlock | liveBlock | archiveProbe |", "|---|---|---:|---:|---|")
foreach ($row in $matrixRows) {
  $matrixMd += "| $($row.chain) | $($row.rpcHost) | $($row.forkBlockHex) | $($row.liveBlock) | $($row.archiveProbe) |"
}
$matrixMd | Set-Content -Path "outputs/rpc-matrix.md" -Encoding utf8

$headSha = (git rev-parse --short HEAD).Trim()
$forkBlock = $env:FORK_BLOCK
if ([string]::IsNullOrWhiteSpace($forkBlock)) {
  $forkBlock = "unset"
}

$metadata = [ordered]@{
  timestamp = (Get-Date -Format o)
  gitSha = $headSha
  os = "windows"
  node = $nodeVersion
  npm = $npmVersion
  hardhat = $hardhatVersion
  forge = $forgeVersion
  slither = $slitherVersion
  rpcMatrix = $matrixRows
  env = [ordered]@{
    GMX_CHAIN = $env:GMX_CHAIN
    FORK_BLOCK = $forkBlock
    ARBITRUM_RPC_HOST = if ($arbRpc) { ([uri]$arbRpc).Host } else { "unset" }
    AVALANCHE_RPC_HOST = if ($avaRpc) { ([uri]$avaRpc).Host } else { "unset" }
  }
}

$metadata | ConvertTo-Json -Depth 6 | Set-Content -Path "outputs/run-metadata.json" -Encoding utf8
