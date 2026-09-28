# Blocker loop. Every ~0.7s:
#   - force-kills any process whose name is in config.blockedApps
#   - force-kills a browser if any of its visible windows has a title that
#     contains one of config.blockedSites (tab titles, e.g. "... - YouTube")
# Writes "KILL<TAB>app|site<TAB>name" per block to stdout. Exits when the
# parent (the Electron app) is gone. Re-reads the config when it changes.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads it as ANSI).
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [string]$SelfName = '',
    [int]$ParentPid = 0
)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WinTitles {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    // Every visible top-level window title, tagged with its process id.
    public static List<KeyValuePair<int, string>> All() {
        var list = new List<KeyValuePair<int, string>>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            int len = GetWindowTextLength(h);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            list.Add(new KeyValuePair<int, string>((int)pid, sb.ToString()));
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
'@

# Never touch these, whatever the config says.
$protected = @(
    'system', 'idle', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass',
    'svchost', 'dwm', 'explorer', 'sihost', 'fontdrvhost', 'ctfmon', 'conhost',
    'powershell', 'pwsh', 'taskmgr', 'runtimebroker', 'searchhost', 'searchapp',
    'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
    'securityhealthsystray', 'msmpeng', 'electron'
)
if ($SelfName) { $protected += $SelfName.ToLower() }

$browsers = @(
    'chrome', 'msedge', 'firefox', 'whale', 'opera', 'brave', 'vivaldi',
    'iexplore', 'chromium', 'arc', 'zen', 'floorp', 'librewolf', 'waterfox'
)

# Report each name at most once per 10s, so something we can't kill (e.g. a
# game running as administrator) doesn't spam the popup every loop.
$lastEmit = @{}
function Emit([string]$kind, [string]$name) {
    $key = "$kind|$name"
    $now = [DateTime]::UtcNow
    if ($lastEmit.ContainsKey($key) -and ($now - $lastEmit[$key]).TotalSeconds -lt 10) { return }
    $lastEmit[$key] = $now
    [Console]::Out.WriteLine("KILL`t$kind`t$name")
    [Console]::Out.Flush()
}

$lastWrite = [datetime]::MinValue
$apps = @()
$sites = @()

while ($true) {
    if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }

    $fi = Get-Item -LiteralPath $ConfigPath -ErrorAction SilentlyContinue
    if ($fi -and $fi.LastWriteTimeUtc -ne $lastWrite) {
        $lastWrite = $fi.LastWriteTimeUtc
        try {
            $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $apps = @($cfg.blockedApps | ForEach-Object { ([string]$_).Trim().ToLower() -replace '\.exe$', '' } |
                Where-Object { $_ -and ($protected -notcontains $_) })
            $sites = @($cfg.blockedSites | ForEach-Object { ([string]$_).Trim().ToLower() } | Where-Object { $_ })
        } catch { }
    }

    $procs = @(Get-Process)
    $byPid = @{}
    foreach ($p in $procs) { $byPid[$p.Id] = $p }

    # Blocked apps: kill every process with that name (launchers spawn many).
    $killed = @{}
    foreach ($p in $procs) {
        $n = $p.ProcessName.ToLower()
        if ($apps -contains $n) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            if (-not $killed.ContainsKey($n)) { $killed[$n] = $true; Emit 'app' $p.ProcessName }
        }
    }

    # Blocked sites: look at every visible window of every browser.
    if ($sites.Count -gt 0) {
        $hitBrowsers = @{}
        foreach ($w in [WinTitles]::All()) {
            $p = $byPid[$w.Key]
            if (-not $p) { continue }
            $n = $p.ProcessName.ToLower()
            if ($browsers -notcontains $n -or $hitBrowsers.ContainsKey($n)) { continue }
            $title = $w.Value.ToLower()
            foreach ($s in $sites) {
                if ($title.Contains($s)) { $hitBrowsers[$n] = $s; break }
            }
        }
        foreach ($n in $hitBrowsers.Keys) {
            Stop-Process -Name $n -Force -ErrorAction SilentlyContinue
            Emit 'site' $hitBrowsers[$n]
        }
    }

    Start-Sleep -Milliseconds 700
}
