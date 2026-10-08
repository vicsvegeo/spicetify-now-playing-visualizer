// Now Playing Visualizer - Windows setup.
// Compiles with the C# 5 compiler that ships with Windows (see build.ps1), so it is written
// without newer C# syntax. Mirrors the official Spicetify + Marketplace install scripts, plus:
// swapping the Microsoft Store Spotify for the desktop one, first-login handling, and an
// optional "repair after Spotify updates" mode that runs at login (--repair).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Now Playing Visualizer Setup")]
[assembly: AssemblyProduct("Now Playing Visualizer")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace NowPlayingVisualizer
{
    static class Config
    {
        public const string Owner = "vicsvegeo";
        public const string Repo = "spicetify-now-playing-visualizer";
        public const string ExtFile = "nowPlayingVisualizer.js";
        public const string RunKeyName = "NowPlayingVisualizerRepair";

        public static string ExtUrl { get { return "https://raw.githubusercontent.com/" + Owner + "/" + Repo + "/main/" + ExtFile; } }
        public static string RepoUrl { get { return "https://github.com/" + Owner + "/" + Repo; } }

        public static string AppData { get { return Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData); } }
        public static string LocalAppData { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
        public static string SpotifyDir { get { return Path.Combine(AppData, "Spotify"); } }
        public static string SpotifyExe { get { return Path.Combine(SpotifyDir, "Spotify.exe"); } }
        public static string SpotifyPrefs { get { return Path.Combine(SpotifyDir, "prefs"); } }
        public static string ToolDir { get { return Path.Combine(LocalAppData, "NowPlayingVisualizer"); } }
        public static string ToolExe { get { return Path.Combine(ToolDir, "NowPlayingVisualizer.exe"); } }
        public static string StateFile { get { return Path.Combine(ToolDir, "spotify-version.txt"); } }
        public static string RepairLog { get { return Path.Combine(ToolDir, "repair.log"); } }
    }

    class UserCancelled : Exception
    {
        public UserCancelled() : base("Cancelled.") { }
    }

    /// Everything that talks to the outside world: downloads, PowerShell, spicetify.exe.
    static class Util
    {
        public static WebClient Web()
        {
            var w = new WebClient();
            w.Headers[HttpRequestHeader.UserAgent] = "NowPlayingVisualizer-Setup";
            return w;
        }

        public static string Download(string url)
        {
            using (var w = Web()) { w.Encoding = Encoding.UTF8; return w.DownloadString(url); }
        }

        public static void DownloadFile(string url, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            using (var w = Web()) w.DownloadFile(url, path);
        }

        public static string StripAnsi(string s)
        {
            return Regex.Replace(s ?? "", @"\x1b\[[0-9;]*[A-Za-z]", "");
        }

        public static int Exec(string exe, string args, out string output, int timeoutMs)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            var sb = new StringBuilder();
            using (var p = new Process { StartInfo = psi })
            {
                DataReceivedEventHandler h = (s, e) => { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
                p.OutputDataReceived += h;
                p.ErrorDataReceived += h;
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { }
                    output = StripAnsi(sb.ToString()) + "\n(timed out)";
                    return -1;
                }
                p.WaitForExit();
                output = StripAnsi(sb.ToString()).Trim();
                return p.ExitCode;
            }
        }

        public static string PowerShell(string command)
        {
            string output;
            Exec("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "\\\"") + "\"", out output, 300000);
            return output;
        }

        public static void KillSpotify()
        {
            foreach (var p in Process.GetProcessesByName("Spotify"))
            {
                try { p.Kill(); p.WaitForExit(5000); } catch { }
            }
        }

        public static string SpotifyVersion()
        {
            try { return FileVersionInfo.GetVersionInfo(Config.SpotifyExe).ProductVersion ?? ""; }
            catch { return ""; }
        }

        public static void CopyDir(string src, string dest)
        {
            Directory.CreateDirectory(dest);
            foreach (var f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(dest, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(src)) CopyDir(d, Path.Combine(dest, Path.GetFileName(d)));
        }

        // Extracts a zip, overwriting existing files (ZipFile.ExtractToDirectory refuses to).
        public static void Unzip(string zip, string dest)
        {
            using (var a = ZipFile.OpenRead(zip))
            {
                foreach (var e in a.Entries)
                {
                    var target = Path.GetFullPath(Path.Combine(dest, e.FullName));
                    if (!target.StartsWith(Path.GetFullPath(dest), StringComparison.OrdinalIgnoreCase)) continue;
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    e.ExtractToFile(target, true);
                }
            }
        }
    }

    static class Spice
    {
        public static string Exe;

        public static string Find()
        {
            var local = Path.Combine(Config.LocalAppData, "spicetify", "spicetify.exe");
            if (File.Exists(local)) return local;
            var path = (Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "") + ";" +
                       (Environment.GetEnvironmentVariable("Path") ?? "");
            foreach (var dir in path.Split(';'))
            {
                try
                {
                    if (dir.Trim().Length == 0) continue;
                    var p = Path.Combine(Environment.ExpandEnvironmentVariables(dir.Trim()), "spicetify.exe");
                    if (File.Exists(p)) return p;
                }
                catch { }
            }
            return null;
        }

        public static int Run(string args, out string output)
        {
            return Util.Exec(Exe, args + " --bypass-admin", out output, 600000);
        }

        public static string Run(string args)
        {
            string o;
            Run(args, out o);
            return o;
        }

        public static bool Failed(int code, string output)
        {
            return code != 0 || Regex.IsMatch(output, @"^\s*(error|fatal)\b", RegexOptions.Multiline | RegexOptions.IgnoreCase);
        }

        public static string[] ConfigList(string key)
        {
            return Run("config " + key).Split(new[] { '\r', '\n', '|' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(s => s.Trim()).Where(s => s.Length > 0).ToArray();
        }

        public static string UserData()
        {
            var lines = Run("path userdata").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var dir = lines.Length > 0 ? lines[lines.Length - 1].Trim() : "";
            return Directory.Exists(dir) ? dir : Path.Combine(Config.AppData, "spicetify");
        }

        // backup+apply covers a fresh install and most Spotify updates; restore+backup+apply
        // covers a stale backup from an older Spotify version; plain apply is the last resort.
        public static void ApplyWithFallbacks(Action<string> log)
        {
            string output = "";
            foreach (var args in new[] { "backup apply", "restore backup apply", "apply" })
            {
                int code = Run(args, out output);
                if (!Failed(code, output)) return;
                log("   (\"spicetify " + args + "\" didn't work, trying another way...)");
            }
            throw new Exception("Spicetify couldn't patch Spotify. Its last message was:\n\n" + Tail(output, 12));
        }

        static string Tail(string s, int lines)
        {
            var all = s.Split('\n').Where(l => !l.Contains("Patching files")).ToArray();
            return string.Join("\n", all.Skip(Math.Max(0, all.Length - lines)));
        }
    }

    static class Installer
    {
        public static void Install(Action<string> log, Func<string, bool> ask, Action<string> tell, bool autoRepair)
        {
            // 1. The Microsoft Store version of Spotify is sandboxed and can't be patched.
            log("Checking your Spotify...");
            var store = Util.PowerShell("Get-AppxPackage -Name SpotifyAB.SpotifyMusic | Select-Object -ExpandProperty PackageFullName");
            if (store.Contains("SpotifyAB"))
            {
                if (!ask("You have the Microsoft Store version of Spotify, which can't be modded.\n\n" +
                         "Replace it with the regular Spotify from spotify.com?\n\n" +
                         "Your account, playlists and settings come back when you log in. " +
                         "Songs you downloaded for offline listening would need downloading again."))
                    throw new UserCancelled();
                log("Removing the Microsoft Store version...");
                Util.KillSpotify();
                Util.PowerShell("Get-AppxPackage -Name SpotifyAB.SpotifyMusic | Remove-AppxPackage");
            }

            // 2. Desktop Spotify.
            if (!File.Exists(Config.SpotifyExe))
            {
                log("Downloading Spotify...");
                var setup = Path.Combine(Path.GetTempPath(), "SpotifySetup-" + Guid.NewGuid().ToString("N") + ".exe");
                Util.DownloadFile("https://download.scdn.co/SpotifySetup.exe", setup);
                var sig = Util.PowerShell("$s = Get-AuthenticodeSignature -LiteralPath '" + setup + "'; '' + $s.Status + '|' + $s.SignerCertificate.Subject");
                if (!sig.StartsWith("Valid|") || !sig.Contains("O=Spotify AB"))
                    throw new Exception("The Spotify installer that was downloaded isn't signed by Spotify, so it wasn't run.");
                log("Installing Spotify (this can take a minute)...");
                using (var p = Process.Start(setup, "/silent")) p.WaitForExit(600000);
                for (int i = 0; i < 120 && !File.Exists(Config.SpotifyExe); i++) Thread.Sleep(1000);
                if (!File.Exists(Config.SpotifyExe)) throw new Exception("Spotify didn't finish installing. Install it from spotify.com, then run this again.");
                try { File.Delete(setup); } catch { }
            }

            // 3. Spicetify needs Spotify to have been opened (and logged in) once.
            for (int tries = 0; !File.Exists(Config.SpotifyPrefs); tries++)
            {
                if (tries == 0)
                {
                    log("Opening Spotify so you can log in...");
                    Process.Start(Config.SpotifyExe);
                    Thread.Sleep(4000);
                }
                if (tries >= 3) throw new Exception("Spotify hasn't been set up yet. Open Spotify, log in, then run this again.");
                tell("Spotify is open. Log in (or sign up), then click OK to continue.");
            }

            // 4. Spicetify itself.
            Spice.Exe = Spice.Find();
            if (Spice.Exe == null)
            {
                log("Downloading Spicetify...");
                var json = Util.Download("https://api.github.com/repos/spicetify/cli/releases/latest");
                var arch = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant() == "ARM64" ? "arm64" : "x64";
                var m = Regex.Match(json, "\"browser_download_url\"\\s*:\\s*\"([^\"]+windows-" + arch + "\\.zip)\"");
                if (!m.Success) throw new Exception("Couldn't find the Spicetify download. Check your internet connection and try again.");
                var dir = Path.Combine(Config.LocalAppData, "spicetify");
                var zip = Path.Combine(Path.GetTempPath(), "spicetify-" + Guid.NewGuid().ToString("N") + ".zip");
                Util.DownloadFile(m.Groups[1].Value, zip);
                Directory.CreateDirectory(dir);
                Util.Unzip(zip, dir);
                try { File.Delete(zip); } catch { }
                var userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
                if (!userPath.Split(';').Any(p => p.Trim().TrimEnd('\\').Equals(dir, StringComparison.OrdinalIgnoreCase)))
                    Environment.SetEnvironmentVariable("Path", userPath.TrimEnd(';') + ";" + dir, EnvironmentVariableTarget.User);
                Spice.Exe = Path.Combine(dir, "spicetify.exe");
            }
            var userData = Spice.UserData();

            // 5. Marketplace (same steps as its official install script).
            var market = Path.Combine(userData, "CustomApps", "marketplace");
            if (!File.Exists(Path.Combine(market, "index.js")))
            {
                log("Installing the Spicetify Marketplace...");
                var zip = Path.Combine(Path.GetTempPath(), "marketplace-" + Guid.NewGuid().ToString("N") + ".zip");
                var tmp = Path.Combine(Path.GetTempPath(), "marketplace-" + Guid.NewGuid().ToString("N"));
                Util.DownloadFile("https://github.com/spicetify/marketplace/releases/latest/download/marketplace.zip", zip);
                Util.Unzip(zip, tmp);
                var src = Directory.Exists(Path.Combine(tmp, "marketplace-dist")) ? Path.Combine(tmp, "marketplace-dist") : tmp;
                if (Directory.Exists(market)) Directory.Delete(market, true);
                Util.CopyDir(src, market);
                try { File.Delete(zip); Directory.Delete(tmp, true); } catch { }
            }
            Spice.Run("config custom_apps spicetify-marketplace- -q");
            if (!Spice.ConfigList("custom_apps").Contains("marketplace")) Spice.Run("config custom_apps marketplace");
            Spice.Run("config inject_css 1 replace_colors 1");
            if (Regex.IsMatch(Spice.Run("path -s"), @"\b(fatal|error)\b", RegexOptions.IgnoreCase))
            {
                // No theme set: Marketplace needs its placeholder theme to be able to install themes.
                Util.DownloadFile("https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini",
                    Path.Combine(userData, "Themes", "marketplace", "color.ini"));
                Spice.Run("config current_theme marketplace");
            }

            // 6. The visualizer (always the latest version from GitHub, so re-running = updating).
            log("Downloading the visualizer...");
            Util.DownloadFile(Config.ExtUrl, Path.Combine(userData, "Extensions", Config.ExtFile));
            if (!Spice.ConfigList("extensions").Contains(Config.ExtFile)) Spice.Run("config extensions " + Config.ExtFile);

            // 7. Patch Spotify.
            log("Adding everything to Spotify (Spotify will restart)...");
            Spice.ApplyWithFallbacks(log);

            // 8. Auto-repair after Spotify updates.
            Directory.CreateDirectory(Config.ToolDir);
            File.WriteAllText(Config.StateFile, Util.SpotifyVersion());
            if (autoRepair)
            {
                var self = Assembly.GetExecutingAssembly().Location;
                if (!self.Equals(Config.ToolExe, StringComparison.OrdinalIgnoreCase)) File.Copy(self, Config.ToolExe, true);
                using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
                    k.SetValue(Config.RunKeyName, "\"" + Config.ToolExe + "\" --repair");
                log("Auto-repair is on: the visualizer comes back by itself after Spotify updates.");
            }
            else
            {
                RemoveAutoRepair();
            }
        }

        public static void RemoveAutoRepair()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                if (k != null) k.DeleteValue(Config.RunKeyName, false);
        }

        public static void Uninstall(Action<string> log, Func<string, bool> ask)
        {
            Spice.Exe = Spice.Find();
            RemoveAutoRepair();
            if (Spice.Exe == null)
            {
                log("Spicetify isn't installed, so there's nothing else to remove.");
                return;
            }
            var userData = Spice.UserData();
            bool everything = ask("Remove just the visualizer, or put Spotify completely back to normal?\n\n" +
                                  "Yes = completely back to normal (also removes Spicetify, the Marketplace, and anything you installed from it)\n" +
                                  "No = remove just the visualizer");
            if (everything)
            {
                log("Restoring the original Spotify...");
                Spice.Run("restore");
                try { Directory.Delete(userData, true); } catch { }
                try { Directory.Delete(Path.GetDirectoryName(Spice.Exe), true); } catch { }
                var userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
                var dir = Path.GetDirectoryName(Spice.Exe);
                Environment.SetEnvironmentVariable("Path", string.Join(";", userPath.Split(';')
                    .Where(p => p.Length > 0 && !p.TrimEnd('\\').Equals(dir, StringComparison.OrdinalIgnoreCase))), EnvironmentVariableTarget.User);
            }
            else
            {
                log("Removing the visualizer...");
                Spice.Run("config extensions " + Config.ExtFile + "-");
                try { File.Delete(Path.Combine(userData, "Extensions", Config.ExtFile)); } catch { }
                Spice.ApplyWithFallbacks(log);
            }
            try { File.Delete(Config.StateFile); File.Delete(Config.RepairLog); } catch { }
        }

        /// Runs at login (--repair). Re-applies if Spotify updated itself and wiped the mods.
        public static int Repair()
        {
            bool created;
            using (var mutex = new Mutex(true, "NowPlayingVisualizerRepair", out created))
            {
                if (!created) return 0;
                Action<string> log = s =>
                {
                    try { File.AppendAllText(Config.RepairLog, DateTime.Now.ToString("s") + "  " + s + Environment.NewLine); } catch { }
                };
                try
                {
                    Spice.Exe = Spice.Find();
                    if (Spice.Exe == null || !File.Exists(Config.SpotifyExe)) return 0;
                    var version = Util.SpotifyVersion();
                    var stored = File.Exists(Config.StateFile) ? File.ReadAllText(Config.StateFile).Trim() : "";
                    var index = Path.Combine(Config.SpotifyDir, "Apps", "xpui", "index.html");
                    bool patched = File.Exists(index) && File.ReadAllText(index).Contains(Config.ExtFile);
                    if (patched && version == stored) return 0;

                    log("Spotify " + stored + " -> " + version + ", patched=" + patched + "; repairing");
                    // Patching fetches a CSS map online, and the network may not be up right after login.
                    for (int attempt = 1; ; attempt++)
                    {
                        try
                        {
                            Spice.ApplyWithFallbacks(log);
                            break;
                        }
                        catch (Exception e)
                        {
                            log("attempt " + attempt + " failed: " + e.Message);
                            if (attempt >= 4) return 1;
                            Thread.Sleep(30000);
                        }
                    }
                    File.WriteAllText(Config.StateFile, Util.SpotifyVersion());
                    log("repaired");
                    return 0;
                }
                catch (Exception e)
                {
                    log("error: " + e);
                    return 1;
                }
            }
        }
    }

    class SetupForm : Form
    {
        static readonly Color Bg = Color.FromArgb(18, 18, 18);
        static readonly Color Panel = Color.FromArgb(40, 40, 40);
        static readonly Color Green = Color.FromArgb(30, 215, 96);
        static readonly Color Subdued = Color.FromArgb(179, 179, 179);

        readonly Button installBtn, uninstallBtn;
        readonly CheckBox repairBox;
        readonly TextBox logBox;
        readonly ProgressBar progress;

        public SetupForm()
        {
            Text = "Now Playing Visualizer Setup";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Bg;
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10f);
            try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

            // Lay out top-to-bottom in pixels scaled to the display, so nothing clips at 125%/150%.
            float k;
            using (var g = CreateGraphics()) k = g.DpiX / 96f;
            Func<int, int> px = v => (int)Math.Round(v * k);
            int pad = px(24), inner = px(520);
            ClientSize = new Size(inner + pad * 2, px(520));

            var flow = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false,
                Padding = new Padding(pad, px(16), pad, px(12)), BackColor = Bg
            };
            var title = new Label { Text = "Now Playing Visualizer", Font = new Font("Segoe UI Semibold", 20f), AutoSize = true, Margin = new Padding(0) };
            var sub = new Label
            {
                Text = "Turns the album art in Spotify's Now Playing view into a live, beat-synced visualizer. " +
                       "This sets up everything it needs (Spicetify and its Marketplace).",
                ForeColor = Subdued, AutoSize = true, MaximumSize = new Size(inner, 0), Margin = new Padding(px(2), px(4), 0, px(12))
            };
            repairBox = new CheckBox
            {
                Text = "Automatically repair after Spotify updates (recommended)",
                Checked = true, AutoSize = true, ForeColor = Color.White, Margin = new Padding(px(2), 0, 0, px(12))
            };
            installBtn = MakeButton("Install", Green, Color.Black, px(150), px(40));
            uninstallBtn = MakeButton("Uninstall", Panel, Color.White, px(130), px(40));
            var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, px(12)) };
            installBtn.Margin = new Padding(0, 0, px(12), 0);
            uninstallBtn.Margin = new Padding(0);
            buttons.Controls.AddRange(new Control[] { installBtn, uninstallBtn });
            progress = new ProgressBar { Size = new Size(inner, px(6)), Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 25, Visible = false, Margin = new Padding(0, 0, 0, px(4)) };
            logBox = new TextBox
            {
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.None,
                BackColor = Panel, ForeColor = Color.White, Size = new Size(inner, px(190)), Margin = new Padding(0, 0, 0, px(10)),
                Font = new Font("Segoe UI", 9.5f), Text = "Click Install to get started." + Environment.NewLine
            };
            var link = new LinkLabel
            {
                Text = "Help and source code on GitHub", AutoSize = true, Margin = new Padding(0),
                LinkColor = Subdued, ActiveLinkColor = Green
            };
            link.LinkClicked += (s, e) => { try { Process.Start(Config.RepoUrl); } catch { } };

            installBtn.Click += (s, e) => RunJob(true);
            uninstallBtn.Click += (s, e) => RunJob(false);
            flow.Controls.AddRange(new Control[] { title, sub, repairBox, buttons, progress, logBox, link });
            Controls.Add(flow);

            // Fit the window height to the content.
            Load += (s, e) =>
            {
                flow.PerformLayout();
                ClientSize = new Size(ClientSize.Width, link.Bottom + flow.Padding.Bottom);
            };
        }

        static Button MakeButton(string text, Color back, Color fore, int width, int height)
        {
            var b = new Button
            {
                Text = text, BackColor = back, ForeColor = fore, FlatStyle = FlatStyle.Flat,
                Size = new Size(width, height), Font = new Font("Segoe UI Semibold", 10.5f), Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        void Log(string line)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), line); return; }
            logBox.AppendText(line + Environment.NewLine);
        }

        bool Ask(string question)
        {
            return (bool)Invoke(new Func<bool>(() =>
                MessageBox.Show(this, question, Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes));
        }

        void Tell(string message)
        {
            Invoke(new Action(() => MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Information)));
        }

        void RunJob(bool install)
        {
            installBtn.Enabled = uninstallBtn.Enabled = repairBox.Enabled = false;
            progress.Visible = true;
            logBox.Clear();
            bool autoRepair = repairBox.Checked;
            var t = new Thread(() =>
            {
                string done = null, failed = null;
                try
                {
                    if (install)
                    {
                        Installer.Install(Log, Ask, Tell, autoRepair);
                        done = "All done! Open the Now Playing view in Spotify (the panel on the right) and play a song.";
                    }
                    else
                    {
                        Installer.Uninstall(Log, Ask);
                        done = "Removed.";
                    }
                }
                catch (UserCancelled) { Log("Cancelled. Nothing else was changed."); }
                catch (WebException e) { failed = "Couldn't download something: " + e.Message + "\n\nCheck your internet connection and try again."; }
                catch (Exception e) { failed = e.Message; }

                BeginInvoke(new Action(() =>
                {
                    progress.Visible = false;
                    installBtn.Enabled = uninstallBtn.Enabled = repairBox.Enabled = true;
                    if (done != null)
                    {
                        Log("");
                        Log("✓ " + done);
                    }
                    if (failed != null)
                    {
                        Log("");
                        Log("✗ Something went wrong:");
                        Log(failed);
                        MessageBox.Show(this, failed + "\n\nIf it keeps happening, open an issue on GitHub (link at the bottom).",
                            Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                }));
            });
            t.IsBackground = true;
            t.Start();
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
            if (args.Length > 0 && args[0] == "--repair") return Installer.Repair();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }
    }
}
