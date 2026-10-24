# host-window.ps1 -- enumerate / raise / capture top-level Windows desktop windows.
#
# Called by lib/host.js. Deliberately standalone and argv-only: the Node side never
# builds a -Command string, because PowerShell 5.1 strips embedded double quotes from
# native argv and that is exactly how inline attempts mangle themselves.
#
# The result is ALWAYS written as UTF-8 (no BOM) JSON to -Out, including on failure.
# stdout is not used for data at all: PS 5.1 encodes console output in the OEM code
# page, which turns any non-ASCII window title into mojibake on the way to Node.
#
# Actions:
#   list    -- every visible, titled top-level window (filter with -Pattern / -ProcessId)
#   info    -- one window: rect, minimised/maximised flags
#   raise   -- restore/maximise and bring to front, then report the resulting rect
#   capture -- raise, then CopyFromScreen into a PNG at -Name
#
# Exit code is 0 whenever the JSON file was written; the JSON's own ok/error fields
# carry the outcome, so the caller never has to interpret exit codes.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('list', 'info', 'raise', 'capture')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$Out,

    [string]$Pattern = '',
    [int]$ProcessId = 0,
    [ValidateSet('focus', 'maximize', 'restore')]
    [string]$Mode = 'focus',
    [string]$Name = ''
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WinItem
{
    public long Handle;
    public int Pid;
    public string Title;
    public string Class;
    public int X;
    public int Y;
    public int W;
    public int H;
    public bool Minimized;
    public bool Maximized;
    public long Area { get { return (long)W * (long)H; } }
}

public class WinApi
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static List<WinItem> All()
    {
        List<WinItem> list = new List<WinItem>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder title = new StringBuilder(1024);
            GetWindowTextW(hWnd, title, 1024);
            string text = title.ToString();
            if (text.Length == 0) return true;
            StringBuilder cls = new StringBuilder(256);
            GetClassNameW(hWnd, cls, 256);
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            RECT rect;
            if (!GetWindowRect(hWnd, out rect)) return true;
            WinItem item = new WinItem();
            item.Handle = hWnd.ToInt64();
            item.Pid = (int)pid;
            item.Title = text;
            item.Class = cls.ToString();
            item.X = rect.Left;
            item.Y = rect.Top;
            item.W = rect.Right - rect.Left;
            item.H = rect.Bottom - rect.Top;
            item.Minimized = IsIconic(hWnd);
            item.Maximized = IsZoomed(hWnd);
            list.Add(item);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static bool Rect(IntPtr hWnd, out RECT rect) { return GetWindowRect(hWnd, out rect); }
}
'@

function Write-Result {
    param($payload)
    $json = $payload | ConvertTo-Json -Depth 6 -Compress
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Out, $json, $encoding)
}

function Select-Windows {
    param($items)
    $wanted = @($items)
    if ($ProcessId -gt 0) {
        $wanted = @($wanted | Where-Object { $_.Pid -eq $ProcessId })
    }
    if ($Pattern.Length -gt 0) {
        $wanted = @($wanted | Where-Object { $_.Title -like ('*' + $Pattern + '*') -or $_.Class -like ('*' + $Pattern + '*') })
    }
    # Largest first: when several windows match, the one most worth showing is the
    # big one, and reporting the runners-up keeps the choice auditable.
    return @($wanted | Sort-Object -Property Area -Descending)
}

function Convert-Item {
    param($item)
    return [ordered]@{
        handle    = $item.Handle
        pid       = $item.Pid
        title     = $item.Title
        class     = $item.Class
        rect      = [ordered]@{ x = $item.X; y = $item.Y; w = $item.W; h = $item.H }
        minimized = $item.Minimized
        maximized = $item.Maximized
    }
}

try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition $source
    [WinApi]::SetProcessDPIAware() | Out-Null

    $all = [WinApi]::All()
    $matched = Select-Windows $all

    switch ($Action) {
        'list' {
            $windows = @()
            foreach ($item in $matched) { $windows += Convert-Item $item }
            Write-Result ([ordered]@{
                ok      = $true
                action  = 'list'
                count   = $windows.Count
                total   = @($all).Count
                windows = $windows
            })
        }

        { $_ -in 'info', 'raise', 'capture' } {
            if ($matched.Count -eq 0) {
                # A miss must be actionable: hand back what does exist.
                $available = @()
                foreach ($item in @(Select-Windows $all)) {
                    $available += [ordered]@{ pid = $item.Pid; title = $item.Title; class = $item.Class }
                }
                Write-Result ([ordered]@{
                    ok        = $false
                    action    = $Action
                    error     = 'no visible top-level window matched'
                    pattern   = $Pattern
                    processId = $ProcessId
                    available = $available
                })
                exit 0
            }

            $target = $matched[0]
            $handle = [IntPtr]$target.Handle

            if ($Action -in 'raise', 'capture') {
                if ($target.Minimized) {
                    [WinApi]::ShowWindow($handle, 9) | Out-Null   # SW_RESTORE
                    Start-Sleep -Milliseconds 350
                }
                if ($Mode -eq 'maximize' -and -not $target.Maximized) {
                    [WinApi]::ShowWindow($handle, 3) | Out-Null   # SW_MAXIMIZE
                    Start-Sleep -Milliseconds 450
                }
                elseif ($Mode -eq 'restore' -and $target.Maximized) {
                    [WinApi]::ShowWindow($handle, 9) | Out-Null
                    Start-Sleep -Milliseconds 450
                }
                # HWND_TOP (IntPtr.Zero) + NOSIZE|NOMOVE|SHOWWINDOW=0x43. Without the
                # explicit z-order call the foreground lock can leave the window behind
                # whatever currently has focus, and the capture then contains the wrong app.
                [WinApi]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, 0x43) | Out-Null
                [WinApi]::BringWindowToTop($handle) | Out-Null
                [WinApi]::SetForegroundWindow($handle) | Out-Null
                Start-Sleep -Milliseconds 500
            }

            $rect = New-Object WinApi+RECT
            [WinApi]::Rect($handle, [ref]$rect) | Out-Null
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top

            $candidates = @()
            if ($matched.Count -gt 1) {
                foreach ($item in $matched) { $candidates += [ordered]@{ pid = $item.Pid; title = $item.Title } }
            }

            if ($Action -eq 'capture') {
                if ($width -le 0 -or $height -le 0) {
                    Write-Result ([ordered]@{
                        ok    = $false
                        action = 'capture'
                        error = "window has an empty rect (${width}x${height})"
                        title = $target.Title
                    })
                    exit 0
                }
                $bitmap = New-Object System.Drawing.Bitmap -ArgumentList $width, $height
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                try {
                    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size -ArgumentList $width, $height))
                    $bitmap.Save($Name, [System.Drawing.Imaging.ImageFormat]::Png)
                }
                finally {
                    $graphics.Dispose()
                    $bitmap.Dispose()
                }
                $bytes = (Get-Item -LiteralPath $Name).Length
                Write-Result ([ordered]@{
                    ok         = $true
                    action     = 'capture'
                    path       = $Name
                    bytes      = $bytes
                    width      = $width
                    height     = $height
                    pid        = $target.Pid
                    class      = $target.Class
                    title      = $target.Title
                    rect       = [ordered]@{ x = $rect.Left; y = $rect.Top; w = $width; h = $height }
                    maximized  = ($Mode -eq 'maximize')
                    candidates = $candidates
                })
            }
            else {
                Write-Result ([ordered]@{
                    ok         = $true
                    action     = $Action
                    pid        = $target.Pid
                    class      = $target.Class
                    title      = $target.Title
                    rect       = [ordered]@{ x = $rect.Left; y = $rect.Top; w = $width; h = $height }
                    minimized  = [WinApi]::IsIconic($handle)
                    maximized  = [WinApi]::IsZoomed($handle)
                    candidates = $candidates
                })
            }
        }
    }
}
catch {
    try {
        Write-Result ([ordered]@{
            ok     = $false
            action = $Action
            error  = ($_.Exception.Message -replace "`r?`n", ' ')
            type   = 'powershell'
        })
    }
    catch {
        # If the result file itself cannot be written there is nothing useful left
        # to do; the caller reports the missing file.
    }
}

exit 0
