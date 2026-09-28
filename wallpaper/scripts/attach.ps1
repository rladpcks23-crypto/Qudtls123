# Reparents the given windows into the desktop layer that sits behind the
# icons (the WorkerW trick used by Wallpaper Engine / Lively).
#   -Spec "hwnd,x,y,w,h;hwnd,x,y,w,h"   (physical pixels, relative to the
#                                        virtual screen's top-left corner)
# Prints OK / OK24H2 on success, FAIL otherwise.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts
# in the ANSI code page.
param([Parameter(Mandatory = $true)][string]$Spec)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WallAttach {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")]
    static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")]
    static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")]
    static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    const int GWL_EXSTYLE = -20;
    const long WS_EX_LAYERED = 0x80000;
    const uint LWA_ALPHA = 0x2;
    const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
    const int SW_SHOWNOACTIVATE = 4;

    public static string Attach(string spec) {
        // Coordinates from Electron are physical pixels; make sure Windows
        // doesn't rescale them for this (otherwise DPI-unaware) process.
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }

        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return "FAIL no Progman";
        IntPtr res;
        // Ask explorer to spawn the WorkerW that sits behind the icons.
        SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out res);

        IntPtr workerw = IntPtr.Zero;
        EnumWindows(delegate(IntPtr top, IntPtr l) {
            if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                workerw = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            return true;
        }, IntPtr.Zero);

        IntPtr parent = workerw;
        IntPtr defView = IntPtr.Zero;
        bool raised = false;
        if (parent == IntPtr.Zero) {
            // Windows 11 24H2+: the icon view and WorkerW are children of
            // Progman. Sit between them: below the icons, above the static
            // wallpaper.
            defView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (defView == IntPtr.Zero) return "FAIL no WorkerW";
            parent = progman;
            raised = true;
        }

        foreach (string item in spec.Split(';')) {
            string[] p = item.Split(',');
            if (p.Length != 5) continue;
            IntPtr hwnd = new IntPtr(long.Parse(p[0]));
            int x = int.Parse(p[1]), y = int.Parse(p[2]), w = int.Parse(p[3]), h = int.Parse(p[4]);
            if (raised) {
                long ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
                SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(ex | WS_EX_LAYERED));
                SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
            }
            SetParent(hwnd, parent);
            if (raised)
                SetWindowPos(hwnd, defView, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            else
                SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        return raised ? "OK24H2" : "OK";
    }
}
'@

try {
    [Console]::Out.WriteLine([WallAttach]::Attach($Spec))
} catch {
    [Console]::Out.WriteLine("FAIL " + $_.Exception.Message)
}
