# Lokaler Test-Server. Nur zum Entwickeln - auf GitHub Pages wird er nicht gebraucht.
#   .\_devserve.ps1            -> http://localhost:8231/
#   .\_devserve.ps1 -Port 9000
param([int]$Port = 8231)

$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "BotC-Regelwiki laeuft auf http://localhost:$Port/  (Strg+C beendet)"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".webp" = "image/webp"
  ".jpg"  = "image/jpeg"
  ".woff2"= "font/woff2"
  ".pdf"  = "application/pdf"
  ".webmanifest" = "application/manifest+json"
}

while ($listener.IsListening) {
  $c = $listener.GetContext(); $req = $c.Request; $res = $c.Response
  try {
    $p = [System.Uri]::UnescapeDataString($req.Url.LocalPath)
    if ($p -eq "/") { $p = "/index.html" }
    $f = Join-Path $root ($p.TrimStart("/") -replace '/', '\')
    if (Test-Path $f -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($f).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
      $res.ContentType = $ct
      $res.Headers.Add("Cache-Control", "no-store")
      $b = [IO.File]::ReadAllBytes($f)
      $res.ContentLength64 = $b.Length
      $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
