# Frees the frontend/backend dev ports before `npm run dev` starts a new session.
# `dotnet run`'s child process (Kestrel) doesn't reliably die when a terminal window
# closes on Windows, so a prior session can leave an orphan holding port 5058; the
# next backend start then fails to bind and exits immediately. Killing whatever
# already owns 3000/5058 up front makes every `npm run dev` start clean.
# ASCII-only on purpose: PowerShell 5.1 reads unmarked files as ANSI.
$ErrorActionPreference = "Stop"

foreach ($port in 3000, 5058) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($pid in ($conns.OwningProcess | Select-Object -Unique)) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction Stop
            Write-Host "Freeing port $port (killing $($proc.ProcessName) pid $pid)."
            Stop-Process -Id $pid -Force
        } catch {}
    }
}
