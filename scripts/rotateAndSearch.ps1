$blocks = @(420000000, 419900000, 419800000, 419700000, 419600000)
$logDir = "exploit-proofs/rotation-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "=== Compile once before rotation ==="
npx hardhat compile

foreach ($block in $blocks) {
    Write-Host "=== Testing block $block ==="
  $env:FORK_BLOCK = "$block"
  $env:GMX_CHAIN = "arbitrum"
  Remove-Item Env:AVALANCHE_FORK_BLOCK -ErrorAction SilentlyContinue
  Remove-Item Env:GMX_ALLOW_AVA_ORACLE_EXECUTE -ErrorAction SilentlyContinue

  Write-Host "=== Arbitrum block $block ==="
  npm run test:gmx-rot-ext 2>&1 | Tee-Object -FilePath "$logDir/arb-block-$block.log"

  Write-Host "=== Avalanche block $block ==="
  $env:GMX_CHAIN = "avalanche"
  $env:AVALANCHE_FORK_BLOCK = "$block"
  $env:GMX_ALLOW_AVA_ORACLE_EXECUTE = "1"
  npm run test:gmx-exploit-search:ava 2>&1 | Tee-Object -FilePath "$logDir/ava-block-$block.log"

    $proofs = Get-ChildItem "exploit-proofs/*.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne ".gitkeep" }

    if ($proofs) {
        Write-Host "=== PROOF GENERATED at block $block ==="
        $proofs | ForEach-Object { Write-Host $_.FullName }
        break
    }
}
