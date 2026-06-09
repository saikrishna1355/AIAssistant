require('dotenv').config();
const fs = require('fs');
const path = require('path');
const electron = require('electron');

if (!electron || !electron.app) {
  const startupMessage = [
    `${new Date().toISOString()} [main] electron_bootstrap_failed ${JSON.stringify({
      electronType: typeof electron,
      electronValue: typeof electron === 'string' ? electron : '[object]',
      ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || '',
      message: 'Electron app API is unavailable. Remove ELECTRON_RUN_AS_NODE before launching the desktop app.'
    })}`
  ].join('\n');

  console.error(startupMessage);

  try {
    fs.appendFileSync(path.join(process.cwd(), 'electron-startup.log'), `${startupMessage}\n`);
  } catch (error) {
    console.warn('Failed to write electron startup log:', error.message);
  }

  process.exit(1);
}

const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, desktopCapturer } = electron;
const { InterviewCopilot } = require('./services/interview-copilot');

if (process.platform === 'win32' && process.env.DISABLE_OVERLAY_GPU !== 'false') {
  app.disableHardwareAcceleration();
}

let mainWindow;
let overlayWindow;
let tray;
let copilot;
let overlayStatePath;

function safeJson(details = {}) {
  try {
    return JSON.stringify(details, (key, value) => {
      const loweredKey = key.toLowerCase();
      if (
        loweredKey.includes('secret') ||
        loweredKey.includes('token') ||
        loweredKey.includes('password') ||
        loweredKey.includes('credential') ||
        loweredKey.includes('accesskey')
      ) {
        return '[redacted]';
      }

      if (Buffer.isBuffer(value)) {
        return `[buffer:${value.length}]`;
      }

      if (typeof value === 'string') {
        const maxLength = loweredKey.includes('stack') ? 4000 : loweredKey.includes('message') ? 1200 : 300;
        if (value.length > maxLength) {
          return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
        }
      }

      return value;
    });
  } catch (error) {
    return JSON.stringify({ loggingError: error.message });
  }
}

function getAppLogPath() {
  const logDir = app.isReady() ? app.getPath('userData') : __dirname;
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, 'main.log');
}

function getCopilot() {
  if (!copilot) {
    process.env.SCREENSHOT_TEMP_DIR = path.join(app.getPath('userData'), 'screenshots');
    copilot = new InterviewCopilot();
    if (copilot.screenCapture && typeof copilot.screenCapture.setElectronCaptureProvider === 'function') {
      copilot.screenCapture.setElectronCaptureProvider(captureScreenWithElectron);
    }
    writeAppLog('copilot_initialized', {
      screenshotTempDir: process.env.SCREENSHOT_TEMP_DIR
    });
  }

  return copilot;
}

function writeAppLog(eventName, details = {}) {
  const line = `${new Date().toISOString()} [main] ${eventName} ${safeJson(details)}`;
  console.log(line);

  try {
    fs.appendFileSync(getAppLogPath(), `${line}\n`);
  } catch (error) {
    console.warn('Failed to write app log:', error.message);
  }
}

function writeAppError(eventName, error, details = {}) {
  writeAppLog(eventName, {
    ...details,
    errorMessage: error && error.message ? error.message : String(error),
    errorStack: error && error.stack ? error.stack : null
  });
}

process.on('uncaughtException', (error) => {
  writeAppError('uncaught_exception', error);
});

process.on('unhandledRejection', (reason) => {
  writeAppError('unhandled_rejection', reason);
});

process.on('warning', (warning) => {
  writeAppError('process_warning', warning, {
    warningName: warning.name
  });
});

process.on('exit', (code) => {
  writeAppLog('process_exit', { code });
});

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
  writeAppLog('tray_created');
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
  writeAppLog('main_window_create_requested');
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

  writeAppLog('main_window_created', {
    bounds: mainWindow.getBounds(),
    alwaysOnTop: process.env.ALWAYS_ON_TOP === 'true'
  });

  const mainFile = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(mainFile).catch((error) => {
    writeAppError('main_window_load_rejected', error, { file: mainFile });
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    writeAppLog('main_window_did_fail_load', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });
  mainWindow.webContents.on('did-finish-load', () => {
    writeAppLog('main_window_did_finish_load');
  });
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    writeAppLog('main_window_render_process_gone', details);
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Store reference for IPC communication
  global.mainWindow = mainWindow;

  mainWindow.on('closed', () => {
    writeAppLog('main_window_closed');
    mainWindow = null;
    global.mainWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    writeAppLog('overlay_window_existing_show');
    overlayWindow.show();
    overlayWindow.focus();
    overlayWindow.moveTop();
    saveOverlayState({ visible: true });
    return overlayWindow;
  }

  const overlayState = loadOverlayState();
  const useTransparentOverlay = process.env.OVERLAY_TRANSPARENT === 'true' || (
    process.platform !== 'win32' && process.env.OVERLAY_TRANSPARENT !== 'false'
  );
  const overlayBackgroundColor = useTransparentOverlay ? '#00000000' : '#101827';

  writeAppLog('overlay_window_create_requested', {
    bounds: overlayState.bounds,
    opacity: overlayState.opacity,
    preferences: overlayState.preferences,
    transparent: useTransparentOverlay,
    backgroundColor: overlayBackgroundColor,
    platform: process.platform
  });

  const windowOptions = {
    ...overlayState.bounds,
    minWidth: 420,
    minHeight: 420,
    title: 'Interview Copilot Overlay',
    frame: false,
    transparent: useTransparentOverlay,
    backgroundColor: overlayBackgroundColor,
    show: false,
    paintWhenInitiallyHidden: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'overlay-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  };

  overlayWindow = new BrowserWindow(windowOptions);

  writeAppLog('overlay_window_created', {
    bounds: overlayWindow.getBounds(),
    transparent: useTransparentOverlay
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setBackgroundColor(overlayBackgroundColor);

  overlayWindow.setOpacity(overlayState.opacity);
  overlayWindow.setIgnoreMouseEvents(false);
  const overlayFile = path.join(__dirname, 'renderer', 'overlay.html');
  overlayWindow.loadFile(overlayFile).catch((error) => {
    writeAppError('overlay_window_load_rejected', error, { file: overlayFile });
  });
  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    writeAppLog('overlay_window_did_fail_load', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });
  overlayWindow.webContents.on('did-finish-load', () => {
    writeAppLog('overlay_window_did_finish_load');
    overlayWindow.showInactive();
    overlayWindow.moveTop();
    overlayWindow.webContents.invalidate();
    setTimeout(() => logOverlayCaptureDiagnostics(), 500);
  });
  overlayWindow.webContents.on('render-process-gone', (event, details) => {
    writeAppLog('overlay_window_render_process_gone', details);
  });

  overlayWindow.on('move', () => saveOverlayState({ bounds: overlayWindow.getBounds() }));
  overlayWindow.on('resize', () => saveOverlayState({ bounds: overlayWindow.getBounds() }));
  overlayWindow.once('ready-to-show', () => {
    writeAppLog('overlay_window_ready_to_show', {
      visible: overlayWindow.isVisible(),
      opacity: overlayWindow.getOpacity(),
      bounds: overlayWindow.getBounds()
    });
    overlayWindow.showInactive();
    overlayWindow.moveTop();
  });
  overlayWindow.on('show', () => saveOverlayState({ visible: true, bounds: overlayWindow.getBounds() }));
  overlayWindow.on('hide', () => saveOverlayState({ visible: false, bounds: overlayWindow.getBounds() }));

  overlayWindow.on('closed', () => {
    writeAppLog('overlay_window_closed');
    saveOverlayState({ visible: false });
    overlayWindow = null;
    global.overlayWindow = null;
  });

  global.overlayWindow = overlayWindow;
  overlayWindow.webContents.once('did-finish-load', sendOverlayPreferences);
  return overlayWindow;
}

async function logOverlayCaptureDiagnostics() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  try {
    const image = await overlayWindow.webContents.capturePage();
    const size = image.getSize();
    const bitmap = image.toBitmap();
    let nonTransparentPixels = 0;
    let sampledPixels = 0;

    for (let index = 3; index < bitmap.length; index += 16) {
      sampledPixels += 1;
      if (bitmap[index] > 0) {
        nonTransparentPixels += 1;
      }
    }

    writeAppLog('overlay_capture_diagnostics', {
      size,
      sampledPixels,
      nonTransparentPixels,
      visible: overlayWindow.isVisible(),
      focused: overlayWindow.isFocused(),
      opacity: overlayWindow.getOpacity(),
      bounds: overlayWindow.getBounds()
    });
  } catch (error) {
    writeAppError('overlay_capture_diagnostics_failed', error);
  }
}

async function captureScreenWithElectron(displayId = undefined) {
  const displays = screen.getAllDisplays();
  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = displayId
    ? displays.find((display) => String(display.id) === String(displayId))
    : screen.getDisplayNearestPoint(cursorPoint);
  const display = targetDisplay || screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor))
  };

  writeAppLog('electron_screen_capture_requested', {
    displayId: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    thumbnailSize
  });

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false
  });

  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Electron desktopCapturer returned an empty screen thumbnail');
  }

  const img = source.thumbnail.toPNG();
  if (!img || img.length === 0) {
    throw new Error('Electron desktopCapturer returned an empty PNG buffer');
  }

  const screenshotDir = process.env.SCREENSHOT_TEMP_DIR || path.join(app.getPath('userData'), 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const filepath = path.join(screenshotDir, `screenshot_${Date.now()}_electron.png`);
  fs.writeFileSync(filepath, img);

  writeAppLog('electron_screen_capture_success', {
    filepath,
    bytes: img.length,
    sourceId: source.id,
    displayId: source.display_id
  });

  return {
    path: filepath,
    buffer: img,
    timestamp: new Date().toISOString(),
    source: 'electron-desktopCapturer'
  };
}

function toggleOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    writeAppLog('overlay_window_toggle_hide');
    overlayWindow.hide();
    return { success: true, visible: false };
  }

  writeAppLog('overlay_window_toggle_show');
  createOverlayWindow();
  return { success: true, visible: true };
}

app.whenReady().then(() => {
  writeAppLog('app_ready', {
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    userData: app.getPath('userData'),
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    awsRegion: process.env.AWS_REGION || '',
    transcribeRegion: process.env.TRANSCRIBE_REGION || process.env.AWS_REGION || '',
    bedrockModelConfigured: Boolean(process.env.BEDROCK_MODEL_ID || process.env.BEDROCK_MODEL),
    inferenceProfileConfigured: Boolean(process.env.BEDROCK_INFERENCE_PROFILE_ID)
  });

  try {
    getCopilot();
    createWindow();
    createTray();

    const shortcuts = [
      ['CommandOrControl+Shift+O', toggleOverlayWindow],
      ['CommandOrControl+Shift+F', () => toggleOverlayPreference('focus')],
      ['CommandOrControl+Shift+D', () => cycleOverlayDock()],
      ['CommandOrControl+Shift+M', () => moveOverlayToNextDisplay()]
    ];

    shortcuts.forEach(([accelerator, callback]) => {
      const registered = globalShortcut.register(accelerator, callback);
      writeAppLog('global_shortcut_registered', { accelerator, registered });
    });

    if (loadOverlayState().visible) {
      createOverlayWindow();
    }
  } catch (error) {
    writeAppError('app_ready_startup_failed', error);
    throw error;
  }
});

app.on('will-quit', () => {
  writeAppLog('app_will_quit');
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  writeAppLog('window_all_closed', {
    platform: process.platform,
    trayExists: Boolean(tray)
  });
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});

app.on('activate', () => {
  writeAppLog('app_activate', {
    windowCount: BrowserWindow.getAllWindows().length
  });
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('render-process-gone', (event, webContents, details) => {
  writeAppLog('render_process_gone', {
    url: webContents ? webContents.getURL() : '',
    details
  });
});

app.on('child-process-gone', (event, details) => {
  writeAppLog('child_process_gone', details);
});

app.on('gpu-process-crashed', (event, killed) => {
  writeAppLog('gpu_process_crashed', { killed });
});

app.on('web-contents-created', (event, contents) => {
  contents.on('console-message', (consoleEvent, level, message, line, sourceId) => {
    if (level < 2) {
      return;
    }

    writeAppLog('renderer_console_message', {
      level,
      message,
      line,
      sourceId,
      url: contents.getURL()
    });
  });

  contents.on('did-fail-load', (loadEvent, errorCode, errorDescription, validatedURL) => {
    writeAppLog('webcontents_did_fail_load', {
      errorCode,
      errorDescription,
      validatedURL,
      url: contents.getURL()
    });
  });
});

function handleIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    const startedAt = Date.now();
    writeAppLog('ipc_start', {
      channel,
      senderUrl: event.sender ? event.sender.getURL() : '',
      argCount: args.length
    });

    try {
      const result = await handler(event, ...args);
      writeAppLog('ipc_success', {
        channel,
        durationMs: Date.now() - startedAt,
        resultSuccess: result && typeof result === 'object' && 'success' in result ? result.success : null
      });
      return result;
    } catch (error) {
      writeAppError('ipc_failed', error, {
        channel,
        durationMs: Date.now() - startedAt
      });
      return { success: false, message: error.message || 'IPC handler failed' };
    }
  });
}

// IPC handlers
handleIpc('start-listening', async () => {
  const result = await getCopilot().startListening();
  if (result.success) {
    createOverlayWindow();
  }
  return result;
});

handleIpc('stop-listening', async () => {
  return await getCopilot().stopListening();
});

handleIpc('take-screenshot', async () => {
  return await getCopilot().takeScreenshot();
});

handleIpc('check-screenshot-permissions', async () => {
  if (process.platform === 'win32') {
    try {
      const copilot = getCopilot();
      const diagnosis = await copilot.screenCapture.diagnoseWindowsIssues();
      return {
        success: true,
        platform: 'win32',
        diagnosis
      };
    } catch (error) {
      return {
        success: false,
        message: 'Permission check failed',
        error: error.message
      };
    }
  } else {
    return {
      success: true,
      platform: process.platform,
      message: 'Permission check not needed for this platform'
    };
  }
});

handleIpc('fix-screenshot-permissions', async () => {
  if (process.platform === 'win32') {
    try {
      const copilot = getCopilot();
      return await copilot.screenCapture.fixWindowsPermissions();
    } catch (error) {
      return {
        success: false,
        message: 'Permission fix failed',
        error: error.message
      };
    }
  } else {
    return {
      success: true,
      message: 'Permission fix not needed for this platform'
    };
  }
});

handleIpc('generate-answer', async (event, question, type) => {
  return await getCopilot().generateAnswer(question, type);
});

handleIpc('debug-code', async (event, input) => {
  return await getCopilot().debugCode(input);
});

handleIpc('open-overlay', async () => {
  createOverlayWindow();
  return { success: true };
});

handleIpc('close-overlay', async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return { success: true };
});

handleIpc('minimize-overlay', async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return { success: true };
});

handleIpc('toggle-overlay', async () => {
  return toggleOverlayWindow();
});

handleIpc('overlay-set-opacity', async (event, opacity) => {
  const nextOpacity = Math.min(1, Math.max(0.15, Number(opacity) || 0.88));

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(nextOpacity);
  }

  saveOverlayState({ opacity: nextOpacity });
  return { success: true, opacity: nextOpacity };
});

handleIpc('overlay-renderer-log', async (event, eventName, details = {}) => {
  writeAppLog(eventName || 'overlay_renderer_log', {
    senderUrl: event.sender ? event.sender.getURL() : '',
    ...details
  });
  return { success: true };
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

handleIpc('overlay-update-preferences', async (event, patch) => {
  return updateOverlayPreferences(patch);
});

handleIpc('overlay-dock', async (event, side) => {
  return dockOverlay(side);
});

handleIpc('overlay-next-display', async () => {
  return moveOverlayToNextDisplay();
});

handleIpc('overlay-get-state', async () => {
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
