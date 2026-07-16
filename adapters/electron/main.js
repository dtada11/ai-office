/**
 * Electron desktop shell — Stage 0 PoC.
 *
 * The office already runs as a standalone Fastify + WebSocket server
 * (`dist/cli.js`) that a browser talks to over WebSocket. This shell adds
 * nothing to that: it starts the exact same server as a child Node process
 * (via ELECTRON_RUN_AS_NODE) and points an app window at it. No preload, no
 * IPC — the window is a browser tab, so the standalone WebSocket path is
 * reused unchanged. Packaging/in-process bootstrap comes in a later stage.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'dist', 'cli.js');
const SERVER_JSON = path.join(os.homedir(), '.pixel-agents', 'server.json');

/** The child process running dist/cli.js, or null before it starts. */
let serverProcess = null;
/** The office window; hidden (not destroyed) when the user closes it. */
let mainWindow = null;
/** Tray icon; the office keeps running here after the window is closed. */
let tray = null;
/** The port the running server advertised, so we can reopen the window. */
let currentPort = null;
/** True only while really quitting, so the close handler lets the window die. */
let isQuitting = false;

/** Start dist/cli.js as a plain Node child using Electron's bundled Node. */
function startServer() {
  serverProcess = spawn(process.execPath, [CLI_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code) => {
    console.log(`[electron] server exited (code ${code})`);
    serverProcess = null;
  });
}

/** Read the port the server advertised in ~/.pixel-agents/server.json. */
function readServerPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8'));
    return typeof cfg.port === 'number' ? cfg.port : null;
  } catch {
    return null;
  }
}

/** Resolve once the server answers an HTTP request on its advertised port. */
function waitForServer({ timeoutMs = 20000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const port = readServerPort();
      if (port) {
        const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          res.resume();
          resolve(port);
        });
        req.on('error', retry);
        req.setTimeout(1000, () => req.destroy());
      } else {
        retry();
      }
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error('server did not become ready in time'));
      } else {
        setTimeout(attempt, intervalMs);
      }
    };
    attempt();
  });
}

const ICON = nativeImage.createFromPath(path.join(REPO_ROOT, 'icon.png'));

function createWindow(port) {
  currentPort = port;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'AI 오피스',
    icon: ICON,
    backgroundColor: '#1e1e1e',
  });
  mainWindow.setMenuBarVisibility(false);
  // Links that would open new windows go to the system browser instead — but
  // only http(s). Handing an arbitrary scheme (file:, smb:, ...) to the OS via
  // openExternal could launch a local handler with an attacker-influenced path;
  // restrict it to web URLs.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url);
    } catch {
      // Malformed URL — ignore.
    }
    return { action: 'deny' };
  });
  // Closing the window hides it — the office keeps running in the tray. Only a
  // real quit (tray menu → 종료) lets the window be destroyed.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

/** Show the office window, recreating it if it was destroyed. */
function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else if (currentPort) {
    createWindow(currentPort);
  }
}

/** Register (or clear) the app as a login item so the office starts at boot. */
function setAutoStart(enabled) {
  // Packaged: execPath is the app's own exe. In dev it's electron.exe, so pass
  // the script path as an arg or auto-start would launch a bare Electron.
  const opts = app.isPackaged
    ? { openAtLogin: enabled }
    : { openAtLogin: enabled, path: process.execPath, args: [path.resolve(__dirname, 'main.js')] };
  app.setLoginItemSettings(opts);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '오피스 열기', click: showWindow },
    { type: 'separator' },
    {
      label: '부팅 시 자동 시작',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        setAutoStart(item.checked);
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(ICON.resize({ width: 16, height: 16 }));
  tray.setToolTip('AI 오피스');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

// One instance owns the server; a second launch just exits (the running one
// already holds the window). Mirrors the server's own server.json reuse.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch (e.g. the boot login item after one is already up) just
  // surfaces the running window instead of starting a second office.
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    startServer();
    createTray();
    try {
      const port = await waitForServer();
      createWindow(port);
    } catch (err) {
      console.error('[electron]', err.message);
      isQuitting = true;
      app.quit();
    }
  });

  // No window-all-closed → quit: closing the window drops to the tray and the
  // office keeps running. Quitting happens only via the tray's 종료.

  app.on('will-quit', () => {
    if (serverProcess) serverProcess.kill();
  });
}
