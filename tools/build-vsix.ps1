$ErrorActionPreference = 'Stop'

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string]$EnvironmentVariable
    )

    $environmentValue = if ($EnvironmentVariable) {
        [Environment]::GetEnvironmentVariable($EnvironmentVariable)
    }
    if ($environmentValue -and (Test-Path -LiteralPath $environmentValue)) {
        return (Resolve-Path -LiteralPath $environmentValue).Path
    }

    $resolved = Get-Command $Command -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Source
    }

    throw "$Command was not found. Add it to PATH or set $EnvironmentVariable."
}

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$NodeExe = Resolve-Executable -Command 'node' -EnvironmentVariable 'NODE_EXE'
$PythonExe = Resolve-Executable -Command 'python' -EnvironmentVariable 'PYTHON_EXE'
$VsceCommand = Get-Command 'vsce.cmd' -ErrorAction SilentlyContinue
$NpxCommand = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue

Push-Location $ProjectRoot
try {
    & $NodeExe --test 'tests/openfoam.test.js'
    if ($LASTEXITCODE -ne 0) {
        throw 'Extension tests failed.'
    }

    $Converter = Join-Path $PSScriptRoot 'convert-icon.py'
    $IcoPath = Join-Path $ProjectRoot 'OpenFOAM.ico'
    $PngPath = Join-Path $ProjectRoot 'icon.png'

    & $PythonExe $Converter $IcoPath $PngPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Icon conversion failed.'
    }

    $PackageName = (& $NodeExe -p "require('./package.json').name").Trim()
    $Version = (& $NodeExe -p "require('./package.json').version").Trim()
    $Output = Join-Path $ProjectRoot "$PackageName-$Version.vsix"
    $VsceArguments = @(
        'package',
        '--no-dependencies',
        '--allow-missing-repository',
        '--out',
        $Output
    )

    if ($VsceCommand) {
        & $VsceCommand.Source @VsceArguments
    }
    elseif ($NpxCommand) {
        & $NpxCommand.Source --yes '@vscode/vsce' @VsceArguments
    }
    else {
        throw 'Neither vsce.cmd nor npx.cmd was found.'
    }

    if ($LASTEXITCODE -ne 0) {
        throw 'VSIX packaging failed.'
    }

    Write-Output "VSIX created: $Output"
}
finally {
    Pop-Location
}