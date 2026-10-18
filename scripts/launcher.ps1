param(
  [Parameter(Position = 0)]
  [string]$Mode = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Stop-WithMessage([string]$Message, [int]$Code = 1) {
  Write-Host "[UnifiedMail] $Message" -ForegroundColor Red
  exit $Code
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Stop-WithMessage 'Node.js was not found. Install Node.js 24 and try again.'
}

if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
  Stop-WithMessage 'pnpm was not found. Run "corepack enable" and install pnpm 10.'
}

$nodeMajor = [int]((& node.exe --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) {
  Stop-WithMessage "Node.js 24 or newer is required. Current version: $(& node.exe --version)"
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  Write-Host '[UnifiedMail] Installing project dependencies...'
  & pnpm.cmd install
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Dependency installation failed.' $LASTEXITCODE }
}

if ($Mode -ieq '--check') {
  Write-Host '[UnifiedMail] Running type checks, lint, tests and production build...'
  & pnpm.cmd check
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Project checks failed.' $LASTEXITCODE }
  Write-Host '[UnifiedMail] All checks passed.' -ForegroundColor Green
  exit 0
}

if ($Mode -and $Mode -ine '--start') {
  Stop-WithMessage "Unknown option: $Mode. Supported options: --start, --check."
}

Write-Host '[UnifiedMail] Starting the desktop application...'
& pnpm.cmd dev
if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'The desktop application exited with an error.' $LASTEXITCODE }
exit 0
