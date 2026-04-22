param(
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

function Write-NdjsonLine {
  param([Parameter(Mandatory=$true)]$Obj)
  $line = ($Obj | ConvertTo-Json -Compress -Depth 50)
  if ($script:Writer) {
    $script:Writer.WriteLine($line)
  } else {
    Write-Output $line
  }
}

if ($OutFile -ne "") {
  $dir = Split-Path -Parent $OutFile
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $script:Writer = New-Object System.IO.StreamWriter($OutFile, $false, [System.Text.Encoding]::UTF8)
}

try {
  $attemptId = "attempt-" + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $callId = "call-" + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

  # Use string timestamps for Windows PowerShell compatibility (large ints can break ConvertFrom-Json).
  Write-NdjsonLine @{ v = 0; type = "heartbeat"; ts = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()); status = "ok" }
  Write-NdjsonLine @{ v = 0; type = "agent_event"; event = @{ kind = "trace"; message = "protocol-generate: demo stream" } }
  Write-NdjsonLine @{ v = 0; type = "agent_event"; event = @{ kind = "trigger"; triggerId = "trigger-demo-1"; trigger = @{ id = "trigger-demo-1"; source = "event"; intent = "demo intent"; untrustedContext = @{ foo = "bar" } } } }
  Write-NdjsonLine @{
    v = 0
    type = "tool_call"
    callId = $callId
    name = "echo_tool"
    arguments = @{ prompt = "hello" }
    reason = "demo: validate safety fields"
    expectedSideEffects = @("reads prompt", "returns summary")
    dataProvenance = "user_intent"
  }

  $text = "Demo reply for $attemptId.`n"
  $chunks = @()
  for ($i = 0; $i -lt $text.Length; $i += 16) { $chunks += $text.Substring($i, [Math]::Min(16, $text.Length - $i)) }
  foreach ($c in $chunks) {
    Write-NdjsonLine @{ v = 0; type = "partial_reply"; text = $c }
  }

  Write-NdjsonLine @{
    v = 0
    type = "final"
    result = @{
      status = "ok"
      text = $text
      native = @{
        threadId = "thread-demo"
        binding  = @{ openclawSessionId = "session-demo"; nativeThreadId = "thread-demo" }
      }
    }
  }

  Write-NdjsonLine @{
    v = 0
    type = "budget"
    remaining = @{
      turnsPerHour = 30
      toolCallsThisTurn = 19
      wallClockMsThisTurn = 600000
    }
  }
} finally {
  if ($script:Writer) { $script:Writer.Dispose() }
}

