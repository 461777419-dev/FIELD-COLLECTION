param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$application=$null
$presentation=$null
$security=$null
try {
  $application=New-Object -ComObject PowerPoint.Application
  $security=$application.AutomationSecurity
  $application.AutomationSecurity=3 # Disable all document macros.
  $presentation=$application.Presentations.Open($InputFile,-1,0,0)
  if($presentation.Slides.Count -gt 200){throw 'PPT exceeds 200 slides; split it before importing.'}
  $width=1600
  $height=[int][Math]::Round($width*$presentation.PageSetup.SlideHeight/$presentation.PageSetup.SlideWidth)
  if($height -gt 4000 -or $height -lt 100){throw 'Unsupported slide aspect ratio.'}
  for($index=1;$index -le $presentation.Slides.Count;$index++){
    $slide=$presentation.Slides.Item($index)
    try {$slide.Export((Join-Path $OutputDirectory ("slide-{0:D4}.png" -f $index)),'PNG',$width,$height)}
    finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide)}
  }
} finally {
  if($presentation){$presentation.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)}
  if($application){
    if($null -ne $security){$application.AutomationSecurity=$security}
    if($application.Presentations.Count -eq 0){$application.Quit()}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
  }
}
