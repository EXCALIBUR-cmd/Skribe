Push-Location $PSScriptRoot
try {
  $tests = @(
    "test:mess-cleanup",
    "test:mess-cleanup-analysis",
    "test:mess-cleanup-layout",
    "test:mess-cleanup-preview",
    "test:mess-cleanup-apply",
    "test:mess-cleanup-bulk-apply",
    "test:mess-cleanup-batch-collab",
    "test:mess-cleanup-ui",
    "test:mess-cleanup-extraction",
    "test:mess-cleanup-hierarchy",
    "test:mess-cleanup-executor",
    "test:mess-cleanup-validator",
    "test:canvas-history",
    "test:board-sync",
    "test:board-normalization",
    "test:mess-cleanup-v2",
    "test:mess-cleanup-omni-client",
    "test:shape-text-relationship",
    "test:mess-cleanup-connector-repair",
    "test:connector-collision-integrity",
    "test:voice-dictation",
    "test:voice-commands"
  )

  $allPassed = $true
  foreach ($test in $tests) {
    Write-Host "Running $test..."
    npm run $test
    if ($LASTEXITCODE -ne 0) {
      Write-Host "$test FAILED!" -ForegroundColor Red
      $allPassed = $false
    }
  }

  if ($allPassed) {
    Write-Host "ALL TESTS PASSED!" -ForegroundColor Green
  } else {
    Write-Host "SOME TESTS FAILED!" -ForegroundColor Red
    exit 1
  }
} finally {
  Pop-Location
}
