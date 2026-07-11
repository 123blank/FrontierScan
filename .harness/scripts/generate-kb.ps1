param(
  [ValidateSet("all", "backend", "frontend")]
  [string]$Area = "all",

  [ValidateSet("all", "baseline", "semantic")]
  [string]$Mode = "all",

  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,

  [switch]$WithEmbeddings,

  [switch]$DryRun,

  [switch]$Json
)

$ErrorActionPreference = "Stop"

$nodeScript = Join-Path $PSScriptRoot "lib\generate-kb.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Knowledge generator not found: ${nodeScript}"
}

$arguments = @(
  $nodeScript,
  "--root", $Root,
  "--area", $Area,
  "--mode", $Mode
)

if ($WithEmbeddings) {
  $arguments += "--with-embeddings"
}

if ($DryRun) {
  $arguments += "--dry-run"
}

if ($Json) {
  $arguments += "--json"
}

& node @arguments
