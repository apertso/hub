# SKLEIKA_POWERSHELL_WRAPPER
$ErrorActionPreference = "Stop"

function Get-GitBash {
    $candidates = @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
        "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    $command = Get-Command bash.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    throw "Git Bash was not found. Install Git for Windows and try again."
}

function Convert-ToGitBashPath {
    param([string] $Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)

    if ($fullPath -match '^([A-Za-z]):\\(.*)$') {
        $drive = $Matches[1].ToLowerInvariant()
        $rest = $Matches[2] -replace '\\', '/'
        return "/$drive/$rest"
    }

    return ($fullPath -replace '\\', '/')
}

function Convert-Argument {
    param([string] $Value)

    if ($Value -and (Test-Path -LiteralPath $Value)) {
        $resolvedPath = Resolve-Path -LiteralPath $Value -ErrorAction Stop | Select-Object -First 1
        return Convert-ToGitBashPath $resolvedPath.ProviderPath
    }

    return $Value
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bashScript = Join-Path $scriptDir "skleika"

if (!(Test-Path -LiteralPath $bashScript)) {
    Write-Error "Installed Bash script was not found next to wrapper: $bashScript"
    exit 1
}

$bash = Get-GitBash
$bashScriptForBash = Convert-ToGitBashPath $bashScript

$convertedArgs = @()
if ($args.Count -gt 0 -and $args[0] -eq "uninstall") {
    $convertedArgs = $args
} else {
    foreach ($arg in $args) {
        $convertedArgs += Convert-Argument $arg
    }
}

& $bash "$bashScriptForBash" @convertedArgs
exit $LASTEXITCODE
