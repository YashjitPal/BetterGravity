using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

namespace WindowsComputerUse {
    public class NativeRunner {
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);

        public static IntPtr InteractiveDesktopHandle = IntPtr.Zero;

        public static void EnumerateAllWindows(EnumWindowsProc proc) {
            bool foundAny = false;
            if (InteractiveDesktopHandle != IntPtr.Zero) {
                EnumDesktopWindows(InteractiveDesktopHandle, (hWnd, lParam) => {
                    foundAny = true;
                    return proc(hWnd, lParam);
                }, IntPtr.Zero);
            }
            if (!foundAny) {
                EnumWindows(proc, IntPtr.Zero);
            }
        }

        [DllImport("user32.dll")]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessWindowStation(IntPtr hWinSta);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        public static void AttachToInteractiveDesktop() {
            try {
                SetProcessDPIAware();
                IntPtr hwinsta = OpenWindowStation("WinSta0", false, 0x037F);
                if (hwinsta != IntPtr.Zero) {
                    SetProcessWindowStation(hwinsta);
                }
                IntPtr hdesk = OpenDesktop("Default", 0, false, 0x01FF);
                if (hdesk != IntPtr.Zero) {
                    InteractiveDesktopHandle = hdesk;
                    SetThreadDesktop(hdesk);
                }
            } catch {}
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        public const uint INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint INPUT_MOUSE = 0;

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        public static void SendMouseClick(uint downFlag, uint upFlag) {
            INPUT down = new INPUT { type = INPUT_MOUSE };
            down.u.mi.dwFlags = downFlag;
            down.u.mi.dwExtraInfo = (UIntPtr)0x12345;
            INPUT up = new INPUT { type = INPUT_MOUSE };
            up.u.mi.dwFlags = upFlag;
            up.u.mi.dwExtraInfo = (UIntPtr)0x12345;
            SendInput(1, new INPUT[] { down }, Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(30);
            SendInput(1, new INPUT[] { up }, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void NotifyOverlayPoint(int x, int y, string status = "Antigravity is controlling...") {
            try {
                using (TcpClient client = new TcpClient()) {
                    IAsyncResult ar = client.BeginConnect("127.0.0.1", 51830, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(80) && client.Connected) {
                        client.EndConnect(ar);
                        using (NetworkStream stream = client.GetStream())
                        using (StreamWriter w = new StreamWriter(stream, Encoding.UTF8) { AutoFlush = true }) {
                            w.WriteLine(string.Format("{{\"x\":{0},\"y\":{1},\"status\":\"{2}\"}}", x, y, status));
                        }
                    }
                }
            } catch {}
        }

        public static Point ResolveCoordinates(double inputX, double inputY, IntPtr hWnd) {
            if (hWnd != IntPtr.Zero) {
                RECT r;
                if (GetWindowRect(hWnd, out r)) {
                    Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                    try { screenBounds = Screen.FromHandle(hWnd).Bounds; } catch {}

                    int rx = Math.Max(screenBounds.Left, r.Left);
                    int ry = Math.Max(screenBounds.Top, r.Top);
                    int rw = Math.Min(screenBounds.Right - rx, Math.Max(100, r.Right - rx));
                    int rh = Math.Min(screenBounds.Bottom - ry, Math.Max(100, r.Bottom - ry));

                    if (rw > 0 && rh > 0) {
                        // 1. Normalized 0.0 .. 1.0
                        if (inputX >= 0.0 && inputX <= 1.0 && inputY >= 0.0 && inputY <= 1.0 && (inputX > 0 || inputY > 0)) {
                            return new Point(rx + (int)Math.Round(inputX * rw), ry + (int)Math.Round(inputY * rh));
                        }

                        // 2. Normalized 0 .. 1000 (standard for Gemini / vision models)
                        if (inputX >= 0.0 && inputX <= 1000.0 && inputY >= 0.0 && inputY <= 1000.0 &&
                            (inputX > rw || inputY > rh) && (rw > 1000 || rh > 1000)) {
                            return new Point(rx + (int)Math.Round(inputX * rw / 1000.0), ry + (int)Math.Round(inputY * rh / 1000.0));
                        }

                        // 3. Absolute screen coordinates that already fall within the visible window rect
                        if (inputX >= rx && inputX <= rx + rw && inputY >= ry && inputY <= ry + rh && (rx > 30 || ry > 30)) {
                            return new Point((int)Math.Round(inputX), (int)Math.Round(inputY));
                        }

                        // 4. Window-relative coordinates from window screenshot (0..rw, 0..rh)
                        if (inputX >= 0 && inputX <= rw && inputY >= 0 && inputY <= rh) {
                            return new Point(rx + (int)Math.Round(inputX), ry + (int)Math.Round(inputY));
                        }

                        // 5. Fallback within window boundaries
                        return new Point(rx + (int)Math.Round(inputX), ry + (int)Math.Round(inputY));
                    }
                }
            }

            // Desktop coordinate resolution (multi-monitor aware)
            Rectangle primaryBounds = Screen.PrimaryScreen.Bounds;
            if (hWnd != IntPtr.Zero) {
                try { primaryBounds = Screen.FromHandle(hWnd).Bounds; } catch {}
            }

            // Normalized 0.0 .. 1.0 for full screen
            if (inputX >= 0.0 && inputX <= 1.0 && inputY >= 0.0 && inputY <= 1.0 && (inputX > 0 || inputY > 0)) {
                return new Point(primaryBounds.Left + (int)Math.Round(inputX * primaryBounds.Width),
                                 primaryBounds.Top + (int)Math.Round(inputY * primaryBounds.Height));
            }

            // Normalized 0 .. 1000 for full screen
            if (inputX >= 0.0 && inputX <= 1000.0 && inputY >= 0.0 && inputY <= 1000.0 &&
                (inputX > primaryBounds.Width || inputY > primaryBounds.Height)) {
                return new Point(primaryBounds.Left + (int)Math.Round(inputX * primaryBounds.Width / 1000.0),
                                 primaryBounds.Top + (int)Math.Round(inputY * primaryBounds.Height / 1000.0));
            }

            return new Point((int)Math.Round(inputX), (int)Math.Round(inputY));
        }

        public static List<AutomationElement> GetInteractiveElements(IntPtr hWnd) {
            List<AutomationElement> list = new List<AutomationElement>();
            try {
                AutomationElement root = (hWnd != IntPtr.Zero)
                    ? AutomationElement.FromHandle(hWnd)
                    : AutomationElement.RootElement;
                if (root == null) return list;

                Condition cond = new OrCondition(
                    new PropertyCondition(AutomationElement.IsInvokePatternAvailableProperty, true),
                    new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true),
                    new PropertyCondition(AutomationElement.IsTogglePatternAvailableProperty, true),
                    new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink)
                );

                AutomationElementCollection found = root.FindAll(TreeScope.Descendants, cond);
                if (found != null) {
                    for (int i = 0; i < Math.Min(found.Count, 120); i++) {
                        AutomationElement el = found[i];
                        try {
                            var r = el.Current.BoundingRectangle;
                            if (r.Width > 4 && r.Height > 4 && !r.IsEmpty) {
                                list.Add(el);
                            }
                        } catch {}
                    }
                }
            } catch {}
            return list;
        }

        public static Point GetElementCenterPoint(IntPtr hWnd, int index) {
            try {
                var elements = GetInteractiveElements(hWnd);
                if (index >= 0 && index < elements.Count) {
                    var rect = elements[index].Current.BoundingRectangle;
                    if (!rect.IsEmpty && rect.Width > 0 && rect.Height > 0) {
                        return new Point((int)(rect.Left + rect.Width / 2), (int)(rect.Top + rect.Height / 2));
                    }
                }
            } catch {}
            return new Point(-1, -1);
        }

        public static void SendKeyDown(ushort vk) {
            INPUT input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki.wVk = vk;
            input.u.ki.dwFlags = 0;
            input.u.ki.dwExtraInfo = (UIntPtr)0x12345;
            SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
            keybd_event((byte)vk, 0, 0, UIntPtr.Zero);
        }

        public static void SendKeyUp(ushort vk) {
            INPUT input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki.wVk = vk;
            input.u.ki.dwFlags = KEYEVENTF_KEYUP;
            input.u.ki.dwExtraInfo = (UIntPtr)0x12345;
            SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
            keybd_event((byte)vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        public static IntPtr FocusAppWindow(string appQuery) {
            if (string.IsNullOrEmpty(appQuery)) return IntPtr.Zero;
            IntPtr matchedHwnd = IntPtr.Zero;
            string q = appQuery.ToLower().Trim();

            EnumerateAllWindows((hWnd, lParam) => {
                if (!IsWindowVisible(hWnd)) return true;
                int len = GetWindowTextLength(hWnd);
                if (len == 0) return true;
                StringBuilder sb = new StringBuilder(len + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString();

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string pName = "";
                try {
                    var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                    pName = proc.ProcessName.ToLower();
                } catch {}

                if (title.ToLower().Contains(q) || pName.Contains(q) || ("process:" + pName).Contains(q)) {
                    matchedHwnd = hWnd;
                    return false;
                }
                return true;
            });

            if (matchedHwnd != IntPtr.Zero) {
                IntPtr fg = GetForegroundWindow();
                if (fg == matchedHwnd) {
                    return matchedHwnd;
                }
                uint curThread = GetCurrentThreadId();
                uint unused = 0;
                uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out unused) : 0;
                bool attached = false;
                if (fgThread != 0 && fgThread != curThread) {
                    attached = AttachThreadInput(curThread, fgThread, true);
                }
                if (IsIconic(matchedHwnd)) {
                    ShowWindow(matchedHwnd, 9); // SW_RESTORE only if minimized
                }
                BringWindowToTop(matchedHwnd);
                SetForegroundWindow(matchedHwnd);
                if (attached) {
                    AttachThreadInput(curThread, fgThread, false);
                }
                Thread.Sleep(80);
            }
            return matchedHwnd;
        }

        public static bool TryPasteText(string text) {
            if (string.IsNullOrEmpty(text)) return false;
            try {
                Thread t = new Thread(() => {
                    try {
                        Clipboard.SetText(text);
                    } catch {}
                });
                t.SetApartmentState(ApartmentState.STA);
                t.Start();
                t.Join(500);

                SendKeyDown(0x11);
                Thread.Sleep(25);
                SendKeyDown(0x56);
                Thread.Sleep(25);
                SendKeyUp(0x56);
                Thread.Sleep(25);
                SendKeyUp(0x11);
                Thread.Sleep(50);
                return true;
            } catch {
                return false;
            }
        }

        public static void SendUnicodeText(string text) {
            if (string.IsNullOrEmpty(text)) return;
            foreach (char c in text) {
                if (c == '\n') {
                    SendKeyDown(0x0D);
                    Thread.Sleep(20);
                    SendKeyUp(0x0D);
                    Thread.Sleep(30);
                    continue;
                }
                if (c == '\r') continue;

                INPUT down = new INPUT { type = INPUT_KEYBOARD };
                down.u.ki.wVk = 0;
                down.u.ki.wScan = (ushort)c;
                down.u.ki.dwFlags = KEYEVENTF_UNICODE;
                down.u.ki.dwExtraInfo = (UIntPtr)0x12345;

                INPUT up = new INPUT { type = INPUT_KEYBOARD };
                up.u.ki.wVk = 0;
                up.u.ki.wScan = (ushort)c;
                up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                up.u.ki.dwExtraInfo = (UIntPtr)0x12345;

                SendInput(1, new INPUT[] { down }, Marshal.SizeOf(typeof(INPUT)));
                Thread.Sleep(5);
                SendInput(1, new INPUT[] { up }, Marshal.SizeOf(typeof(INPUT)));
                Thread.Sleep(8);
            }
        }

        public static void SendKeyCombination(string keySpec) {
            if (string.IsNullOrEmpty(keySpec)) return;
            string lower = keySpec.Trim().ToLower();

            // Mapping for common keys
            ushort vk = 0;
            bool ctrl = lower.Contains("ctrl") || lower.Contains("control");
            bool alt = lower.Contains("alt");
            bool shift = lower.Contains("shift");
            bool winMod = lower.Contains("win+") || lower.Contains("super+") || lower.Contains("windows+");

            if (lower == "win" || lower == "windows" || lower == "super" || lower == "lwin" || lower.EndsWith("+win") || lower.EndsWith("+windows") || lower.EndsWith("+super")) vk = 0x5B;
            else if (lower.EndsWith("enter") || lower.EndsWith("return")) vk = 0x0D;
            else if (lower.EndsWith("tab")) vk = 0x09;
            else if (lower.EndsWith("escape") || lower.EndsWith("esc")) vk = 0x1B;
            else if (lower.EndsWith("backspace")) vk = 0x08;
            else if (lower.EndsWith("space")) vk = 0x20;
            else if (lower.EndsWith("up")) vk = 0x26;
            else if (lower.EndsWith("down")) vk = 0x28;
            else if (lower.EndsWith("left")) vk = 0x25;
            else if (lower.EndsWith("right")) vk = 0x27;
            else if (lower.EndsWith("home")) vk = 0x24;
            else if (lower.EndsWith("end")) vk = 0x23;
            else if (lower.EndsWith("delete") || lower.EndsWith("del")) vk = 0x2E;
            else if (lower.EndsWith("pageup")) vk = 0x21;
            else if (lower.EndsWith("pagedown")) vk = 0x22;
            else {
                // Check single letter e.g. "a", "c", "v", "t", "l"
                string parts = lower.Replace("control+", "").Replace("ctrl+", "").Replace("alt+", "").Replace("shift+", "").Replace("win+", "").Replace("super+", "").Trim();
                if (parts.Length == 1) {
                    vk = (ushort)char.ToUpper(parts[0]);
                }
            }

            if (winMod) {
                SendKeyDown(0x5B);
                Thread.Sleep(25);
            }

            if (ctrl) {
                SendKeyDown(0x11);
                Thread.Sleep(25);
            }
            if (alt) {
                SendKeyDown(0x12);
                Thread.Sleep(25);
            }
            if (shift) {
                SendKeyDown(0x10);
                Thread.Sleep(25);
            }

            if (vk != 0) {
                SendKeyDown(vk);
                Thread.Sleep(35);
                SendKeyUp(vk);
                Thread.Sleep(25);
            }

            if (winMod) {
                SendKeyUp(0x5B);
                Thread.Sleep(20);
            }
            if (shift) {
                SendKeyUp(0x10);
                Thread.Sleep(20);
            }
            if (alt) {
                SendKeyUp(0x12);
                Thread.Sleep(20);
            }
            if (ctrl) {
                SendKeyUp(0x11);
                Thread.Sleep(20);
            }
        }

        public static string JsonEscape(string s) {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in s) {
                switch (c) {
                    case '\\': sb.Append("\\\\"); break;
                    case '\"': sb.Append("\\\""); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        public static string Dispatch(string action, Dictionary<string, string> args) {
            switch (action.ToLower()) {
                case "list_apps":
                case "list_windows": {
                    List<string> appJsonList = new List<string>();
                    Dictionary<string, List<string>> grouped = new Dictionary<string, List<string>>();

                    EnumerateAllWindows((hWnd, lParam) => {
                        if (!IsWindowVisible(hWnd)) return true;
                        int len = GetWindowTextLength(hWnd);
                        if (len == 0) return true;
                        StringBuilder sb = new StringBuilder(len + 1);
                        GetWindowText(hWnd, sb, sb.Capacity);
                        string title = sb.ToString().Trim();

                        RECT r;
                        GetWindowRect(hWnd, out r);
                        int w = r.Right - r.Left;
                        int h = r.Bottom - r.Top;
                        if (w < 40 || h < 40) return true;

                        uint pid = 0;
                        GetWindowThreadProcessId(hWnd, out pid);
                        string pName = "app";
                        try {
                            var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                            pName = proc.ProcessName;
                        } catch {}

                        string winJson = string.Format("{{\"id\":{0},\"title\":\"{1}\",\"frame\":{{\"x\":{2},\"y\":{3},\"width\":{4},\"height\":{5}}}}}",
                            hWnd.ToInt64(), JsonEscape(title), r.Left, r.Top, w, h);

                        if (!grouped.ContainsKey(pName)) {
                            grouped[pName] = new List<string>();
                        }
                        grouped[pName].Add(winJson);
                        return true;
                    });

                    foreach (var kvp in grouped) {
                        string pName = kvp.Key;
                        string id = "process:" + pName.ToLower() + ".exe";
                        string wins = string.Join(",", kvp.Value.ToArray());
                        appJsonList.Add(string.Format("{{\"id\":\"{0}\",\"displayName\":\"{1}\",\"windows\":[{2}]}}",
                            JsonEscape(id), JsonEscape(pName), wins));
                    }

                    return "[" + string.Join(",", appJsonList.ToArray()) + "]";
                }

                case "focus": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = FocusAppWindow(app);
                    return string.Format("{{\"status\":\"success\",\"action\":\"focus\",\"hwnd\":{0}}}", hwnd.ToInt64());
                }

                case "click": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    } else {
                        hwnd = GetForegroundWindow();
                    }

                    int x = Cursor.Position.X;
                    int y = Cursor.Position.Y;

                    if (args.ContainsKey("element_index")) {
                        int elIdx = 0;
                        if (int.TryParse(args["element_index"], out elIdx)) {
                            Point ptEl = GetElementCenterPoint(hwnd, elIdx);
                            if (ptEl.X >= 0 && ptEl.Y >= 0) {
                                x = ptEl.X;
                                y = ptEl.Y;
                            }
                        }
                    } else if (args.ContainsKey("x") && args.ContainsKey("y")) {
                        double rx, ry;
                        if (double.TryParse(args["x"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rx) &&
                            double.TryParse(args["y"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out ry)) {
                            Point resolved = ResolveCoordinates(rx, ry, hwnd);
                            x = resolved.X;
                            y = resolved.Y;
                        }
                    }

                    string button = args.ContainsKey("button") ? args["button"].ToLower() : "left";
                    int count = args.ContainsKey("count") ? int.Parse(args["count"]) : 1;

                    NotifyOverlayPoint(x, y, "Antigravity is clicking...");
                    SetCursorPos(x, y);
                    Cursor.Position = new Point(x, y);
                    Thread.Sleep(30);

                    uint down = MOUSEEVENTF_LEFTDOWN;
                    uint up = MOUSEEVENTF_LEFTUP;
                    if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
                    else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }

                    for (int i = 0; i < count; i++) {
                        SendMouseClick(down, up);
                        if (i < count - 1) Thread.Sleep(80);
                    }

                    return string.Format("{{\"status\":\"success\",\"action\":\"click\",\"target\":[{0},{1}],\"button\":\"{2}\",\"count\":{3}}}",
                        x, y, button, count);
                }

                case "drag": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    } else {
                        hwnd = GetForegroundWindow();
                    }

                    int fx = Cursor.Position.X;
                    int fy = Cursor.Position.Y;
                    int tx = fx;
                    int ty = fy;

                    if (args.ContainsKey("from_x") && args.ContainsKey("from_y")) {
                        double rfx, rfy;
                        if (double.TryParse(args["from_x"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rfx) &&
                            double.TryParse(args["from_y"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rfy)) {
                            Point ptFrom = ResolveCoordinates(rfx, rfy, hwnd);
                            fx = ptFrom.X;
                            fy = ptFrom.Y;
                        }
                    }

                    if (args.ContainsKey("to_x") && args.ContainsKey("to_y")) {
                        double rtx, rty;
                        if (double.TryParse(args["to_x"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rtx) &&
                            double.TryParse(args["to_y"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rty)) {
                            Point ptTo = ResolveCoordinates(rtx, rty, hwnd);
                            tx = ptTo.X;
                            ty = ptTo.Y;
                        }
                    } else {
                        tx = fx;
                        ty = fy;
                    }

                    NotifyOverlayPoint(fx, fy, "Antigravity is dragging...");
                    SetCursorPos(fx, fy);
                    Cursor.Position = new Point(fx, fy);
                    Thread.Sleep(40);

                    INPUT down = new INPUT { type = INPUT_MOUSE };
                    down.u.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
                    down.u.mi.dwExtraInfo = (UIntPtr)0x12345;
                    SendInput(1, new INPUT[] { down }, Marshal.SizeOf(typeof(INPUT)));
                    Thread.Sleep(40);

                    // Interpolate with MOUSEEVENTF_MOVE
                    int steps = 20;
                    for (int i = 1; i <= steps; i++) {
                        int cx = fx + (tx - fx) * i / steps;
                        int cy = fy + (ty - fy) * i / steps;
                        SetCursorPos(cx, cy);
                        Cursor.Position = new Point(cx, cy);
                        mouse_event(0x0001, 0, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(10);
                    }

                    INPUT up = new INPUT { type = INPUT_MOUSE };
                    up.u.mi.dwFlags = MOUSEEVENTF_LEFTUP;
                    up.u.mi.dwExtraInfo = (UIntPtr)0x12345;
                    SendInput(1, new INPUT[] { up }, Marshal.SizeOf(typeof(INPUT)));
                    Thread.Sleep(30);

                    NotifyOverlayPoint(tx, ty, "Done");
                    return string.Format("{{\"status\":\"success\",\"action\":\"drag\",\"from\":[{0},{1}],\"to\":[{2},{3}]}}", fx, fy, tx, ty);
                }

                case "scroll": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    } else {
                        hwnd = GetForegroundWindow();
                    }

                    int x = Cursor.Position.X;
                    int y = Cursor.Position.Y;

                    if (args.ContainsKey("element_index")) {
                        int elIdx = 0;
                        if (int.TryParse(args["element_index"], out elIdx)) {
                            Point ptEl = GetElementCenterPoint(hwnd, elIdx);
                            if (ptEl.X >= 0 && ptEl.Y >= 0) {
                                x = ptEl.X;
                                y = ptEl.Y;
                            }
                        }
                    } else if (args.ContainsKey("x") && args.ContainsKey("y")) {
                        double rx, ry;
                        if (double.TryParse(args["x"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rx) &&
                            double.TryParse(args["y"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out ry)) {
                            Point resolved = ResolveCoordinates(rx, ry, hwnd);
                            x = resolved.X;
                            y = resolved.Y;
                        }
                    }

                    string dir = args.ContainsKey("direction") ? args["direction"].ToLower() : "down";
                    int pages = args.ContainsKey("pages") ? int.Parse(args["pages"]) : 1;

                    SetCursorPos(x, y);
                    Cursor.Position = new Point(x, y);
                    NotifyOverlayPoint(x, y, "Antigravity is scrolling...");
                    Thread.Sleep(30);

                    int delta = (dir == "up" ? 120 : -120) * pages;
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);

                    return string.Format("{{\"status\":\"success\",\"action\":\"scroll\",\"direction\":\"{0}\",\"pages\":{1}}}", dir, pages);
                }

                case "type":
                case "type_text": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    } else {
                        hwnd = GetForegroundWindow();
                    }

                    if (args.ContainsKey("element_index")) {
                        int elIdx = 0;
                        if (int.TryParse(args["element_index"], out elIdx)) {
                            Point ptEl = GetElementCenterPoint(hwnd, elIdx);
                            if (ptEl.X >= 0 && ptEl.Y >= 0) {
                                SetCursorPos(ptEl.X, ptEl.Y);
                                Cursor.Position = ptEl;
                                NotifyOverlayPoint(ptEl.X, ptEl.Y, "Antigravity is typing...");
                                Thread.Sleep(30);
                                SendMouseClick(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
                                Thread.Sleep(60);
                            }
                        }
                    } else if (args.ContainsKey("x") && args.ContainsKey("y")) {
                        double rx, ry;
                        if (double.TryParse(args["x"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out rx) &&
                            double.TryParse(args["y"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out ry)) {
                            Point resolved = ResolveCoordinates(rx, ry, hwnd);
                            SetCursorPos(resolved.X, resolved.Y);
                            Cursor.Position = resolved;
                            NotifyOverlayPoint(resolved.X, resolved.Y, "Antigravity is typing...");
                            Thread.Sleep(30);
                            SendMouseClick(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
                            Thread.Sleep(60);
                        }
                    }

                    string text = args.ContainsKey("text") ? args["text"] : "";
                    SendUnicodeText(text);

                    return string.Format("{{\"status\":\"success\",\"action\":\"type_text\",\"length\":{0}}}", text.Length);
                }

                case "press_key": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    if (!string.IsNullOrEmpty(app)) FocusAppWindow(app);

                    string key = args.ContainsKey("key") ? args["key"] : "";
                    SendKeyCombination(key);

                    return string.Format("{{\"status\":\"success\",\"action\":\"press_key\",\"key\":\"{0}\"}}", JsonEscape(key));
                }

                case "perform_accessibility_action": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    } else {
                        hwnd = GetForegroundWindow();
                    }

                    int elementIndex = args.ContainsKey("element_index") ? int.Parse(args["element_index"]) : 0;
                    string act = args.ContainsKey("action") ? args["action"].ToLower() : "invoke";

                    var elements = GetInteractiveElements(hwnd);
                    if (elementIndex >= 0 && elementIndex < elements.Count) {
                        AutomationElement el = elements[elementIndex];
                        bool executed = false;

                        if (act == "invoke" || act == "click") {
                            object patternObj;
                            if (el.TryGetCurrentPattern(InvokePattern.Pattern, out patternObj)) {
                                ((InvokePattern)patternObj).Invoke();
                                executed = true;
                            } else if (el.TryGetCurrentPattern(TogglePattern.Pattern, out patternObj)) {
                                ((TogglePattern)patternObj).Toggle();
                                executed = true;
                            } else if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out patternObj)) {
                                ((SelectionItemPattern)patternObj).Select();
                                executed = true;
                            }
                        } else if (act == "toggle") {
                            object patternObj;
                            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out patternObj)) {
                                ((TogglePattern)patternObj).Toggle();
                                executed = true;
                            }
                        } else if (act == "select") {
                            object patternObj;
                            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out patternObj)) {
                                ((SelectionItemPattern)patternObj).Select();
                                executed = true;
                            }
                        } else if (act == "expand" || act == "collapse") {
                            object patternObj;
                            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out patternObj)) {
                                if (act == "expand") ((ExpandCollapsePattern)patternObj).Expand();
                                else ((ExpandCollapsePattern)patternObj).Collapse();
                                executed = true;
                            }
                        }

                        var r = el.Current.BoundingRectangle;
                        int cx = (int)(r.Left + r.Width / 2);
                        int cy = (int)(r.Top + r.Height / 2);
                        if (!executed && !r.IsEmpty && r.Width > 0 && r.Height > 0) {
                            NotifyOverlayPoint(cx, cy, "Clicking element " + elementIndex);
                            SetCursorPos(cx, cy);
                            Cursor.Position = new Point(cx, cy);
                            Thread.Sleep(30);
                            SendMouseClick(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
                            executed = true;
                        }

                        return string.Format("{{\"status\":\"success\",\"action\":\"perform_accessibility_action\",\"element_index\":{0},\"executed\":{1},\"target\":[{2},{3}]}}",
                            elementIndex, executed ? "true" : "false", cx, cy);
                    }

                    return string.Format("{{\"status\":\"error\",\"message\":\"Element index {0} out of range (found {1})\"}}", elementIndex, elements.Count);
                }

                case "set_value": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    } else {
                        hwnd = GetForegroundWindow();
                    }

                    string val = args.ContainsKey("value") ? args["value"] : "";
                    int elementIndex = args.ContainsKey("element_index") ? int.Parse(args["element_index"]) : -1;

                    bool assigned = false;
                    if (elementIndex >= 0) {
                        var elements = GetInteractiveElements(hwnd);
                        if (elementIndex < elements.Count) {
                            AutomationElement el = elements[elementIndex];
                            object patternObj;
                            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out patternObj)) {
                                try {
                                    ((ValuePattern)patternObj).SetValue(val);
                                    assigned = true;
                                } catch {}
                            }
                            if (!assigned) {
                                var r = el.Current.BoundingRectangle;
                                if (!r.IsEmpty && r.Width > 0) {
                                    int cx = (int)(r.Left + r.Width / 2);
                                    int cy = (int)(r.Top + r.Height / 2);
                                    NotifyOverlayPoint(cx, cy, "Typing into element " + elementIndex);
                                    SetCursorPos(cx, cy);
                                    Cursor.Position = new Point(cx, cy);
                                    Thread.Sleep(30);
                                    SendMouseClick(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
                                    Thread.Sleep(60);
                                    SendKeyDown(0x11); // Ctrl
                                    SendKeyDown(0x41); // A
                                    SendKeyUp(0x41);
                                    SendKeyUp(0x11);
                                    Thread.Sleep(30);
                                    SendKeyDown(0x08); // Backspace
                                    SendKeyUp(0x08);
                                    Thread.Sleep(30);
                                    SendUnicodeText(val);
                                    assigned = true;
                                }
                            }
                        }
                    }

                    if (!assigned) {
                        SendUnicodeText(val);
                    }

                    return string.Format("{{\"status\":\"success\",\"action\":\"set_value\",\"length\":{0}}}", val.Length);
                }

                case "get_app_state":
                case "screenshot": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    }

                    Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                    if (hwnd != IntPtr.Zero) {
                        try { screenBounds = Screen.FromHandle(hwnd).Bounds; } catch {}
                    }
                    Rectangle rect = screenBounds;
                    string windowTitle = "Desktop";

                    if (hwnd != IntPtr.Zero) {
                        try {
                            RECT r;
                            GetWindowRect(hwnd, out r);
                            int rx = Math.Max(screenBounds.Left, r.Left);
                            int ry = Math.Max(screenBounds.Top, r.Top);
                            int rw = Math.Min(screenBounds.Right - rx, Math.Max(100, r.Right - rx));
                            int rh = Math.Min(screenBounds.Bottom - ry, Math.Max(100, r.Bottom - ry));
                            if (rw > 100 && rh > 100) {
                                rect = new Rectangle(rx, ry, rw, rh);
                            }
                            int len = GetWindowTextLength(hwnd);
                            if (len > 0) {
                                StringBuilder sb = new StringBuilder(len + 1);
                                GetWindowText(hwnd, sb, sb.Capacity);
                                windowTitle = sb.ToString();
                            }
                        } catch {}
                    }

                    string base64Png = "";
                    try {
                        using (Bitmap bmp = new Bitmap(rect.Width, rect.Height)) {
                            using (Graphics g = Graphics.FromImage(bmp)) {
                                g.CopyFromScreen(rect.Left, rect.Top, 0, 0, rect.Size, CopyPixelOperation.SourceCopy);
                            }
                            using (MemoryStream ms = new MemoryStream()) {
                                bmp.Save(ms, ImageFormat.Png);
                                base64Png = Convert.ToBase64String(ms.ToArray());
                            }
                        }
                    } catch {
                        try {
                            using (Bitmap bmp = new Bitmap(screenBounds.Width, screenBounds.Height)) {
                                using (Graphics g = Graphics.FromImage(bmp)) {
                                    g.CopyFromScreen(screenBounds.Left, screenBounds.Top, 0, 0, bmp.Size, CopyPixelOperation.SourceCopy);
                                }
                                using (MemoryStream ms = new MemoryStream()) {
                                    bmp.Save(ms, ImageFormat.Png);
                                    base64Png = Convert.ToBase64String(ms.ToArray());
                                }
                            }
                        } catch {}
                    }

                    StringBuilder axBuilder = new StringBuilder();
                    axBuilder.AppendFormat("[Window: \\\"{0}\\\"] [Bounds: [{1},{2},{3},{4}]]",
                        JsonEscape(windowTitle), rect.Left, rect.Top, rect.Width, rect.Height);

                    if (hwnd != IntPtr.Zero) {
                        try {
                            var elements = GetInteractiveElements(hwnd);
                            for (int i = 0; i < elements.Count; i++) {
                                var el = elements[i];
                                try {
                                    var cur = el.Current;
                                    var elRect = cur.BoundingRectangle;
                                    string cType = cur.ControlType != null ? cur.ControlType.ProgrammaticName.Replace("ControlType.", "") : "Control";
                                    string name = cur.Name ?? "";
                                    axBuilder.AppendFormat("\\n  [Index {0}] [{1}: \\\"{2}\\\"] [Bounds: [{3},{4},{5},{6}]]",
                                        i, cType, JsonEscape(name), (int)elRect.Left, (int)elRect.Top, (int)elRect.Width, (int)elRect.Height);
                                } catch {}
                            }
                        } catch {}
                    }
                    string axTree = axBuilder.ToString();

                    return string.Format(
                        "{{\"status\":\"success\",\"platform\":\"win32\",\"app\":\"{0}\",\"screenshots\":[{{\"url\":\"data:image/png;base64,{1}\"}}],\"accessibility\":{{\"tree\":\"{2}\"}}}}",
                        JsonEscape(windowTitle), base64Png, axTree);
                }

                default:
                    return string.Format("{{\"error\":\"unknown_action\",\"action\":\"{0}\"}}", JsonEscape(action));
            }
        }

        [STAThread]
        public static void Main(string[] args) {
            AttachToInteractiveDesktop();
            // If command line arguments provided: run single action
            if (args.Length > 0) {
                string action = args[0].TrimStart('-');
                Dictionary<string, string> parsedArgs = new Dictionary<string, string>();
                for (int i = 1; i < args.Length; i++) {
                    string arg = args[i];
                    if (arg.StartsWith("--") && i + 1 < args.Length) {
                        string key = arg.Substring(2);
                        string val = args[++i];
                        parsedArgs[key] = val;
                    } else if (!arg.StartsWith("--")) {
                        if (action == "press_key" && !parsedArgs.ContainsKey("key")) parsedArgs["key"] = arg;
                        else if ((action == "type" || action == "type_text") && !parsedArgs.ContainsKey("text")) parsedArgs["text"] = arg;
                    }
                }

                string res = Dispatch(action, parsedArgs);
                Console.WriteLine(res);
                return;
            }

            // Interactive JSON-RPC stdio loop
            Thread worker = new Thread(() => {
                AttachToInteractiveDesktop();
                string line;
                while ((line = Console.ReadLine()) != null) {
                    string trimmed = line.Trim();
                    if (string.IsNullOrEmpty(trimmed)) continue;
                    try {
                        // Parse command e.g. ACTION param1=val1 param2=val2 ...
                        // Or JSON: {"action":"click", ...}
                        string action = "";
                        Dictionary<string, string> actionArgs = new Dictionary<string, string>();

                        if (trimmed.StartsWith("{")) {
                            // Extract action and string properties with simple regex/parser
                            var mAction = System.Text.RegularExpressions.Regex.Match(trimmed, "\"action\"\\s*:\\s*\"([^\"]+)\"");
                            if (mAction.Success) action = mAction.Groups[1].Value;

                            var matches = System.Text.RegularExpressions.Regex.Matches(trimmed, "\"([a-zA-Z0-9_]+)\"\\s*:\\s*(\"[^\"]*\"|[0-9]+|true|false|\\[[^\\]]*\\])");
                            foreach (System.Text.RegularExpressions.Match m in matches) {
                                string k = m.Groups[1].Value;
                                string v = m.Groups[2].Value.Trim('\"');
                                if (k != "action") actionArgs[k] = v;
                            }
                        } else {
                            string[] parts = trimmed.Split(new char[] { ' ' }, 2);
                            action = parts[0];
                            if (parts.Length > 1) {
                                string[] pairs = parts[1].Split(' ');
                                foreach (var p in pairs) {
                                    int eq = p.IndexOf('=');
                                    if (eq > 0) {
                                        actionArgs[p.Substring(0, eq)] = p.Substring(eq + 1);
                                    }
                                }
                            }
                        }

                        string result = Dispatch(action, actionArgs);
                        Console.WriteLine(result);
                    } catch (Exception ex) {
                        Console.WriteLine("{\"error\":\"" + JsonEscape(ex.Message) + "\"}");
                    }
                }
            });

            worker.Start();
            worker.Join();
        }
    }
}
