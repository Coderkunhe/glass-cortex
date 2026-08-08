# GlassCortex PS 5.1 Compatibility Self-Check Script
# Phase 67 Batch 21 --- Run this after each PS script modification
# Usage: pwsh -NoProfile -File deploy/check-ps-syntax.ps1

$ErrorActionPreference = "Continue"
$scripts = @("deploy/deploy.ps1", "deploy/install-services.ps1", "deploy/build-package.ps1")
$allPass = $true

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Phase 67 Batch 21 - PS Script Self-Check" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

foreach ($f in $scripts) {
    Write-Host "`n--- $f ---" -ForegroundColor Yellow
    $path = (Resolve-Path $f).Path

    # 1. Parse validation
    $tokens = $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)

    if ($errors.Count -gt 0) {
        Write-Host "  FAIL Parse: $($errors.Count) error(s)" -ForegroundColor Red
        foreach ($e in $errors) { Write-Host "    $($e.Message)" -ForegroundColor Red }
        $allPass = $false
    } else {
        Write-Host "  PASS Parse: 0 errors" -ForegroundColor Green
    }

    # 2. -not check
    $notCount = ($tokens | Where-Object { $_.Text -eq "-not" }).Count
    if ($notCount -gt 0) {
        Write-Host "  FAIL -not: $notCount instance(s)" -ForegroundColor Red
        $allPass = $false
    } else {
        Write-Host "  PASS -not: 0 instances" -ForegroundColor Green
    }

    # 3. Brace balance
    $text = Get-Content $path -Raw
    $open = ($text.ToCharArray() | Where-Object { $_ -eq "{" }).Count
    $close = ($text.ToCharArray() | Where-Object { $_ -eq "}" }).Count
    if ($open -ne $close) {
        Write-Host "  FAIL Braces: $open open vs $close close" -ForegroundColor Red
        $allPass = $false
    } else {
        Write-Host "  PASS Braces: $open/$open balanced" -ForegroundColor Green
    }

    # 4. PS 7+ forbidden features
    $danger = @()
    foreach ($t in $tokens) {
        if ($t.Kind -eq "AndAnd" -or $t.Kind -eq "OrOr") {
            $danger += "L$($t.Extent.StartLineNumber): && / || (PS 7+ only)"
        }
        if ($t.Text -match '^\?\?' -or $t.Text -match '^\?\.') {
            $danger += "L$($t.Extent.StartLineNumber): null-conditional (PS 7+ only)"
        }
    }
    if ($danger.Count -gt 0) {
        Write-Host "  FAIL PS7+ features:" -ForegroundColor Red
        foreach ($d in $danger) { Write-Host "    $d" -ForegroundColor Red }
        $allPass = $false
    } else {
        Write-Host "  PASS PS7+ features: none" -ForegroundColor Green
    }

    # 5. Non-ASCII outside comments AND strings
    $lines = Get-Content $path
    $badChars = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line.TrimStart().StartsWith("#")) { continue }
        $inString = $false
        $commentIdx = $line.IndexOf("#")
        for ($j = 0; $j -lt $line.Length; $j++) {
            $ch = $line[$j]
            if ($ch -eq '"' -and ($j -eq 0 -or $line[$j-1] -ne '`')) {
                $inString = !$inString
            }
            if ($commentIdx -ge 0 -and $j -ge $commentIdx -and !$inString) { break }
            if ($inString) { continue }
            if ([int]$ch -gt 127) {
                $hex = '{0:X4}' -f [int]$ch
                $badChars += "L$($i+1):$($j+1) U+$hex $ch"
            }
        }
    }
    if ($badChars.Count -gt 0) {
        Write-Host "  FAIL Non-ASCII in code: $($badChars.Count) char(s)" -ForegroundColor Red
        foreach ($c in $badChars) { Write-Host "    $c" -ForegroundColor Red }
        $allPass = $false
    } else {
        Write-Host "  PASS Non-ASCII in code: 0" -ForegroundColor Green
    }
}

Write-Host "`n===========================================" -ForegroundColor Cyan
if ($allPass) {
    Write-Host "  RESULT: ALL CHECKS PASSED" -ForegroundColor Green
    exit 0
} else {
    Write-Host "  RESULT: SOME CHECKS FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "===========================================" -ForegroundColor Cyan
