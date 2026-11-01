# HOLODESK offline speech recognizer (Windows System.Speech, no key or internet).
# Long-lived: reads one command per line on stdin.
#   listen  -> recognise one utterance, print {"text":"..."} or {"error":"..."}
#   exit    -> quit
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(7)
$engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.9)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(4)
[Console]::Out.WriteLine('{"ready":true}')

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'exit') { break }
  if ($line -ne 'listen') { continue }
  try {
    # Re-bind each time so a headset plugged in after launch is picked up.
    $engine.SetInputToDefaultAudioDevice()
    $result = $engine.Recognize([TimeSpan]::FromSeconds(25))
    $text = if ($result) { $result.Text } else { '' }
    [Console]::Out.WriteLine((@{ text = $text } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
$engine.Dispose()
