/**
 * Windows Native Desktop App Icon Extractor
 * Extracted from main-g2764IDy.js (functions za, Ba, Ua, and PowerShell script Ra)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

// PowerShell script definition extracted from main-g2764IDy.js (Ra)
const POWERSHELL_ICON_EXTRACTOR = `
$code = @"
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;

public class CodexShellIconNative {
  [DllImport("shell32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct SHFILEINFO {
    public IntPtr hIcon;
    public int iIcon;
    public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
    public string szTypeName;
  };

  public const uint SHGFI_ICON = 0x000000100;
  public const uint SHGFI_SMALLICON = 0x000000001;

  public static string GetAppsFolderIconDataUrl(string path) {
    SHFILEINFO shinfo = new SHFILEINFO();
    IntPtr hImg = SHGetFileInfo(path, 0, ref shinfo, (uint)Marshal.SizeOf(shinfo), SHGFI_ICON | SHGFI_SMALLICON);
    if (shinfo.hIcon == IntPtr.Zero) return null;
    try {
      using (Icon icon = Icon.FromHandle(shinfo.hIcon)) {
        using (Bitmap bmp = icon.ToBitmap()) {
          using (MemoryStream ms = new MemoryStream()) {
            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
          }
        }
      }
    } finally {
      DestroyIcon(shinfo.hIcon);
    }
  }

  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
"@

Add-Type -AssemblyName System.Drawing
if (-not ("CodexShellIconNative" -as [type])) {
  try {
    Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
  } catch {}
}

function Convert-ExeIconToDataUrl([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  Add-Type -AssemblyName System.Drawing
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Path)
  if ($null -eq $icon) {
    return $null
  }
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap = $icon.ToBitmap()
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return "data:image/png;base64,$([Convert]::ToBase64String($stream.ToArray()))"
  } finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    $icon.Dispose()
    $stream.Dispose()
  }
}

$AppPath = $env:CODEX_NATIVE_DESKTOP_APP_ICON_PATH
if ([string]::IsNullOrWhiteSpace($AppPath)) {
  exit 0
}

$trimmedAppPath = $AppPath.Trim()
if (Test-Path -LiteralPath $trimmedAppPath -PathType Leaf) {
  $extension = [System.IO.Path]::GetExtension($trimmedAppPath).ToLowerInvariant()
  if ($extension -eq ".exe" -or $extension -eq ".dll") {
    $dataUrl = Convert-ExeIconToDataUrl $trimmedAppPath
    if ($null -ne $dataUrl) {
      Write-Output $dataUrl
    }
  }
  exit 0
}

try {
  $dataUrl = [CodexShellIconNative]::GetAppsFolderIconDataUrl($trimmedAppPath)
  if ($null -ne $dataUrl) {
    Write-Output $dataUrl
  }
} catch {
  exit 0
}
`;

export class WindowsIconExtractor {
  constructor({ nativeAddonPath = null, maxCacheEntries = 100 } = {}) {
    this.nativeAddonPath = nativeAddonPath;
    this.maxCacheEntries = maxCacheEntries;
    this.cache = new Map();
    this.addon = null;

    if (nativeAddonPath && fs.existsSync(nativeAddonPath)) {
      try {
        this.addon = createRequire(import.meta.url)(nativeAddonPath);
      } catch {}
    }
  }

  /**
   * Clean Windows app path from process: prefixes
   */
  cleanAppPath(appPath) {
    const trimmed = appPath.trim();
    if (trimmed.toLowerCase().startsWith("process:")) {
      const sliced = trimmed.slice(8).trim();
      if (sliced.includes("\\") || sliced.includes("/")) return sliced;
    }
    return trimmed;
  }

  /**
   * Extract application icon as PNG Data URL
   */
  async extractIcon(appPath) {
    const cleaned = this.cleanAppPath(appPath);
    if (!cleaned) return null;

    const cacheKey = cleaned.toLowerCase();
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    const promise = this.resolveIcon(cleaned);
    this.cache.set(cacheKey, promise);

    // Evict oldest if exceeding limit
    if (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    return promise;
  }

  async resolveIcon(appPath) {
    // 1. Try native addon if present
    if (this.addon?.iconSmallForAppPath) {
      try {
        const icon = await this.addon.iconSmallForAppPath(appPath);
        if (icon) return icon;
      } catch {}
    }

    // 2. PowerShell fallback
    if (process.platform === "win32") {
      try {
        const encodedCmd = Buffer.from(POWERSHELL_ICON_EXTRACTOR, "utf16le").toString("base64");
        const { stdout } = await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCmd],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              CODEX_NATIVE_DESKTOP_APP_ICON_PATH: appPath,
            },
            timeout: 10000,
            windowsHide: true,
          }
        );

        const match = stdout.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi);
        return match ? match[match.length - 1] : null;
      } catch {
        return null;
      }
    }

    return null;
  }
}
