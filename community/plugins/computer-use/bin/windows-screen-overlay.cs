using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace ComputerUseOverlay {
    public class Spring {
        public double value;
        public double target;
        public double velocity = 0;
        public double dampingFraction = 0.85;
        public double response = 0.2;

        public Spring(double initialValue, double targetValue, double damping, double resp) {
            value = initialValue;
            target = targetValue;
            dampingFraction = damping;
            response = resp;
            velocity = 0;
        }

        public void Reset(double val) {
            value = val;
            target = val;
            velocity = 0;
        }

        public bool Step(double dt) {
            if (response <= 0) {
                value = target;
                velocity = 0;
                return false;
            }

            double omega = (2.0 * Math.PI) / response;
            double zeta = dampingFraction;
            double f = 1.0 + 2.0 * dt * zeta * omega;
            double oo = omega * omega;
            double hoo = dt * oo;
            double hhoo = dt * hoo;
            double detInv = 1.0 / (f + hhoo);
            double detX = f * value + dt * velocity + hhoo * target;
            double detV = velocity + hoo * (target - value);

            value = detX * detInv;
            velocity = detV * detInv;

            bool isSettled = Math.Abs(velocity) < 0.001 && Math.Abs(value - target) < 0.001;
            if (isSettled) {
                value = target;
                velocity = 0;
            }
            return !isSettled;
        }
    }

    public struct PointD {
        public double X;
        public double Y;
        public PointD(double x, double y) { X = x; Y = y; }
    }

    public class BezierPath {
        public PointD Start;
        public PointD Ctrl;
        public PointD End;
        public double Dist;

        public PointD Evaluate(double t) {
            double u = 1.0 - t;
            double tt = t * t;
            double uu = u * u;
            return new PointD(
                uu * Start.X + 2.0 * u * t * Ctrl.X + tt * End.X,
                uu * Start.Y + 2.0 * u * t * Ctrl.Y + tt * End.Y
            );
        }
    }

    public class OverlayWindow : Window {
        private const int WM_NCHITTEST = 0x0084;
        private const int HTTRANSPARENT = -1;
        private const int HTCLIENT = 1;

        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int GWL_EXSTYLE = -20;

        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;

        private const int SW_SHOW = 5;

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hwnd, int index);

        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessWindowStation(IntPtr hWinSta);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetThreadDesktop(IntPtr hDesktop);

        public static void AttachToInteractiveDesktop() {
            try {
                IntPtr hwinsta = OpenWindowStation("WinSta0", false, 0x037F);
                if (hwinsta != IntPtr.Zero) {
                    SetProcessWindowStation(hwinsta);
                    IntPtr hdesk = OpenDesktop("Default", 0, false, 0x01FF);
                    if (hdesk != IntPtr.Zero) {
                        SetThreadDesktop(hdesk);
                    }
                }
            } catch {}
        }

        // Low-level Windows Hooks for physical user input suppression
        private const int WH_KEYBOARD_LL = 13;
        private const int WH_MOUSE_LL = 14;

        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        private const int WM_MOUSEMOVE = 0x0200;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_LBUTTONUP = 0x0202;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_RBUTTONUP = 0x0205;
        private const int WM_MBUTTONDOWN = 0x0207;
        private const int WM_MBUTTONUP = 0x0208;
        private const int WM_MOUSEWHEEL = 0x020A;
        private const int WM_NCLBUTTONDOWN = 0x00A1;
        private const int WM_NCLBUTTONUP = 0x00A2;

        private const uint LLKHF_EXTENDED = 0x00000001;
        private const uint LLKHF_LOWER_IL_INJECTED = 0x00000002;
        private const uint LLKHF_INJECTED = 0x00000010;
        private const uint LLMHF_INJECTED = 0x00000001;
        private const uint LLMHF_LOWER_IL_INJECTED = 0x00000002;

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        private static IntPtr _kbdHook = IntPtr.Zero;
        private static IntPtr _mouseHook = IntPtr.Zero;
        private static HookProc _kbdHookProc;
        private static HookProc _mouseHookProc;
        private static bool _inputBlockingEnabled = false;

        private static int _pillLeft = 0;
        private static int _pillRight = 0;
        private static int _pillTop = 0;
        private static int _pillBottom = 0;

        private static int _stopLeft = 0;
        private static int _stopRight = 0;
        private static int _stopTop = 0;
        private static int _stopBottom = 0;

        private static OverlayWindow _currentInstance = null;

        // UI Visual Elements
        private Canvas mainCanvas;
        private Canvas borderContainer;
        private Border interruptPill;
        private Button stopBtn;
        private TextBlock statusText;
        private LinearGradientBrush shimmerTextBrush;
        private GradientStop shimmerStop1;
        private GradientStop shimmerStop2;
        private GradientStop shimmerStop3;
        private FrameworkElement cursorContainer;
        private Image cursorImage;

        // 7-Spring Euler Integrator (Exact OpenAI Codex Configuration)
        private Spring positionXSpring;
        private Spring positionYSpring;
        private Spring rotationSpring;
        private Spring scootAxisSpring;
        private Spring scootStretchSpring;
        private Spring stretchSpring;
        private Spring visibilitySpring;
        private Spring progressSpring;

        private PointD currentPoint = new PointD(100, 100);
        private PointD targetPoint = new PointD(100, 100);
        private BezierPath currentBezier = null;
        private bool isBezier = false;
        private DateTime? thinkStartedAt = null;
        private DateTime lastTickTime = DateTime.UtcNow;

        private DispatcherTimer animTimer;
        private DispatcherTimer idleFadeTimer;
        private TcpListener listener;
        private Thread listenerThread;
        private IntPtr hwnd = IntPtr.Zero;

        private double screenWidth = 1920;
        private double screenHeight = 1080;

        // Official OpenAI Codex Agent Cursor Base64 PNG (46x48 @2x, 23x24 @1x)
        private const string CURSOR_BASE64 = 
            "iVBORw0KGgoAAAANSUhEUgAAAC4AAAAwCAYAAABuZUjcAAAG+klEQVR4Ae1ZW2xUVRS982qnj+lzSh9UrLWosVFq+TAk" +
            "Rmpi0URJSBogqRggavyF1Cj6Q0P94A+iURJDQrH6Q2OxIF/EEE0a0hqBEBKRQihSIYHQxwzTTtuZua51e/Z4GeZxh85M" +
            "P2AnJ/d1HuvsvfY++5yraU/kiTzeYtN1PVq6u7vtvPK9fNOWSZzxXhIQhFfjecuWLfa7d+/a+vr6GvB+bPPmzXpzc7O+" +
            "WHWxLu+15RTRLG7tbW1tzps3b64OhUKDeD+pK8Hzb4FA4MNr166tZh2pLxaRCedaqD4Ccfl8vo/MgOOJTOLcuXNVaCOTi" +
            "FIpJ3RSgxigL168+EIq0DEyOT8///29e/fa165d6wKdHCwm8FKyAtpG0zc0NLjn5uZ+EETXr1/X8d7gNL7pu3btMt4lk" +
            "kgkMsZJTE1NvclJoJ2DljA5d2aBs2M4XZ7X6/Vg8CkBsmnTJgN0bGlpadF7e3tTTgJK6IE/PIc2hiW0RatmzAI21an75" +
            "MmTa8yDxwMdW2gRTmJyMjG7Yp1aJhFDpfQmw8bsDLdFe/bsaTIPSHpYAS9lx44d+vHjx/VkIpMYGhpagTbGJOJQKfUkVA" +
            "NXdXV1Ea7V6PSsDIIO0wIuhRPmJM6cOZNsDpOgUp84tab8wWQFTU/mF6JxAi8uLl5x9erVfdIzB34U4LGTSNepJSppyTS" +
            "vKjjq6+sLcPVu27btAZ5LVMlEserUpJKyQuJoxA+cYVNTUz4eywsKCp7CAjS8VLqkKqmcemZm5hNGOpP2HwIe5XlFRUV" +
            "JYWFh3YULFz6LEhEdZwO4ZsGpYZlXCV5bDKPxtU6e19XVFYLnVZ2dnS3hcHg6G3TRUviDmUagzLeKwk7ReuwMCC4CbYed" +
            "TucCZj8Bb/9VPmIh0nIhY2Nj2s6dO6PPbrf7nWAw6ATfJRONKzblEJ6ioqIaLEbvmelSVlaWM62LIOb/g3flTEVUEvcw" +
            "Z8j1xsbGCG7DmF0YTnEWHu7jN4DWEBG0XAgsH70HXX0ej8cBSyQPixJdALSM0eXWrVu9MvtMxPRUhb5k5jjo2g/gXvo" +
            "evjsSAtcWA76zqqqqGNfqU6dOdWaTLuyPYA8cOPBQbGdw2L9//2uoV4niVsATat7QOj25pKSkAs7xDJblcemMK+BSwcpK" +
            "SgsmS8xGRkY+p9VpfXI8ocZFlBPkl5eXl6JhPfj11VLpkkir8QTL/h+HDh3qyM/Pf5ZWR/GooGFLCVxli8XMXXp6etrMH" +
            "adLlyNHjiQFisjhu3Hjxi9QSveGDRteR5tmgobSVoq2VRqcHLiunJQNFF0apqenR2SgdFIAajqeTExM/Hnp0qXvjh49+r" +
            "HL5WpF3ZdRXkRpwnhP41pD0HRKpcQoaHsi4Az0PIKorKwMOxwOhsYFRJfT8n39+vWaVdm+fXv03u/3j0Kr+9rb299Aav" +
            "FBa2vr1/j+u91u9wGsH1WmsX748/Ly/NiJBUCZYG1t7QIXRkuD6WqTK5sL0oUpgFljVlMAM6cHBwe7AOol0OB5xd9Vz" +
            "IvYP0JeJX2K0YyBQVJbLU52mEzjHJQLQQR0odYXBgYGJqGxEaljXiQSCdoaReTw4cND0G4A5T4ila+0tNQPTd+HlgOwbg" +
            "ARJghLB9etWze/cePG8LFjx6jpiOCxJPr/xxXGBhrXuvPnz38q2rOSMTLjE6GPKC3XULPctHCho2Zj96D6Uk8DVAekSy" +
            "FXr46OjlfSyRjN27bLly9/iXcroWUj7xCw+oNnL5kR0ToH4oAIT6vu3LkzIGAOHjyYFLhZED3eZbqs9rVGTNazeVzHmE" +
            "5zki5wpFqrGaM5DHLlZUgVbVuKyRmQ6AaDng8AjVboYl50YKWfuJjgfQmKsZtZCo/tFuvpCFE6NxiIKiEk9Qu3b9/+WT" +
            "7u3bs3biNz1Lly5crp2dnZEG7DmqJQWpHiUUTx0NA6Yyw3GOaMkRJ7aMSdvFm2bt26Bu+9sgXTckATAW84qRqYdGnADv" +
            "wvAcZFhmeMcghkXnR4WiAZnjpFsGrpjADnxa5228wYV544ceJ93YLAudtgpWpay1KGlwXw0RQApYpOOjo6+k0iwMz4ho" +
            "eHv2DCxEQNbWitnESTWDFOu6h1mh33dVgJV+/evfttOOsgHPdvgoXz/guq/NjV1fUW6jSh1KB4SBPZ7GYCSNptoHUHok" +
            "QessV8RJoChMZCKDgP535OpKc2FS1CeJ7DdRZznEEJgv8hrKThTEQTp5a+GGcv0O4CH+Cg3K2EwXkXKMH+qFEdWmfomw" +
            "PgeayWc9hBhWCFcNZDYAqxmXZIbjodkybFYy+vkp5qixtcmVDGuP3IHcmqBw0avwrBXzv4bWMZHx+XJT/Mhau/v5/P1j" +
            "YCuRLd9NcZjw7572n657lsf5/TlZyA/Q9N3TljZhaAsAAAAABJRU5ErkJggg==";

        public OverlayWindow() {
            AttachToInteractiveDesktop();
            _currentInstance = this;
            SetProcessDPIAware();

            screenWidth = SystemParameters.PrimaryScreenWidth;
            screenHeight = SystemParameters.PrimaryScreenHeight;

            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ShowInTaskbar = false;
            Left = 0;
            Top = 0;
            Width = screenWidth;
            Height = screenHeight;

            mainCanvas = new Canvas {
                Width = screenWidth,
                Height = screenHeight,
                Background = Brushes.Transparent
            };
            Content = mainCanvas;

            double initDpi = 1.0;
            try {
                using (System.Drawing.Graphics g = System.Drawing.Graphics.FromHwnd(IntPtr.Zero)) {
                    initDpi = g.DpiX / 96.0;
                }
            } catch {}
            if (initDpi <= 0) initDpi = 1.0;

            POINT startPt;
            if (GetCursorPos(out startPt)) {
                double sx = startPt.x / initDpi;
                double sy = startPt.y / initDpi;
                currentPoint = new PointD(sx, sy);
                targetPoint = new PointD(sx, sy);
                positionXSpring = new Spring(sx, sx, 0.90, 0.19);
                positionYSpring = new Spring(sy, sy, 0.90, 0.19);
            } else {
                currentPoint = new PointD(100, 100);
                targetPoint = new PointD(100, 100);
                positionXSpring = new Spring(100, 100, 0.90, 0.19);
                positionYSpring = new Spring(100, 100, 0.90, 0.19);
            }
            // In OpenAI Codex: base style has rotate(44deg), rotationSpring starts at -44deg (net 0deg at rest)
            rotationSpring = new Spring(-44.0, -44.0, 0.90, 0.12);
            scootAxisSpring = new Spring(0, 0, 0.82, 0.055);
            scootStretchSpring = new Spring(1, 1, 0.86, 0.12);
            stretchSpring = new Spring(1, 1, 0.85, 0.20);
            visibilitySpring = new Spring(1, 1, 0.86, 0.42);

            BuildUI();

            animTimer = new DispatcherTimer(DispatcherPriority.Render);
            animTimer.Interval = TimeSpan.FromMilliseconds(16);
            animTimer.Tick += OnAnimationTick;
            animTimer.Start();

            idleFadeTimer = new DispatcherTimer();
            idleFadeTimer.Interval = TimeSpan.FromMinutes(10);
            idleFadeTimer.Tick += (s, e) => {
                idleFadeTimer.Stop();
                FadeOut();
            };

            SourceInitialized += (s, e) => {
                hwnd = new WindowInteropHelper(this).Handle;
                int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
                SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
                HwndSource source = HwndSource.FromHwnd(hwnd);
                if (source != null) {
                    source.AddHook(WndProc);
                }
                UpdateCachedPillBounds();
            };

            Loaded += (s, e) => {
                UpdateCachedPillBounds();
                InstallHooks();
                ShowActive("Antigravity is controlling...");
            };

            Closed += (s, e) => {
                UninstallHooks();
                try {
                    if (listener != null) listener.Stop();
                } catch {}
            };

            StartTcpListener();
        }

        private static void InstallHooks() {
            if (_kbdHookProc == null) _kbdHookProc = LowLevelKeyboardProc;
            if (_mouseHookProc == null) _mouseHookProc = LowLevelMouseProc;

            try {
                IntPtr hMod = GetModuleHandle(null);
                if (_kbdHook == IntPtr.Zero) {
                    _kbdHook = SetWindowsHookEx(WH_KEYBOARD_LL, _kbdHookProc, hMod, 0);
                }
                if (_mouseHook == IntPtr.Zero) {
                    _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseHookProc, hMod, 0);
                }
            } catch {}
        }

        private static void UninstallHooks() {
            _inputBlockingEnabled = false;
            if (_kbdHook != IntPtr.Zero) {
                UnhookWindowsHookEx(_kbdHook);
                _kbdHook = IntPtr.Zero;
            }
            if (_mouseHook != IntPtr.Zero) {
                UnhookWindowsHookEx(_mouseHook);
                _mouseHook = IntPtr.Zero;
            }
        }

        public void EnableInputBlock() {
            _inputBlockingEnabled = true;
        }

        public void DisableInputBlock() {
            _inputBlockingEnabled = false;
        }

        private static IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam) {
            try {
                if (nCode >= 0 && _inputBlockingEnabled) {
                    KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));

                    // Allow synthetic automation keystrokes through
                    if ((kbd.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0 || kbd.dwExtraInfo == (IntPtr)0x12345) {
                        return CallNextHookEx(_kbdHook, nCode, wParam, lParam);
                    }

                    // Physical user Esc key interrupts agent control
                    if (kbd.vkCode == 0x1B) {
                        int wMsg = wParam.ToInt32();
                        if (wMsg == WM_KEYDOWN || wMsg == WM_SYSKEYDOWN) {
                            if (_currentInstance != null) {
                                _currentInstance.Dispatcher.BeginInvoke(new Action(() => _currentInstance.TriggerInterrupt()));
                            }
                        }
                        return (IntPtr)1;
                    }

                    // Suppress physical user keys so typing does not unfocus the browser or cancel animation
                    return (IntPtr)1;
                }
            } catch {}
            return CallNextHookEx(_kbdHook, nCode, wParam, lParam);
        }

        private static IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam) {
            try {
                if (nCode >= 0 && _inputBlockingEnabled) {
                    MSLLHOOKSTRUCT ms = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));

                    // Allow synthetic agent mouse actions through
                    if ((ms.flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0 || ms.dwExtraInfo == (IntPtr)0x12345) {
                        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
                    }

                    int wMsg = wParam.ToInt32();

                    // Allow physical mouse move so user can target the Stop button
                    if (wMsg == WM_MOUSEMOVE) {
                        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
                    }

                    // Physical click over the Stop button immediately triggers interrupt!
                    if (wMsg == WM_LBUTTONDOWN || wMsg == WM_NCLBUTTONDOWN) {
                        if (IsScreenPointOverStop(ms.pt.x, ms.pt.y)) {
                            if (_currentInstance != null) {
                                _currentInstance.Dispatcher.BeginInvoke(new Action(() => _currentInstance.TriggerInterrupt()));
                            }
                            return (IntPtr)1; // Consume click so it doesn't click whatever is behind the stop button
                        }
                        // Suppress physical click elsewhere to prevent unfocusing the automated app
                        return (IntPtr)1;
                    }
                    if (wMsg == WM_LBUTTONUP || wMsg == WM_NCLBUTTONUP) {
                        if (IsScreenPointOverStop(ms.pt.x, ms.pt.y)) {
                            return (IntPtr)1;
                        }
                        return (IntPtr)1;
                    }

                    // Suppress physical mouse scroll and other buttons
                    if (wMsg == WM_MOUSEWHEEL || wMsg == WM_RBUTTONDOWN || wMsg == WM_RBUTTONUP || wMsg == WM_MBUTTONDOWN || wMsg == WM_MBUTTONUP) {
                        return (IntPtr)1;
                    }
                }
            } catch {}
            return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
        }

        public static bool IsScreenPointOverStop(int x, int y) {
            // 1. Check exact measured Stop button bounds with 8px click padding
            if (_stopRight > _stopLeft && x >= (_stopLeft - 8) && x <= (_stopRight + 8) && y >= (_stopTop - 8) && y <= (_stopBottom + 8)) {
                return true;
            }

            // 2. Fallback calculated bounds around Stop button only (right side of center pill)
            int screenW = 1920;
            try { screenW = GetSystemMetrics(0); } catch {}
            if (screenW <= 0) screenW = 1920;
            int stopMinX = (screenW / 2) + 70;
            int stopMaxX = (screenW / 2) + 200;
            if (x >= stopMinX && x <= stopMaxX && y >= 14 && y <= 70) {
                return true;
            }

            return false;
        }

        private void UpdateCachedPillBounds() {
            try {
                if (interruptPill != null && interruptPill.ActualWidth > 0) {
                    Point pTopLeft = interruptPill.PointToScreen(new Point(0, 0));
                    Point pBottomRight = interruptPill.PointToScreen(new Point(interruptPill.ActualWidth, interruptPill.ActualHeight));
                    _pillLeft = (int)pTopLeft.X - 10;
                    _pillTop = (int)pTopLeft.Y - 10;
                    _pillRight = (int)pBottomRight.X + 10;
                    _pillBottom = (int)pBottomRight.Y + 10;
                }

                if (stopBtn != null && stopBtn.ActualWidth > 0) {
                    Point sTopLeft = stopBtn.PointToScreen(new Point(0, 0));
                    Point sBottomRight = stopBtn.PointToScreen(new Point(stopBtn.ActualWidth, stopBtn.ActualHeight));
                    _stopLeft = (int)sTopLeft.X - 8;
                    _stopTop = (int)sTopLeft.Y - 8;
                    _stopRight = (int)sBottomRight.X + 8;
                    _stopBottom = (int)sBottomRight.Y + 8;
                }
            } catch {}
        }

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) {
            if (msg == WM_NCHITTEST) {
                int x = unchecked((short)(long)lParam);
                int y = unchecked((short)((long)lParam >> 16));

                if (IsScreenPointOverStop(x, y)) {
                    handled = true;
                    return new IntPtr(HTCLIENT);
                }

                handled = true;
                return new IntPtr(HTTRANSPARENT);
            }

            return IntPtr.Zero;
        }

        private void BuildUI() {
            // 1. Authentic OpenAI Codex Edge Gradient Halo & Perimeter Breathing Stroke
            BuildScreenBorder();

            // 2. Authentic Codex Glassmorphic Interrupt Pill with Cadenced Shimmer
            BuildInterruptPill();

            // 3. Official OpenAI Codex Agent Cursor (Euler physics + glow)
            BuildAgentCursor();
        }

        private void BuildScreenBorder() {
            borderContainer = new Canvas {
                Width = screenWidth,
                Height = screenHeight,
                IsHitTestVisible = false
            };

            double edgeDepth = 36.0;

            // Top Edge Gradient Visual
            Rectangle topEdge = new Rectangle {
                Width = screenWidth,
                Height = edgeDepth,
                Fill = new LinearGradientBrush {
                    StartPoint = new Point(0.5, 0),
                    EndPoint = new Point(0.5, 1),
                    GradientStops = new GradientStopCollection {
                        new GradientStop(Color.FromArgb(200, 1, 105, 204), 0.0),    // #0169CC official Codex stop
                        new GradientStop(Color.FromArgb(140, 56, 189, 248), 0.25),  // #38BDF8 cyan
                        new GradientStop(Color.FromArgb(50, 0, 122, 255), 0.65),    // #007AFF
                        new GradientStop(Color.FromArgb(0, 1, 105, 204), 1.0)       // transparent
                    }
                }
            };
            Canvas.SetLeft(topEdge, 0);
            Canvas.SetTop(topEdge, 0);
            borderContainer.Children.Add(topEdge);

            // Bottom Edge Gradient Visual
            Rectangle bottomEdge = new Rectangle {
                Width = screenWidth,
                Height = edgeDepth,
                Fill = new LinearGradientBrush {
                    StartPoint = new Point(0.5, 1),
                    EndPoint = new Point(0.5, 0),
                    GradientStops = new GradientStopCollection {
                        new GradientStop(Color.FromArgb(200, 1, 105, 204), 0.0),
                        new GradientStop(Color.FromArgb(140, 56, 189, 248), 0.25),
                        new GradientStop(Color.FromArgb(50, 0, 122, 255), 0.65),
                        new GradientStop(Color.FromArgb(0, 1, 105, 204), 1.0)
                    }
                }
            };
            Canvas.SetLeft(bottomEdge, 0);
            Canvas.SetTop(bottomEdge, screenHeight - edgeDepth);
            borderContainer.Children.Add(bottomEdge);

            // Left Edge Gradient Visual
            Rectangle leftEdge = new Rectangle {
                Width = edgeDepth,
                Height = screenHeight,
                Fill = new LinearGradientBrush {
                    StartPoint = new Point(0, 0.5),
                    EndPoint = new Point(1, 0.5),
                    GradientStops = new GradientStopCollection {
                        new GradientStop(Color.FromArgb(200, 1, 105, 204), 0.0),
                        new GradientStop(Color.FromArgb(140, 56, 189, 248), 0.25),
                        new GradientStop(Color.FromArgb(50, 0, 122, 255), 0.65),
                        new GradientStop(Color.FromArgb(0, 1, 105, 204), 1.0)
                    }
                }
            };
            Canvas.SetLeft(leftEdge, 0);
            Canvas.SetTop(leftEdge, 0);
            borderContainer.Children.Add(leftEdge);

            // Right Edge Gradient Visual
            Rectangle rightEdge = new Rectangle {
                Width = edgeDepth,
                Height = screenHeight,
                Fill = new LinearGradientBrush {
                    StartPoint = new Point(1, 0.5),
                    EndPoint = new Point(0, 0.5),
                    GradientStops = new GradientStopCollection {
                        new GradientStop(Color.FromArgb(200, 1, 105, 204), 0.0),
                        new GradientStop(Color.FromArgb(140, 56, 189, 248), 0.25),
                        new GradientStop(Color.FromArgb(50, 0, 122, 255), 0.65),
                        new GradientStop(Color.FromArgb(0, 1, 105, 204), 1.0)
                    }
                }
            };
            Canvas.SetLeft(rightEdge, screenWidth - edgeDepth);
            Canvas.SetTop(rightEdge, 0);
            borderContainer.Children.Add(rightEdge);

            // Crisp inner perimeter hairline stroke with Windows 11 rounded corners
            Rectangle perimeterStroke = new Rectangle {
                Width = Math.Max(100, screenWidth - 10),
                Height = Math.Max(100, screenHeight - 10),
                Stroke = new SolidColorBrush(Color.FromArgb(220, 56, 189, 248)), // #38BDF8
                StrokeThickness = 2.0,
                RadiusX = 14,
                RadiusY = 14,
                Effect = new DropShadowEffect {
                    Color = Color.FromRgb(56, 189, 248),
                    BlurRadius = 14,
                    ShadowDepth = 0,
                    Opacity = 0.85
                }
            };
            Canvas.SetLeft(perimeterStroke, 5);
            Canvas.SetTop(perimeterStroke, 5);
            borderContainer.Children.Add(perimeterStroke);

            // Codex "border opacity pulse" & breathing cadence (3000ms, from 0.76 to 1.0)
            DoubleAnimation pulse = new DoubleAnimation {
                From = 0.76,
                To = 1.0,
                Duration = TimeSpan.FromMilliseconds(3000),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            borderContainer.BeginAnimation(UIElement.OpacityProperty, pulse);

            mainCanvas.Children.Add(borderContainer);
        }

        private void BuildInterruptPill() {
            // Exact Codex _Material_x6nn9_2 dark acrylic styling (48px height, 24px radius)
            interruptPill = new Border {
                Background = new SolidColorBrush(Color.FromArgb(232, 28, 31, 38)), // #1C1F26 deep acrylic
                BorderBrush = new SolidColorBrush(Color.FromArgb(32, 255, 255, 255)), // rgba(255, 255, 255, 0.12)
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(24),
                Height = 48,
                Padding = new Thickness(16, 0, 12, 0),
                Effect = new DropShadowEffect {
                    Color = Colors.Black,
                    BlurRadius = 24,
                    ShadowDepth = 4,
                    Opacity = 0.65
                }
            };

            StackPanel pillStack = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            // Pulsing cyan indicator dot (8px, #339CFF official accentColor)
            Ellipse dot = new Ellipse {
                Width = 8,
                Height = 8,
                Fill = new SolidColorBrush(Color.FromRgb(51, 156, 255)),
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Effect = new DropShadowEffect {
                    Color = Color.FromRgb(51, 156, 255),
                    BlurRadius = 10,
                    ShadowDepth = 0,
                    Opacity = 0.95
                }
            };
            DoubleAnimation dotPulse = new DoubleAnimation {
                From = 0.35,
                To = 1.0,
                Duration = TimeSpan.FromMilliseconds(900),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            dot.BeginAnimation(UIElement.OpacityProperty, dotPulse);
            pillStack.Children.Add(dot);

            // Status text with cadenced shimmer gradient
            shimmerStop1 = new GradientStop(Color.FromRgb(228, 231, 236), 0.0);
            shimmerStop2 = new GradientStop(Color.FromRgb(255, 255, 255), 0.2);
            shimmerStop3 = new GradientStop(Color.FromRgb(180, 184, 194), 0.4);

            shimmerTextBrush = new LinearGradientBrush {
                StartPoint = new Point(0, 0.5),
                EndPoint = new Point(1, 0.5),
                GradientStops = new GradientStopCollection {
                    shimmerStop1,
                    shimmerStop2,
                    shimmerStop3
                }
            };

            statusText = new TextBlock {
                Text = "Antigravity is controlling...",
                Foreground = shimmerTextBrush,
                FontSize = 13.5,
                FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI, -apple-system, sans-serif"),
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 12, 0)
            };
            pillStack.Children.Add(statusText);

            // Animate text shimmer across status text
            DoubleAnimation shimmerAnim = new DoubleAnimation {
                From = -0.6,
                To = 1.4,
                Duration = TimeSpan.FromSeconds(2.6),
                RepeatBehavior = RepeatBehavior.Forever
            };
            Timeline.SetDesiredFrameRate(shimmerAnim, 60);

            // Subtle vertical separator
            Rectangle sep = new Rectangle {
                Width = 1,
                Height = 18,
                Fill = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)), // rgba(255,255,255,0.16)
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            pillStack.Children.Add(sep);

            // Stop button (_ReplyStopControl)
            stopBtn = new Button {
                Cursor = System.Windows.Input.Cursors.Hand,
                BorderThickness = new Thickness(0),
                Background = Brushes.Transparent,
                Height = 32,
                Padding = new Thickness(0),
                VerticalAlignment = VerticalAlignment.Center
            };

            Border stopBorder = new Border {
                Background = new SolidColorBrush(Color.FromArgb(22, 255, 255, 255)), // rgba(255, 255, 255, 0.08)
                BorderBrush = new SolidColorBrush(Color.FromArgb(36, 255, 255, 255)), // rgba(255, 255, 255, 0.14)
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(10, 0, 10, 0),
                Height = 32
            };

            StackPanel stopStack = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            Rectangle stopSquare = new Rectangle {
                Width = 7,
                Height = 7,
                RadiusX = 1.5,
                RadiusY = 1.5,
                Fill = new SolidColorBrush(Color.FromRgb(255, 77, 79)), // #FF4D4F authentic red stop square
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            stopStack.Children.Add(stopSquare);

            TextBlock stopLabel = new TextBlock {
                Text = "Stop",
                Foreground = Brushes.White,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 6, 0)
            };
            stopStack.Children.Add(stopLabel);

            Border kbdBadge = new Border {
                Background = new SolidColorBrush(Color.FromArgb(38, 255, 255, 255)),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(4, 2, 4, 2),
                VerticalAlignment = VerticalAlignment.Center
            };
            TextBlock kbdText = new TextBlock {
                Text = "Esc",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 10,
                FontWeight = FontWeights.SemiBold
            };
            kbdBadge.Child = kbdText;
            stopStack.Children.Add(kbdBadge);

            stopBorder.Child = stopStack;
            stopBtn.Content = stopBorder;

            stopBtn.MouseEnter += (s, e) => {
                stopBorder.Background = new SolidColorBrush(Color.FromArgb(50, 255, 255, 255));
            };
            stopBtn.MouseLeave += (s, e) => {
                stopBorder.Background = new SolidColorBrush(Color.FromArgb(22, 255, 255, 255));
            };
            stopBtn.Click += (s, e) => {
                TriggerInterrupt();
            };
            stopBtn.SizeChanged += (s, e) => {
                UpdateCachedPillBounds();
            };

            pillStack.Children.Add(stopBtn);
            interruptPill.Child = pillStack;

            interruptPill.SizeChanged += (s, e) => {
                if (interruptPill.ActualWidth > 0) {
                    Canvas.SetLeft(interruptPill, Math.Max(0, (screenWidth - interruptPill.ActualWidth) / 2.0));
                }
                Canvas.SetTop(interruptPill, 18);
                UpdateCachedPillBounds();
            };

            Canvas.SetTop(interruptPill, 18);
            Canvas.SetLeft(interruptPill, Math.Max(0, (screenWidth - 380) / 2.0));
            mainCanvas.Children.Add(interruptPill);
        }

        private void BuildAgentCursor() {
            // Container matches CURSOR_CONFIG: containerSize = 24x24, originOffset = 12x12
            Canvas container = new Canvas {
                Width = 24,
                Height = 24,
                IsHitTestVisible = false,
                RenderTransformOrigin = new Point(0.5, 0.5) // (12, 12)
            };

            // Offset wrapper: translate3d(12px, -2.5px, 0)
            Canvas offsetWrapper = new Canvas {
                Width = 23,
                Height = 24,
                RenderTransformOrigin = new Point(0, 0),
                RenderTransform = new TranslateTransform(12, -2.5)
            };

            cursorImage = new Image {
                Width = 23,
                Height = 24,
                IsHitTestVisible = false,
                RenderTransformOrigin = new Point(0, 0),
                // Dual neon glow: 6px core + 16px ambient bloom (#007AFF / #38BDF8)
                Effect = new DropShadowEffect {
                    Color = Color.FromRgb(0, 122, 255), // #007AFF
                    BlurRadius = 14,
                    ShadowDepth = 0,
                    Opacity = 0.90
                }
            };

            // Load official Codex base64 asset directly
            try {
                byte[] raw = Convert.FromBase64String(CURSOR_BASE64);
                BitmapImage bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.StreamSource = new MemoryStream(raw);
                bmp.EndInit();
                cursorImage.Source = bmp;
            } catch {}

            // Base rotation: 44 degrees as defined in CURSOR_CONFIG
            cursorImage.RenderTransform = new RotateTransform(44, 0, 0);

            offsetWrapper.Children.Add(cursorImage);
            container.Children.Add(offsetWrapper);

            cursorContainer = container;
            Canvas.SetLeft(cursorContainer, currentPoint.X);
            Canvas.SetTop(cursorContainer, currentPoint.Y);

            Panel.SetZIndex(borderContainer, 1000);
            Panel.SetZIndex(interruptPill, 9000);
            Panel.SetZIndex(cursorContainer, 9999);

            mainCanvas.Children.Add(cursorContainer);
        }

        public void MoveCursor(double newX, double newY) {
            thinkStartedAt = null;
            visibilitySpring.target = 1.0;

            double dpiScale = 1.0;
            try {
                PresentationSource source = PresentationSource.FromVisual(this);
                if (source != null && source.CompositionTarget != null) {
                    dpiScale = source.CompositionTarget.TransformToDevice.M11;
                }
            } catch {}
            if (dpiScale <= 0) dpiScale = 1.0;

            newX = newX / dpiScale;
            newY = newY / dpiScale;

            double dx = newX - currentPoint.X;
            double dy = newY - currentPoint.Y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            targetPoint = new PointD(newX, newY);

            if (dist < 0.5) {
                currentPoint = targetPoint;
                positionXSpring.Reset(newX);
                positionYSpring.Reset(newY);
                isBezier = false;
                ShowActive();
                return;
            }

            // Bezier arc trajectory for long travels (TEs = 196 threshold)
            if (dist > 196.0) {
                double midX = (currentPoint.X + newX) / 2.0;
                double midY = (currentPoint.Y + newY) / 2.0;
                double angle = Math.Atan2(dy, dx);
                double perpAngle = angle + (Math.PI / 2.0) * (currentPoint.X > newX ? 1.0 : -1.0);
                double arcHeight = Math.Min(dist * 0.18, 50.0);
                double ctrlX = Math.Max(0, Math.Min(screenWidth, midX + Math.Cos(perpAngle) * arcHeight));
                double ctrlY = Math.Max(0, Math.Min(screenHeight, midY + Math.Sin(perpAngle) * arcHeight));

                currentBezier = new BezierPath {
                    Start = currentPoint,
                    Ctrl = new PointD(ctrlX, ctrlY),
                    End = targetPoint,
                    Dist = dist
                };
                // Snappy 0.18s progress response matching Codex speed
                progressSpring = new Spring(0, 1, 0.88, 0.18);
                isBezier = true;
            } else {
                isBezier = false;
                positionXSpring.target = newX;
                positionYSpring.target = newY;
            }

            double moveAngle = Math.Atan2(dy, dx);
            scootAxisSpring.target = moveAngle * (180.0 / Math.PI);
            scootStretchSpring.value = Math.Min(1.35, 1.0 + dist / 700.0);

            ShowActive();
        }

        public void SetIdle() {
            thinkStartedAt = DateTime.UtcNow;
            isBezier = false;
            currentPoint = targetPoint;
            positionXSpring.Reset(targetPoint.X);
            positionYSpring.Reset(targetPoint.Y);
            visibilitySpring.target = 1.0;
        }

        private void OnAnimationTick(object sender, EventArgs e) {
            try {
                DateTime now = DateTime.UtcNow;
                double dt = (now - lastTickTime).TotalSeconds;
                if (dt <= 0.0001) dt = 0.016;
                if (dt > 0.1) dt = 0.1;
                lastTickTime = now;

                visibilitySpring.Step(dt);

                if (isBezier && currentBezier != null && progressSpring != null) {
                    bool progressBusy = progressSpring.Step(dt);
                    PointD pos = currentBezier.Evaluate(progressSpring.value);
                    currentPoint = pos;
                    positionXSpring.Reset(pos.X);
                    positionYSpring.Reset(pos.Y);

                    if (!progressBusy || progressSpring.value >= 0.98) {
                        isBezier = false;
                        currentPoint = targetPoint;
                        positionXSpring.Reset(targetPoint.X);
                        positionYSpring.Reset(targetPoint.Y);
                        thinkStartedAt = DateTime.UtcNow;
                    }
                } else {
                    bool xBusy = positionXSpring.Step(dt);
                    bool yBusy = positionYSpring.Step(dt);
                    currentPoint = new PointD(positionXSpring.value, positionYSpring.value);

                    if (!xBusy && !yBusy && thinkStartedAt == null) {
                        thinkStartedAt = DateTime.UtcNow;
                    }
                }

                scootStretchSpring.Step(dt);
                scootAxisSpring.Step(dt);
                stretchSpring.Step(dt);
                rotationSpring.Step(dt);

                double idleTilt = 0;
                double idleScale = 1.0;
                if (thinkStartedAt != null) {
                    double elapsed = (now - thinkStartedAt.Value).TotalSeconds;
                    idleTilt = Math.Sin(elapsed * 2.5) * 4.0; // subtle 4 deg breathing swing
                    idleScale = 1.0 + Math.Sin(elapsed * 3.2) * 0.05; // 5% scale pulse
                }

                ApplyCursorTransform(idleTilt, idleScale);

                // Cadenced text shimmer progression
                double shimmerSec = (now.Ticks / 10000) / 1000.0;
                double shimmerPos = (shimmerSec % 2.5) / 2.5; // 0 to 1
                if (shimmerStop1 != null && shimmerStop2 != null && shimmerStop3 != null) {
                    shimmerStop1.Offset = Math.Max(0.0, shimmerPos - 0.2);
                    shimmerStop2.Offset = Math.Min(1.0, shimmerPos);
                    shimmerStop3.Offset = Math.Min(1.0, shimmerPos + 0.2);
                }
            } catch {}
        }

        private void ApplyCursorTransform(double idleTilt, double idleScale) {
            try {
                if (cursorContainer == null || cursorImage == null) return;

                double stretch = scootStretchSpring.value * idleScale;
                if (double.IsNaN(stretch) || double.IsInfinity(stretch) || stretch <= 0) stretch = 1.0;
                double squash = (1.0 / Math.Sqrt(Math.Max(0.2, stretch))) * idleScale;
                if (double.IsNaN(squash) || double.IsInfinity(squash) || squash <= 0) squash = 1.0;

                // In Codex: img.style.transform = rotate(axis) scale(stretch, squash) rotate(-axis) rotate(rotation + 44)
                double rotation = rotationSpring.value + idleTilt + 44.0;
                if (double.IsNaN(rotation) || double.IsInfinity(rotation)) rotation = 44.0;
                double axisAngle = scootAxisSpring.value;
                if (double.IsNaN(axisAngle) || double.IsInfinity(axisAngle)) axisAngle = 0;

                TransformGroup imgGroup = new TransformGroup();
                imgGroup.Children.Add(new RotateTransform(axisAngle, 0, 0));
                imgGroup.Children.Add(new ScaleTransform(stretch, squash, 0, 0));
                imgGroup.Children.Add(new RotateTransform(-axisAngle, 0, 0));
                imgGroup.Children.Add(new RotateTransform(rotation, 0, 0));

                cursorImage.RenderTransform = imgGroup;

                // Translate container to currentPoint (x, y), aligned to arrow pointer tip at (12, 2)
                double cx = currentPoint.X;
                double cy = currentPoint.Y;
                if (double.IsNaN(cx) || double.IsInfinity(cx)) cx = 100;
                if (double.IsNaN(cy) || double.IsInfinity(cy)) cy = 100;

                Canvas.SetLeft(cursorContainer, cx - 12);
                Canvas.SetTop(cursorContainer, cy - 2);

                double op = visibilitySpring.value;
                if (double.IsNaN(op) || double.IsInfinity(op) || op < 0.2) op = 1.0;
                cursorContainer.Opacity = Math.Max(0.85, Math.Min(1, op));
            } catch {}
        }

        public void ShowActive(string status = null) {
            Dispatcher.Invoke(() => {
                BeginAnimation(UIElement.OpacityProperty, null);
                try {
                    File.Delete(@"C:\Users\Yashjit 2\AppData\Roaming\BetterGravity\plugins\computer-use\interrupt.signal");
                    File.Delete(@"C:\Users\Yashjit 2\Workspace\BetterGravity\community\plugins\computer-use\interrupt.signal");
                } catch {}
                if (statusText != null) statusText.Text = "Antigravity is controlling...";
                EnableInputBlock();
                Opacity = 1.0;
                Visibility = Visibility.Visible;
                visibilitySpring.value = 1.0;
                visibilitySpring.target = 1.0;
                Topmost = false;
                Topmost = true;
                if (hwnd != IntPtr.Zero) {
                    ShowWindow(hwnd, SW_SHOW);
                    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
                }
                UpdateCachedPillBounds();
                if (idleFadeTimer != null) {
                    idleFadeTimer.Stop();
                    idleFadeTimer.Start();
                }
            });
        }

        public void FadeOut() {
            if (idleFadeTimer != null) idleFadeTimer.Stop();
            DisableInputBlock();
            DoubleAnimation fade = new DoubleAnimation {
                From = 1.0,
                To = 0.0,
                Duration = TimeSpan.FromMilliseconds(400)
            };
            fade.Completed += (s, e) => {
                Visibility = Visibility.Hidden;
            };
            BeginAnimation(UIElement.OpacityProperty, fade);
        }

        public void TriggerInterrupt() {
            if (idleFadeTimer != null) idleFadeTimer.Stop();
            DisableInputBlock();
            try {
                string[] signalPaths = new string[] {
                    @"C:\Users\Yashjit 2\AppData\Roaming\BetterGravity\plugins\computer-use\interrupt.signal",
                    @"C:\Users\Yashjit 2\Workspace\BetterGravity\community\plugins\computer-use\interrupt.signal"
                };
                foreach (string p in signalPaths) {
                    string dir = System.IO.Path.GetDirectoryName(p);
                    if (Directory.Exists(dir)) {
                        File.WriteAllText(p, "INTERRUPT");
                    }
                }
            } catch {}

            FadeOut();
        }

        private void StartTcpListener() {
            listenerThread = new Thread(() => {
                AttachToInteractiveDesktop();
                try {
                    listener = new TcpListener(IPAddress.Loopback, 51830);
                    listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                    listener.Start();
                    while (true) {
                        TcpClient client = listener.AcceptTcpClient();
                        ThreadPool.QueueUserWorkItem((obj) => {
                            TcpClient c = (TcpClient)obj;
                            try {
                                NetworkStream s = c.GetStream();
                                StreamReader r = new StreamReader(s, Encoding.UTF8);
                                StreamWriter w = new StreamWriter(s, Encoding.UTF8) { AutoFlush = true };

                                string line = r.ReadLine();
                                if (!string.IsNullOrEmpty(line)) {
                                    Match mAction = Regex.Match(line, "\"action\"\\s*:\\s*\"([^\"]+)\"");
                                    Match mX = Regex.Match(line, "\"x\"\\s*:\\s*([0-9.]+)");
                                    Match mY = Regex.Match(line, "\"y\"\\s*:\\s*([0-9.]+)");

                                    string action = mAction.Success ? mAction.Groups[1].Value : null;

                                    if (action == "done") {
                                        Dispatcher.BeginInvoke(new Action(() => FadeOut()));
                                    } else if (action == "idle") {
                                        Dispatcher.BeginInvoke(new Action(() => {
                                            SetIdle();
                                            ShowActive("Antigravity is controlling...");
                                        }));
                                    } else if (mX.Success && mY.Success) {
                                        double x = double.Parse(mX.Groups[1].Value);
                                        double y = double.Parse(mY.Groups[1].Value);
                                        Dispatcher.BeginInvoke(new Action(() => {
                                            MoveCursor(x, y);
                                            ShowActive("Antigravity is controlling...");
                                        }));
                                    } else {
                                        Dispatcher.BeginInvoke(new Action(() => {
                                            ShowActive("Antigravity is controlling...");
                                        }));
                                    }
                                }
                                w.WriteLine("{\"ok\":true}");
                            } catch {} finally {
                                try { c.Close(); } catch {}
                            }
                        }, client);
                    }
                } catch {}
            }) {
                IsBackground = true
            };
            listenerThread.Start();
        }

        [STAThread]
        public static void Main(string[] args) {
            AttachToInteractiveDesktop();
            try {
                // If already running, notify and exit
                using (TcpClient client = new TcpClient()) {
                    IAsyncResult ar = client.BeginConnect("127.0.0.1", 51830, null, null);
                    bool success = ar.AsyncWaitHandle.WaitOne(100);
                    if (success && client.Connected) {
                        client.EndConnect(ar);
                        using (NetworkStream stream = client.GetStream())
                        using (StreamWriter w = new StreamWriter(stream, Encoding.UTF8)) {
                            w.WriteLine("{\"action\":\"idle\",\"status\":\"Antigravity is controlling...\"}");
                        }
                        return;
                    }
                }
            } catch {}

            try {
                Application app = new Application();
                OverlayWindow win = new OverlayWindow();
                app.Run(win);
            } catch {}
        }
    }
}
