$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot=Split-Path $PSScriptRoot -Parent
$zipPath=Join-Path (Split-Path (Split-Path $projectRoot -Parent) -Parent) 'Fibre-Guardian-pilote-verifie-2026-10-09.zip'
if(Test-Path -LiteralPath $zipPath){throw 'Archive existante : aucun ecrasement.'}
$zipStream=[IO.File]::Open($zipPath,[IO.FileMode]::CreateNew)
$zipArchive=[IO.Compression.ZipArchive]::new($zipStream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  Get-ChildItem -LiteralPath $projectRoot -File -Recurse -Force | ForEach-Object {
    $relative=$_.FullName.Substring($projectRoot.Length+1).Replace('\','/')
    if($relative -notmatch '(^|/)(\.local|\.git|node_modules)(/|$)|\.(sqlite(-wal|-shm)?|pem|key|pfx)$|(^|/)\.env(\.|$)'){
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive,$_.FullName,'fibre-guardian/'+$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
  foreach($proof in @('pilot/unit-results.log','pilot/results.json','pilot/edge-results.json','buttons/suite-results.json','pilot/overview-1440.png','pilot/overview-390.png','pilot/plan-1440.png')){
    $proofPath=Join-Path (Split-Path $projectRoot -Parent) ('verification/'+$proof)
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive,$proofPath,'fibre-guardian/codex/preuves/'+$proof,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {$zipArchive.Dispose();$zipStream.Dispose()}
$verification=[IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $forbidden=@($verification.Entries | Where-Object FullName -Match '(^|/)(\.local|node_modules)(/|$)|\.(sqlite(-wal|-shm)?|pem|key|pfx)$')
  if($forbidden.Count){throw 'Fichier prive present dans archive'}
  [pscustomobject]@{Archive=$zipPath;Entries=$verification.Entries.Count;Bytes=(Get-Item -LiteralPath $zipPath).Length;PrivateFiles=$forbidden.Count;SHA256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash} | ConvertTo-Json
} finally {$verification.Dispose()}
