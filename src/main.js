require('dotenv').config();
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { InterviewCopilot } = require('./services/interview-copilot');

let mainWindow;
let overlayWindow;
let tray;
let copilot;
let overlayStatePath;

function getOverlayStatePath() {
  if (!overlayStatePath) {
    overlayStatePath = path.join(app.getPath('userData'), 'overlay-state.json');
  }

  return overlayStatePath;
}

function getDefaultOverlayBounds() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;

  return {
    width: 520,
    height: 680,
    x: Math.max(20, width - 545),
    y: 24
  };
}

function loadOverlayState() {
  const defaults = {
    bounds: getDefaultOverlayBounds(),
    visible: false,
    opacity: Number(process.env.OVERLAY_OPACITY || 0.88),
    preferences: {
      privacy: false,
      focus: false,
      theme: 'dark',
      dock: 'floating'
    }
  };

  try {
    if (!fs.existsSync(getOverlayStatePath())) {
      return defaults;
    }

    const parsed = JSON.parse(fs.readFileSync(getOverlayStatePath(), 'utf8'));
    return {
      ...defaults,
      ...parsed,
      bounds: {
        ...defaults.bounds,
        ...(parsed.bounds || {})
      },
      preferences: {
        ...defaults.preferences,
        ...(parsed.preferences || {})
      }
    };
  } catch (error) {
    console.warn('Failed to read overlay state:', error.message);
    return defaults;
  }
}

function createTray() {
  if (tray) {
    return tray;
  }

  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAI0lEQVR4AWP4//8/AyUYTFhYGJqampjQNNRAqgGqGqAaAAC3FQMIkQJY5QAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon);
  tray.setToolTip('Interview Copilot AI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Main App', click: () => mainWindow ? mainWindow.show() : createWindow() },
    { label: 'Toggle Overlay', accelerator: 'Ctrl+Shift+O', click: toggleOverlayWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
  tray.on('click', toggleOverlayWindow);
  return tray;
}

function sendOverlayPreferences() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const state = loadOverlayState();
  overlayWindow.webContents.send('overlay-preferences', {
    opacity: state.opacity,
    ...state.preferences
  });
}

function saveOverlayState(patch = {}) {
  const currentState = loadOverlayState();
  const nextState = {
    ...currentState,
    ...patch
  };

  try {
    fs.writeFileSync(getOverlayStatePath(), JSON.stringify(nextState, null, 2));
  } catch (error) {
    console.warn('Failed to save overlay state:', error.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    title: 'Interview Copilot AI',
    alwaysOnTop: process.env.ALWAYS_ON_TOP === 'true',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  copilot = new InterviewCopilot();
  
  // Store reference for IPC communication
  global.mainWindow = mainWindow;

  mainWindow.on('closed', () => {
    mainWindow = null;
    global.mainWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    saveOverlayState({ visible: true });
    return overlayWindow;
  }

  const overlayState = loadOverlayState();

  overlayWindow = new BrowserWindow({
    ...overlayState.bounds,
    minWidth: 420,
    minHeight: 420,
    title: 'Interview Copilot Overlay',
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'overlay-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Content protection only works on macOS and Windows.
  // On Linux the compositor does not support this API.
  if (process.platform !== 'linux') {
    overlayWindow.setContentProtection(true);
  }

  overlayWindow.setOpacity(overlayState.opacity);
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  overlayWindow.on('move', () => saveOverlayState({ bounds: overlayWindow.getBounds() }));
  overlayWindow.on('resize', () => saveOverlayState({ bounds: overlayWindow.getBounds() }));
  overlayWindow.on('show', () => saveOverlayState({ visible: true, bounds: overlayWindow.getBounds() }));
  overlayWindow.on('hide', () => saveOverlayState({ visible: false, bounds: overlayWindow.getBounds() }));

  overlayWindow.on('closed', () => {
    saveOverlayState({ visible: false });
    overlayWindow = null;
    global.overlayWindow = null;
  });

  global.overlayWindow = overlayWindow;
  overlayWindow.webContents.once('did-finish-load', sendOverlayPreferences);
  return overlayWindow;
}

function toggleOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
    return { success: true, visible: false };
  }

  createOverlayWindow();
  return { success: true, visible: true };
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+O', toggleOverlayWindow);
  globalShortcut.register('CommandOrControl+Shift+P', () => toggleOverlayPreference('privacy'));
  globalShortcut.register('CommandOrControl+Shift+F', () => toggleOverlayPreference('focus'));
  globalShortcut.register('CommandOrControl+Shift+D', () => cycleOverlayDock());
  globalShortcut.register('CommandOrControl+Shift+M', () => moveOverlayToNextDisplay());

  if (loadOverlayState().visible) {
    createOverlayWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle('start-listening', async () => {
  const result = await copilot.startListening();
  if (result.success) {
    createOverlayWindow();
  }
  return result;
});

ipcMain.handle('stop-listening', async () => {
  return await copilot.stopListening();
});

ipcMain.handle('take-screenshot', async () => {
  return await copilot.takeScreenshot();
});

ipcMain.handle('generate-answer', async (event, question, type) => {
  return await copilot.generateAnswer(question, type);
});

ipcMain.handle('debug-code', async (event, input) => {
  return await copilot.debugCode(input);
});

ipcMain.handle('open-overlay', async () => {
  createOverlayWindow();
  return { success: true };
});

ipcMain.handle('close-overlay', async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return { success: true };
});

ipcMain.handle('minimize-overlay', async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return { success: true };
});

ipcMain.handle('toggle-overlay', async () => {
  return toggleOverlayWindow();
});

ipcMain.handle('overlay-set-opacity', async (event, opacity) => {
  const nextOpacity = Math.min(1, Math.max(0.15, Number(opacity) || 0.88));

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(nextOpacity);
  }

  saveOverlayState({ opacity: nextOpacity });
  return { success: true, opacity: nextOpacity };
});

function updateOverlayPreferences(patch = {}) {
  const state = loadOverlayState();
  const preferences = {
    ...state.preferences,
    ...patch
  };

  saveOverlayState({ preferences });
  sendOverlayPreferences();
  return { success: true, preferences };
}

function toggleOverlayPreference(key) {
  const state = loadOverlayState();
  return updateOverlayPreferences({
    [key]: !state.preferences[key]
  });
}

function dockOverlay(side) {
  const win = createOverlayWindow();
  const display = screen.getDisplayMatching(win.getBounds());
  const workArea = display.workArea;
  let bounds;

  if (side === 'left') {
    bounds = { x: workArea.x, y: workArea.y, width: 420, height: workArea.height };
  } else if (side === 'right') {
    bounds = { x: workArea.x + workArea.width - 420, y: workArea.y, width: 420, height: workArea.height };
  } else {
    bounds = getDefaultOverlayBounds();
  }

  win.setBounds(bounds, true);
  saveOverlayState({
    bounds,
    preferences: {
      ...loadOverlayState().preferences,
      dock: side
    }
  });
  sendOverlayPreferences();
  return { success: true, dock: side };
}

function cycleOverlayDock() {
  const currentDock = loadOverlayState().preferences.dock;
  const nextDock = currentDock === 'floating' ? 'right' : currentDock === 'right' ? 'left' : 'floating';
  return dockOverlay(nextDock);
}

function moveOverlayToNextDisplay() {
  const win = createOverlayWindow();
  const displays = screen.getAllDisplays();

  if (displays.length < 2) {
    return { success: true, message: 'Only one display detected' };
  }

  const currentDisplay = screen.getDisplayMatching(win.getBounds());
  const currentIndex = displays.findIndex((display) => display.id === currentDisplay.id);
  const nextDisplay = displays[(currentIndex + 1) % displays.length];
  const currentBounds = win.getBounds();
  const nextBounds = {
    ...currentBounds,
    x: nextDisplay.workArea.x + Math.max(20, nextDisplay.workArea.width - currentBounds.width - 24),
    y: nextDisplay.workArea.y + 24
  };

  win.setBounds(nextBounds, true);
  saveOverlayState({ bounds: nextBounds });
  return { success: true, displayId: nextDisplay.id };
}

ipcMain.handle('overlay-update-preferences', async (event, patch) => {
  return updateOverlayPreferences(patch);
});

ipcMain.handle('overlay-dock', async (event, side) => {
  return dockOverlay(side);
});

ipcMain.handle('overlay-next-display', async () => {
  return moveOverlayToNextDisplay();
});

ipcMain.handle('overlay-get-state', async () => {
  const state = loadOverlayState();
  return {
    success: true,
    opacity: state.opacity,
    preferences: state.preferences,
    displays: screen.getAllDisplays().map((display) => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea
    }))
  };
});
