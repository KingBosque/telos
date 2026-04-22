param(
  [string]$InFile = ""
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Error $msg
  exit 1
}

function Assert($cond, $msg) {
  if (-not $cond) { Fail $msg }
}

function Read-Lines {
  if ($InFile -ne "") {
    if (!(Test-Path $InFile)) { Fail "Input file not found: $InFile" }
    return Get-Content -Path $InFile
  }
  return @($input)
}

$script:Json = $null
try {
  Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
  $script:Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $script:Json.MaxJsonLength = 1024 * 1024 * 16
} catch {
  # Fall back to ConvertFrom-Json if available.
}

function Parse-Json {
  param([Parameter(Mandatory=$true)][string]$Text)
  if ($script:Json) {
    return $script:Json.DeserializeObject($Text)
  }
  return ($Text | ConvertFrom-Json -Depth 50)
}

$lines = Read-Lines
Assert ($lines.Count -gt 0) "No NDJSON lines provided (pass -InFile or pipe input)."

$seen = @{
  heartbeat = $false
  tool_call = 0
  tool_result = 0
  budget = 0
  partial_reply = 0
  final = $false
}

$toolCallIds = @{}
$toolResultIds = @{}

foreach ($line in $lines) {
  if ($null -eq $line) { continue }
  $trim = $line.Trim()
  if ($trim -eq "") { continue }

  $obj = $null
  try { $obj = Parse-Json -Text $trim } catch { Fail "Invalid JSON line: $trim" }

  $v = $obj["v"]
  $type = $obj["type"]
  Assert ($v -eq 0) "Expected v=0; got: $v"
  Assert ($type -is [string]) "Missing/invalid type field."

  switch ($type) {
    "heartbeat" {
      $seen.heartbeat = $true
      Assert ($obj["ts"] -ne $null) "heartbeat missing ts"
    }
    "agent_event" {
      Assert ($obj["event"] -ne $null) "agent_event missing event"
      $event = $obj["event"]
      if ($event -ne $null -and $event["kind"] -eq "trigger") {
        Assert (($event["triggerId"] -is [string])) "trigger agent_event missing triggerId"
      }
    }
    "partial_reply" {
      $seen.partial_reply++
      Assert (($obj["text"] -is [string])) "partial_reply missing text"
    }
    "tool_call" {
      $seen.tool_call++
      Assert (($obj["callId"] -is [string])) "tool_call missing callId"
      Assert (($obj["name"] -is [string])) "tool_call missing name"
      Assert (($obj["reason"] -is [string])) "tool_call missing reason (safety UX requires it)"
      Assert (($obj["expectedSideEffects"] -ne $null)) "tool_call missing expectedSideEffects"
      Assert (($obj["dataProvenance"] -is [string])) "tool_call missing dataProvenance"
      $toolCallIds[$obj["callId"]] = $true
    }
    "tool_result" {
      $seen.tool_result++
      Assert (($obj["callId"] -is [string])) "tool_result missing callId"
      # approved/policyBasis are strongly recommended but may be absent in older runtimes
      $toolResultIds[$obj["callId"]] = $true
    }
    "budget" {
      $seen.budget++
      Assert ($obj["remaining"] -ne $null) "budget missing remaining"
    }
    "final" {
      $seen.final = $true
      $result = $obj["result"]
      Assert ($result -ne $null) "final missing result"
      $status = $result["status"]
      Assert ($status -is [string]) "final.result missing status"
      if ($status -eq "ok") {
        # text is optional if streamed
        if ($result["native"] -ne $null) {
          # optional
        }
      } elseif ($status -eq "error") {
        Assert ($result["error"] -ne $null) "final error missing error object"
      } else {
        Fail "final.result.status must be ok|error; got $status"
      }
    }
    Default {
      Fail "Unknown event type: $type"
    }
  }
}

Assert $seen.final "Missing final event."
foreach ($id in $toolResultIds.Keys) {
  Assert ($toolCallIds.ContainsKey($id)) "tool_result callId=$id had no matching tool_call"
}

Write-Output ("OK: heartbeat={0}, tool_call={1}, tool_result={2}, budget={3}, partial_reply={4}, final={5}" -f `
  $seen.heartbeat, $seen.tool_call, $seen.tool_result, $seen.budget, $seen.partial_reply, $seen.final)

