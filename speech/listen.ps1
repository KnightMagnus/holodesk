# EHREN offline speech recognition (Windows built-in, no internet / key needed)
# Listens once on the default microphone and prints the recognized text.
Add-Type -AssemblyName System.Speech
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$engine.SetInputToDefaultAudioDevice()
$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(7)
$engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.0)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(3)
$result = $engine.Recognize([TimeSpan]::FromSeconds(25))
if ($result -ne $null) { [Console]::Out.Write($result.Text) }
$engine.Dispose()
