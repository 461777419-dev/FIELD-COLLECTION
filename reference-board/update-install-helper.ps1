$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $env:ATLAS_UPDATE_PLAN -Raw -Encoding UTF8 | ConvertFrom-Json
$statusFile = Join-Path $plan.jobDir 'status.json'
$logFile = Join-Path $plan.jobDir 'install.log'
function Write-UpdateState($phase, $message) {
  $entry = @{ phase=$phase; message=$message; version=$plan.version; timestamp=[DateTime]::UtcNow.ToString('o') }
  $entry | ConvertTo-Json -Compress | Set-Content -LiteralPath ($statusFile+'.tmp') -Encoding UTF8
  Move-Item -LiteralPath ($statusFile+'.tmp') -Destination $statusFile -Force
  Add-Content -LiteralPath $logFile -Value ($entry.timestamp+' '+$phase+' '+$message) -Encoding UTF8
}
try {
  Write-UpdateState 'waiting' '更新助手已就绪，等待图集退出'
  $parent = Get-Process -Id ([int]$plan.desktopPid) -ErrorAction SilentlyContinue
  if ($parent -and -not $parent.WaitForExit(([int]$plan.exitTimeoutSeconds * 1000))) { throw '等待图集退出超时，请关闭所有图集窗口后重试' }
  $bytes = Get-Item -LiteralPath $plan.installer
  $stream = [System.IO.File]::OpenRead($plan.installer)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($bytes.Length -ne [long]$plan.size -or $hash -ne $plan.sha256) {
    throw '安装包在交接后发生变化，请重新下载'
  }
  Write-UpdateState 'installing' '图集已退出，正在运行安装程序'
  # /D must be the last NSIS argument. Restart explicitly after verifying the installed version.
  $installer = Start-Process -FilePath $plan.installer -ArgumentList @('/S','/UPDATE',('/D='+$plan.installDir)) -PassThru
  if (-not $installer.WaitForExit(300000)) { throw '安装程序超过 5 分钟未完成，请查看安装程序或手动安装' }
  $installer.WaitForExit()
  if ($installer.ExitCode -ne 0) { throw ('安装程序退出码：'+$installer.ExitCode) }
  $package = Get-Content -LiteralPath (Join-Path $plan.installDir 'runtime\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($package.version -ne $plan.version -or -not (Test-Path -LiteralPath $plan.desktopExe)) { throw '安装结束但目标版本未改变，请手动运行安装包' }
  Write-UpdateState 'restarting' '安装完成，正在重新打开图集'
  Start-Process -FilePath $plan.desktopExe -WorkingDirectory $plan.installDir | Out-Null
  Write-UpdateState 'complete' '更新完成，已发起图集重启'
} catch {
  Write-UpdateState 'error' $_.Exception.Message
  exit 1
}
