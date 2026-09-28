// 공부모드 배경화면: an animated desktop wallpaper that also force-closes
// blocked apps and browser tabs (matched by window title) while it runs.
//
// Windows only. Two PowerShell helpers do the Win32 work so no native Node
// modules are needed:
//   scripts/attach.ps1 - reparents the wallpaper windows behind the desktop icons
//   scripts/guard.ps1  - long-running loop that kills blocked processes
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  dialog,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execFile } = require("child_process");
const examStatus = require("./renderer/exam.js");

// Keep the wallpaper painting even though Windows reports it as covered by
// the desktop icon layer.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

// ASCII folder name so the PowerShell helpers never see a non-ASCII path.
app.setPath("userData", path.join(app.getPath("appData"), "StudyLockWallpaper"));
app.setAppUserModelId("kr.yechan.studylock.wallpaper");

const USER_DIR = app.getPath("userData");
const CONFIG_PATH = path.join(USER_DIR, "config.json");
const STATS_PATH = path.join(USER_DIR, "stats.json");
const ICON_PATH = path.join(__dirname, "build", "icon.ico");
const IS_WIN = process.platform === "win32";

const DEFAULTS = {
  blockedApps: [
    "Steam",
    "EpicGamesLauncher",
    "LeagueClient",
    "League of Legends",
    "RiotClientServices",
    "VALORANT",
    "Battle.net",
    "Overwatch",
    "MapleStory",
    "Discord",
  ],
  blockedSites: ["YouTube", "Netflix", "Instagram", "TikTok", "Twitch", "치지직", "SOOP", "웹툰"],
  examDate: "2026-10-02",
  examEndDate: "2026-10-09",
  message: "지금 참으면, 시험 끝나고 맘껏 논다.",
  autostart: true,
  lockUntil: null,
};

let config = loadConfig();
let stats = loadJson(STATS_PATH, { date: today(), blocks: 0 });
let tray = null;
let settingsWin = null;
let toastWin = null;
let toastTimer = null;
let wallpapers = [];
let attachStatus = "pending";
let guard = null;
let quitting = false;

// ---------- persistence ----------

function loadJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { ...fallback };
  }
}

function loadConfig() {
  const cfg = loadJson(CONFIG_PATH, DEFAULTS);
  // Configs saved by 1.0.0 have an empty examDate and no examEndDate.
  if (!cfg.examDate && !cfg.examEndDate) {
    cfg.examDate = DEFAULTS.examDate;
    cfg.examEndDate = DEFAULTS.examEndDate;
  }
  return cfg;
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isLocked() {
  return !!config.lockUntil && Date.now() < Date.parse(config.lockUntil);
}

function cleanList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const item = String(raw).trim();
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function state() {
  if (stats.date !== today()) stats = { date: today(), blocks: 0 };
  return { config, stats, locked: isLocked(), attachStatus, platform: process.platform };
}

function broadcast() {
  const s = state();
  for (const w of [...wallpapers, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send("state", s);
  }
  updateTray();
}

// ---------- PowerShell helpers ----------

// Scripts live inside app.asar, which powershell.exe cannot read, so copy
// them out next to the config.
function scriptPath(name) {
  const dest = path.join(USER_DIR, name);
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(path.join(__dirname, "scripts", name)));
  return dest;
}

function powershell(args) {
  return spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
    { windowsHide: true }
  );
}

// ---------- wallpaper ----------

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
}

function createWallpapers() {
  destroyWallpapers();
  const displays = screen.getAllDisplays();
  // WorkerW/Progman span the whole virtual screen, so child coordinates are
  // physical pixels relative to its top-left corner.
  const phys = displays.map((d) => (IS_WIN ? screen.dipToScreenRect(null, d.bounds) : d.bounds));
  const minX = Math.min(...phys.map((r) => r.x));
  const minY = Math.min(...phys.map((r) => r.y));

  // Two or more monitors: the outermost ones get the left/right eye of a pair.
  const byX = [...displays].sort((a, b) => a.bounds.x - b.bounds.x);
  const sideOf = (d) =>
    displays.length < 2 ? "single" : d === byX[0] ? "left" : d === byX[byX.length - 1] ? "right" : "single";

  let pending = displays.length;
  const specs = [];
  displays.forEach((d, i) => {
    const win = new BrowserWindow({
      ...d.bounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      backgroundColor: "#070b16",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        backgroundThrottling: false,
      },
    });
    win.__bounds = d.bounds; // getBounds() is meaningless once reparented
    win.loadFile(path.join(__dirname, "renderer", "wallpaper.html"), { query: { side: sideOf(d) } });
    win.once("ready-to-show", () => {
      const r = phys[i];
      specs[i] = [hwndOf(win), r.x - minX, r.y - minY, r.width, r.height].join(",");
      if (--pending === 0) attachWallpapers(specs);
    });
    // Restarting explorer.exe destroys WorkerW together with our windows.
    win.on("closed", () => {
      wallpapers = wallpapers.filter((w) => w !== win);
      if (!quitting && !win.__replaced) scheduleRebuild(3000);
    });
    win.webContents.on("did-finish-load", () => win.webContents.send("state", state()));
    wallpapers.push(win);
  });
}

function destroyWallpapers() {
  for (const w of wallpapers) {
    w.__replaced = true;
    if (!w.isDestroyed()) w.destroy();
  }
  wallpapers = [];
}

let rebuildTimer = null;
function scheduleRebuild(ms) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(createWallpapers, ms);
}

function attachWallpapers(specs) {
  if (!IS_WIN) {
    // Dev preview on other platforms: just show it as a normal window.
    wallpapers.forEach((w) => w.showInactive());
    attachStatus = "preview";
    return broadcast();
  }
  const ps = powershell(["-File", scriptPath("attach.ps1"), "-Spec", specs.join(";")]);
  let out = "";
  ps.stdout.on("data", (b) => (out += b));
  ps.stderr.on("data", (b) => (out += b));
  ps.on("close", () => {
    attachStatus = /^OK/m.test(out) ? "ok" : "failed";
    if (attachStatus === "failed") console.error("attach failed:", out);
    broadcast();
  });
}

// ---------- guard ----------

function startGuard() {
  if (!IS_WIN || quitting) return;
  const selfName = path.basename(process.execPath, ".exe");
  guard = powershell([
    "-File",
    scriptPath("guard.ps1"),
    "-ConfigPath",
    CONFIG_PATH,
    "-SelfName",
    selfName,
    "-ParentPid",
    String(process.pid),
  ]);
  let buf = "";
  guard.stdout.setEncoding("utf8");
  guard.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const [tag, kind, name] = line.split("\t");
      if (tag === "KILL") onBlocked(kind, name);
    }
  });
  guard.stderr.on("data", (b) => console.error("guard:", String(b)));
  guard.on("close", () => {
    guard = null;
    if (!quitting) setTimeout(startGuard, 2000);
  });
}

function onBlocked(kind, name) {
  state(); // rolls the daily counter over if needed
  stats.blocks += 1;
  saveJson(STATS_PATH, stats);
  broadcast();
  for (const w of wallpapers) if (!w.isDestroyed()) w.webContents.send("anger", 2600);
  if (kind === "site") {
    // guard.ps1 reports the lowercased keyword; show it as the user typed it.
    const site = config.blockedSites.find((s) => s.toLowerCase() === name) || name;
    showToast(`"${site}" 사이트 차단됨`);
  } else {
    showToast(`${name} 강제 종료됨`);
  }
}

function showToast(text) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 560;
  const height = 300;
  if (!toastWin || toastWin.isDestroyed()) {
    toastWin = new BrowserWindow({
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + workArea.height * 0.16),
      show: false,
      frame: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    toastWin.setAlwaysOnTop(true, "screen-saver");
    toastWin.setIgnoreMouseEvents(true);
    toastWin.loadFile(path.join(__dirname, "renderer", "toast.html"));
  }
  const send = () => {
    toastWin.webContents.send("toast", { text, message: config.message });
    toastWin.showInactive();
    lastCursor = null; // push the cursor position to the fresh overlay
  };
  if (toastWin.webContents.isLoading()) toastWin.webContents.once("did-finish-load", send);
  else send();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastWin && !toastWin.isDestroyed() && toastWin.hide(), 3300);
}

// ---------- cursor feed ----------

// The wallpaper sits behind the desktop icons and gets no mouse events, so
// poll the cursor and push it (relative to each window) for the eye to follow.
let lastCursor = null;
function pushCursor() {
  const p = screen.getCursorScreenPoint();
  if (lastCursor && p.x === lastCursor.x && p.y === lastCursor.y) return;
  lastCursor = p;
  const targets = wallpapers.map((w) => [w, w.__bounds]);
  if (toastWin && !toastWin.isDestroyed() && toastWin.isVisible()) {
    targets.push([toastWin, toastWin.getBounds()]);
  }
  for (const [w, b] of targets) {
    if (!w.isDestroyed() && b) w.webContents.send("cursor", { x: p.x - b.x, y: p.y - b.y });
  }
}

// ---------- settings / tray ----------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 820,
    minWidth: 420,
    title: "공부모드 배경화면 설정",
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: "#0d1220",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.webContents.on("did-finish-load", () => settingsWin.webContents.send("state", state()));
  settingsWin.on("closed", () => (settingsWin = null));
}

function updateTray() {
  if (!tray) return;
  const locked = isLocked();
  const es = examStatus(config);
  tray.setToolTip(
    `공부모드 배경화면${es ? ` · ${es.big} ${es.label}` : ""}${locked ? " · 잠금 중" : ""}`
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "설정 열기", click: openSettings },
      { label: "배경화면 다시 붙이기", click: () => createWallpapers() },
      { type: "separator" },
      locked
        ? { label: `잠금 중 — ${lockEndDate()} 까지 종료 불가`, enabled: false }
        : { label: "종료", click: () => app.quit() },
    ])
  );
}

// The lock runs to the end of the exam period.
function lockEndDate() {
  return config.examEndDate || config.examDate;
}

function applyAutostart() {
  if (!IS_WIN || !app.isPackaged) return;
  // Portable builds unpack to a temp dir each run; register the real .exe.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({
    openAtLogin: !!config.autostart || isLocked(),
    path: exe,
    args: ["--startup"],
  });
}

// ---------- IPC ----------

ipcMain.handle("get-state", () => state());

ipcMain.handle("save-config", (_e, incoming) => {
  const next = {
    ...config,
    blockedApps: cleanList(incoming.blockedApps),
    blockedSites: cleanList(incoming.blockedSites),
    examDate: String(incoming.examDate || ""),
    examEndDate: String(incoming.examEndDate || ""),
    message: String(incoming.message || "").slice(0, 200),
    autostart: !!incoming.autostart,
  };
  if (isLocked()) {
    // While locked you can only make things stricter.
    next.blockedApps = cleanList([...config.blockedApps, ...next.blockedApps]);
    next.blockedSites = cleanList([...config.blockedSites, ...next.blockedSites]);
    next.autostart = true;
    const end = lockEndDate();
    if ((next.examEndDate || next.examDate || "") < end) next.examEndDate = end;
  }
  config = next;
  saveJson(CONFIG_PATH, config);
  applyAutostart();
  broadcast();
  return state();
});

ipcMain.handle("lock", async () => {
  const end = lockEndDate();
  if (!end) return { error: "시험 날짜를 먼저 저장해 주세요." };
  const until = new Date(end + "T23:59:59");
  if (until.getTime() <= Date.now()) return { error: "시험 날짜가 이미 지났어요." };
  const { response } = await dialog.showMessageBox(settingsWin, {
    type: "warning",
    buttons: ["잠그기", "취소"],
    defaultId: 1,
    cancelId: 1,
    title: "정말 잠글까요?",
    message: `시험 끝나는 날(${end}) 23:59 까지 잠급니다.`,
    detail:
      "잠금 중에는 종료할 수 없고, 차단 목록에서 빼거나 끝나는 날을 앞당길 수 없어요. " +
      "(추가는 가능) 윈도우를 켜면 자동으로 다시 실행됩니다.",
  });
  if (response !== 0) return state();
  config.lockUntil = until.toISOString();
  config.autostart = true;
  saveJson(CONFIG_PATH, config);
  applyAutostart();
  broadcast();
  return state();
});

ipcMain.handle("list-running", () => {
  if (!IS_WIN) return [];
  const cmd =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    "Get-Process | Where-Object { $_.MainWindowTitle } | " +
    "Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { windowsHide: true, encoding: "utf8" },
      (err, stdout) => {
        try {
          const rows = [].concat(JSON.parse(stdout || "[]"));
          const self = path.basename(process.execPath, ".exe").toLowerCase();
          resolve(
            rows
              .filter((r) => r.ProcessName.toLowerCase() !== self)
              .map((r) => ({ name: r.ProcessName, title: r.MainWindowTitle }))
          );
        } catch {
          resolve([]);
        }
      }
    );
  });
});

ipcMain.handle("reattach", () => createWallpapers());

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openSettings);

  app.whenReady().then(() => {
    if (!fs.existsSync(CONFIG_PATH)) saveJson(CONFIG_PATH, config);
    applyAutostart();

    tray = new Tray(nativeImage.createFromPath(ICON_PATH));
    tray.on("click", openSettings);
    updateTray();

    createWallpapers();
    startGuard();

    let debounce = null;
    const rebuild = () => {
      clearTimeout(debounce);
      debounce = setTimeout(createWallpapers, 1000);
    };
    screen.on("display-added", rebuild);
    screen.on("display-removed", rebuild);
    screen.on("display-metrics-changed", rebuild);

    // Refresh the tray/wallpaper at midnight-ish and when the lock expires.
    setInterval(broadcast, 60 * 1000);
    setInterval(pushCursor, 33);

    if (!process.argv.includes("--startup")) openSettings();
  });

  // Closing the settings window must not quit the app.
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    quitting = true;
    if (guard) guard.kill();
  });
}
