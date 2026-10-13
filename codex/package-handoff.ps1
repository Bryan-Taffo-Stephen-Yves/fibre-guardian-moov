param([Parameter(Mandatory=$true)][string]$Destination,[string]$AgentSpec,[string]$OriginalSpec)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$zipPath=[IO.Path]::GetFullPath($Destination)
if($zipPath.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive doit être hors du projet.'}
if(Test-Path -LiteralPath $zipPath){throw 'Archive existante : aucun écrasement.'}
$exclude='(^|/)(\.local|\.git|node_modules|\.cache|\.next|coverage)(/|$)|\.(sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|pem|key|pfx|p12|zip|log)$|(^|/)\.env(?:\.|$)'
$files=@(Get-ChildItem -LiteralPath $projectRoot -File -Recurse -Force | Where-Object { $_.FullName.Substring($projectRoot.Length+1).Replace('\','/') -notmatch $exclude })
$manifest=@{}
foreach($file in $files){
 if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Lien symbolique inattendu.'}
 $manifest['fibre-guardian/'+$file.FullName.Substring($projectRoot.Length+1).Replace('\','/')]=$file.FullName
}
if($AgentSpec){$manifest['fibre-guardian/documents/FIBRE_GUARDIAN_AGENT_IA.md']=[IO.Path]::GetFullPath($AgentSpec)}
if($OriginalSpec){$manifest['fibre-guardian/documents/FIBRE_GUARDIAN_SPEC-original.md']=[IO.Path]::GetFullPath($OriginalSpec)}
foreach($suite in @('approvals','operator','wifi-drag')){
 $proof=Join-Path (Split-Path $projectRoot -Parent) ('verification/'+$suite+'/results.json')
 if(Test-Path -LiteralPath $proof){$manifest['fibre-guardian/codex/preuves/'+$suite+'/results.json']=$proof}
}
foreach($source in $manifest.Values){if(!(Test-Path -LiteralPath $source -PathType Leaf)){throw 'Source manquante : '+$source}}
$stream=[IO.File]::Open($zipPath,[IO.FileMode]::CreateNew)
$archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try{foreach($entry in $manifest.GetEnumerator() | Sort-Object Key){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$entry.Value,$entry.Key,[IO.Compression.CompressionLevel]::Optimal)|Out-Null}}finally{$archive.Dispose();$stream.Dispose()}
$verify=[IO.Compression.ZipFile]::OpenRead($zipPath)
try{
 if($verify.Entries.Count -ne $manifest.Count){throw 'Nombre de fichiers incorrect.'}
 foreach($entry in $verify.Entries){
  if($entry.FullName -match $exclude){throw 'Fichier interdit dans archive.'}
  $inputStream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
  try{$actual=[BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-','')}finally{$inputStream.Dispose();$sha.Dispose()}
  if($actual -ne (Get-FileHash -LiteralPath $manifest[$entry.FullName] -Algorithm SHA256).Hash){throw 'Contenu différent : '+$entry.FullName}
 }
 [pscustomobject]@{Archive=$zipPath;Files=$verify.Entries.Count;Bytes=(Get-Item -LiteralPath $zipPath).Length;SHA256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash;Verified='Tous les fichiers relus et comparés aux sources ; exclusions contrôlées'}|ConvertTo-Json
}finally{$verify.Dispose()}
