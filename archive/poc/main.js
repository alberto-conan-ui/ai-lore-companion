const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { readChain } = require('./lore');

function parseArgs(argv) {
  const args = argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && i + 1 < args.length) {
      root = path.resolve(args[i + 1]);
      i++;
    } else if (!args[i].startsWith('-')) {
      root = path.resolve(args[i]);
      break;
    }
  }
  return { root };
}

function statePath() {
  return path.join(app.getPath('userData'), 'cockpit-state.json');
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.byRoot && typeof parsed.byRoot === 'object') {
      return parsed;
    }
  } catch (e) {
    // missing file or invalid JSON — start fresh
  }
  return { byRoot: {} };
}

function saveState(state) {
  try {
    const file = statePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error(`[ai-lore-companion] Failed to persist state: ${e.message}`);
  }
}

let seqCounter = 0;
function nextId() {
  return `${Date.now()}-${seqCounter++}`;
}

function startWatcher(root, win, state) {
  const watcher = chokidar.watch(root, {
    ignored: [
      '**/upstream/**',
      '**/process/**',
      '**/.git/**',
      '**/node_modules/**',
    ],
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  const projectQueue = state.byRoot[root];

  const emit = (type) => (absPath) => {
    if (win.isDestroyed()) return;
    const relPath = path.relative(root, absPath);
    const oldIdx = projectQueue.findIndex((e) => e.relPath === relPath);
    let replaces = null;
    if (oldIdx >= 0) {
      replaces = projectQueue[oldIdx].id;
      projectQueue.splice(oldIdx, 1);
    }
    const entry = {
      id: nextId(),
      type,
      relPath,
      absPath,
      ts: Date.now(),
    };
    projectQueue.push(entry);
    saveState(state);
    win.webContents.send('change', { ...entry, replaces });
  };

  watcher.on('add', emit('add'));
  watcher.on('change', emit('change'));
  watcher.on('unlink', emit('unlink'));
  watcher.on('error', (err) => {
    console.error(`[ai-lore-companion] watcher error: ${err.message}`);
  });

  win.on('closed', () => watcher.close());
  return watcher;
}

function setupAck(state) {
  ipcMain.on('ack', (_e, { root, id }) => {
    const projectQueue = state.byRoot[root];
    if (!projectQueue) return;
    const idx = projectQueue.findIndex((e) => e.id === id);
    if (idx >= 0) {
      projectQueue.splice(idx, 1);
      saveState(state);
    }
  });

  ipcMain.on('ack-all', (_e, { root }) => {
    const projectQueue = state.byRoot[root];
    if (!projectQueue) return;
    projectQueue.length = 0;
    saveState(state);
  });
}

function createWindow(chain, state) {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('chain', chain);
    const projectQueue = state.byRoot[chain.root] || (state.byRoot[chain.root] = []);
    win.webContents.send('restore', { root: chain.root, queue: projectQueue.slice() });
    startWatcher(chain.root, win, state);
  });
}

app.whenReady().then(() => {
  const { root } = parseArgs(process.argv);
  const chain = readChain(root);

  if (chain.error) {
    console.error(`[ai-lore-companion] ${chain.error}`);
    app.exit(1);
    return;
  }

  const state = loadState();
  if (!state.byRoot[chain.root]) state.byRoot[chain.root] = [];

  setupAck(state);
  createWindow(chain, state);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(chain, state);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
