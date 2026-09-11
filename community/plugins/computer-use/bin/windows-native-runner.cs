using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
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
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

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

        public static void SendKeyDown(ushort vk) {
            INPUT input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki.wVk = vk;
            input.u.ki.dwFlags = 0;
            input.u.ki.dwExtraInfo = (UIntPtr)0x12345;
            SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void SendKeyUp(ushort vk) {
            INPUT input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki.wVk = vk;
            input.u.ki.dwFlags = KEYEVENTF_KEYUP;
            input.u.ki.dwExtraInfo = (UIntPtr)0x12345;
            SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
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
                ShowWindow(matchedHwnd, 3); // SW_MAXIMIZE (keeps app maximized full-screen, never shrinks or minimizes)
                SetForegroundWindow(matchedHwnd);
                SwitchToThisWindow(matchedHwnd, true);
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
                    if (!string.IsNullOrEmpty(app)) FocusAppWindow(app);

                    int x = args.ContainsKey("x") ? int.Parse(args["x"]) : Cursor.Position.X;
                    int y = args.ContainsKey("y") ? int.Parse(args["y"]) : Cursor.Position.Y;
                    string button = args.ContainsKey("button") ? args["button"].ToLower() : "left";
                    int count = args.ContainsKey("count") ? int.Parse(args["count"]) : 1;

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
                    if (!string.IsNullOrEmpty(app)) FocusAppWindow(app);

                    int fx = args.ContainsKey("from_x") ? int.Parse(args["from_x"]) : Cursor.Position.X;
                    int fy = args.ContainsKey("from_y") ? int.Parse(args["from_y"]) : Cursor.Position.Y;
                    int tx = args.ContainsKey("to_x") ? int.Parse(args["to_x"]) : fx;
                    int ty = args.ContainsKey("to_y") ? int.Parse(args["to_y"]) : fy;

                    SetCursorPos(fx, fy);
                    Cursor.Position = new Point(fx, fy);
                    Thread.Sleep(40);
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(40);

                    // Interpolate
                    int steps = 15;
                    for (int i = 1; i <= steps; i++) {
                        int cx = fx + (tx - fx) * i / steps;
                        int cy = fy + (ty - fy) * i / steps;
                        SetCursorPos(cx, cy);
                        Cursor.Position = new Point(cx, cy);
                        Thread.Sleep(10);
                    }

                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    return string.Format("{{\"status\":\"success\",\"action\":\"drag\",\"from\":[{0},{1}],\"to\":[{2},{3}]}}", fx, fy, tx, ty);
                }

                case "scroll": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    if (!string.IsNullOrEmpty(app)) FocusAppWindow(app);

                    int x = args.ContainsKey("x") ? int.Parse(args["x"]) : Cursor.Position.X;
                    int y = args.ContainsKey("y") ? int.Parse(args["y"]) : Cursor.Position.Y;
                    string dir = args.ContainsKey("direction") ? args["direction"].ToLower() : "down";
                    int pages = args.ContainsKey("pages") ? int.Parse(args["pages"]) : 1;

                    SetCursorPos(x, y);
                    Cursor.Position = new Point(x, y);
                    Thread.Sleep(30);

                    int delta = (dir == "up" ? 120 : -120) * pages;
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);

                    return string.Format("{{\"status\":\"success\",\"action\":\"scroll\",\"direction\":\"{0}\",\"pages\":{1}}}", dir, pages);
                }

                case "type":
                case "type_text": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    if (!string.IsNullOrEmpty(app)) FocusAppWindow(app);

                    if (args.ContainsKey("x") && args.ContainsKey("y")) {
                        int x = int.Parse(args["x"]);
                        int y = int.Parse(args["y"]);
                        SetCursorPos(x, y);
                        Cursor.Position = new Point(x, y);
                        Thread.Sleep(30);
                        SendMouseClick(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
                        Thread.Sleep(80);
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

                case "get_app_state":
                case "screenshot": {
                    string app = args.ContainsKey("app") ? args["app"] : "";
                    IntPtr hwnd = IntPtr.Zero;
                    if (!string.IsNullOrEmpty(app)) {
                        hwnd = FocusAppWindow(app);
                    }

                    Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                    Rectangle rect = screenBounds;
                    string windowTitle = "Desktop";

                    if (hwnd != IntPtr.Zero) {
                        try {
                            RECT r;
                            GetWindowRect(hwnd, out r);
                            int rx = Math.Max(0, r.Left);
                            int ry = Math.Max(0, r.Top);
                            int rw = Math.Min(screenBounds.Width - rx, Math.Max(100, r.Right - rx));
                            int rh = Math.Min(screenBounds.Height - ry, Math.Max(100, r.Bottom - ry));
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
                                    g.CopyFromScreen(0, 0, 0, 0, bmp.Size, CopyPixelOperation.SourceCopy);
                                }
                                using (MemoryStream ms = new MemoryStream()) {
                                    bmp.Save(ms, ImageFormat.Png);
                                    base64Png = Convert.ToBase64String(ms.ToArray());
                                }
                            }
                        } catch {}
                    }

                    string axTree = string.Format("[Window: \\\"{0}\\\"] [Bounds: [{1},{2},{3},{4}]]",
                        JsonEscape(windowTitle), rect.Left, rect.Top, rect.Width, rect.Height);

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
