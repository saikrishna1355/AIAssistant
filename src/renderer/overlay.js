const api = window.overlayAPI;

const elements = {
  status: document.getElementById('overlay-status'),
  transcription: document.getElementById('overlay-transcription'),
  question: document.getElementById('overlay-question'),
  answer: document.getElementById('overlay-answer'),
  startBtn: document.getElementById('overlay-start'),
  stopBtn: document.getElementById('overlay-stop'),
  screenshotBtn: document.getElementById('overlay-screenshot'),
  opacity: document.getElementById('overlay-opacity'),
  focusBtn: document.getElementById('overlay-focus'),
  screenProtectBtn: document.getElementById('overlay-screen-protect'),
  themeBtn: document.getElementById('overlay-theme'),
  dockBtn: document.getElementById('overlay-dock'),
  closeBtn: document.getElementById('close-overlay'),
  minimizeBtn: document.getElementById('minimize-overlay')
};

const overlayState = {
  focus: false,
  screenProtection: true,
  theme: 'dark',
  dock: 'floating'
};

if (!api) {
  document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#111827;font-family:Segoe UI,Arial,sans-serif">Overlay failed to initialize: preload bridge is unavailable. Rebuild and reinstall the desktop app.</div>';
  throw new Error('Overlay preload bridge is unavailable');
}

function logOverlay(eventName, details = {}) {
  try {
    api.log(eventName, details);
  } catch (error) {
    console.error('Overlay log failed:', error);
  }
}

function collectRenderDiagnostics() {
  const shell = document.querySelector('.overlay-shell');
  const shellStyle = shell ? window.getComputedStyle(shell) : null;
  const bodyStyle = window.getComputedStyle(document.body);

  return {
    bodyTextLength: document.body.innerText.length,
    bodyClientWidth: document.body.clientWidth,
    bodyClientHeight: document.body.clientHeight,
    bodyBackground: bodyStyle.backgroundColor,
    shellExists: Boolean(shell),
    shellClientWidth: shell ? shell.clientWidth : 0,
    shellClientHeight: shell ? shell.clientHeight : 0,
    shellBackground: shellStyle ? shellStyle.backgroundImage || shellStyle.backgroundColor : '',
    shellDisplay: shellStyle ? shellStyle.display : '',
    shellOpacity: shellStyle ? shellStyle.opacity : '',
    devicePixelRatio: window.devicePixelRatio
  };
}

window.addEventListener('DOMContentLoaded', () => {
  logOverlay('overlay_dom_content_loaded', collectRenderDiagnostics());
});

window.addEventListener('load', () => {
  logOverlay('overlay_window_loaded', collectRenderDiagnostics());
});

window.addEventListener('error', (event) => {
  logOverlay('overlay_renderer_error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error && event.error.stack ? event.error.stack : null
  });
});

window.addEventListener('unhandledrejection', (event) => {
  logOverlay('overlay_renderer_unhandled_rejection', {
    reason: event.reason && event.reason.stack ? event.reason.stack : String(event.reason)
  });
});

function setText(element, text) {
  element.classList.remove('muted');
  element.textContent = text || '';
}

function setStatus(text, active = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('active', active);
  elements.startBtn.disabled = active;
  elements.stopBtn.disabled = !active;
}

function setBusy(button, busyText) {
  button.dataset.originalText = button.textContent;
  button.textContent = busyText;
  button.disabled = true;
}

function clearBusy(button) {
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

api.on('listening-status', (data) => {
  setStatus(data.listening ? 'Listening' : 'Stopped', data.listening);
  setText(elements.transcription, data.message || '');
});

api.on('transcription-update', (transcription) => {
  setStatus('Listening', true);
  setText(elements.transcription, transcription);
});

api.on('question-detected', (data) => {
  setText(elements.question, data.question);
  setText(elements.answer, 'Generating answer...');
});

api.on('answer-generated', (data) => {
  setText(elements.answer, data.answer);
});

api.on('overlay-preferences', (preferences) => {
  applyPreferences(preferences);
});

function applyPreferences(preferences = {}) {
  Object.assign(overlayState, preferences);

  document.body.classList.toggle('focus-mode', overlayState.focus);
  document.body.classList.toggle('screen-protected', overlayState.screenProtection);
  document.body.classList.toggle('theme-light', overlayState.theme === 'light');
  document.body.dataset.dock = overlayState.dock;

  // Set screen protection attribute
  document.documentElement.setAttribute('data-screen-protection', overlayState.screenProtection ? 'enabled' : 'disabled');

  elements.focusBtn.classList.toggle('active', overlayState.focus);
  elements.screenProtectBtn.classList.toggle('active', overlayState.screenProtection);
  elements.themeBtn.textContent = overlayState.theme === 'light' ? 'Dark' : 'Light';
  elements.dockBtn.textContent = overlayState.dock === 'floating' ? 'Dock' : `Dock: ${overlayState.dock}`;

  if (preferences.opacity) {
    applyOpacity(preferences.opacity);
  }

  // Apply screen protection measures
  if (overlayState.screenProtection) {
    enableScreenProtection();
  } else {
    disableScreenProtection();
  }
}

function enableScreenProtection() {
  // OS-level protection is handled by setContentProtection(true) in main process
  // This function now just handles UI indicators
  try {
    const indicator = document.querySelector('.screen-protection-indicator');
    if (!indicator) {
      const newIndicator = document.createElement('div');
      newIndicator.className = 'screen-protection-indicator';
      newIndicator.textContent = 'PROTECTED';
      newIndicator.title = 'Hidden from screen recordings';
      newIndicator.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(94,234,212,0.2);border:1px solid rgba(94,234,212,0.4);color:#5eead4;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:bold;z-index:10000;pointer-events:none;font-family:monospace;';
      document.body.appendChild(newIndicator);
    }
    
    logOverlay('screen_protection_ui_enabled');
  } catch (error) {
    logOverlay('screen_protection_ui_failed', { error: error.message });
  }
}

function disableScreenProtection() {
  try {
    const indicator = document.querySelector('.screen-protection-indicator');
    if (indicator) {
      indicator.remove();
    }
    
    logOverlay('screen_protection_ui_disabled');
  } catch (error) {
    logOverlay('screen_protection_ui_disable_failed', { error: error.message });
  }
}

function applyOpacity(opacity) {
  const value = Math.min(1, Math.max(0.15, Number(opacity) || 0.88));
  elements.opacity.value = value;
  document.documentElement.style.setProperty('--overlay-alpha', String(value));
}

async function updatePreferences(patch) {
  const result = await api.invoke('overlay-update-preferences', patch);
  if (result.success) {
    applyPreferences(result.preferences);
  }
}

elements.closeBtn.addEventListener('click', () => {
  api.invoke('close-overlay');
});

elements.minimizeBtn.addEventListener('click', () => {
  api.invoke('minimize-overlay');
});

elements.startBtn.addEventListener('click', async () => {
  setBusy(elements.startBtn, 'Starting...');
  const result = await api.invoke('start-listening');

  if (result.success) {
    setStatus('Listening', true);
    setText(elements.transcription, result.message || 'Listening for interview questions...');
  } else {
    setStatus('Stopped', false);
    setText(elements.transcription, result.message || 'Failed to start listening.');
  }

  elements.startBtn.textContent = 'Start Listening';
});

elements.stopBtn.addEventListener('click', async () => {
  setBusy(elements.stopBtn, 'Stopping...');
  const result = await api.invoke('stop-listening');
  setStatus('Stopped', false);
  setText(elements.transcription, result.message || 'Stopped listening.');
  elements.stopBtn.textContent = 'Stop';
});

elements.screenshotBtn.addEventListener('click', async () => {
  setBusy(elements.screenshotBtn, 'Reading...');
  const result = await api.invoke('take-screenshot');

  if (result.success) {
    setText(elements.question, result.extractedText || 'No readable text detected.');
    setText(elements.answer, result.solution || 'No solution generated.');
  } else {
    setText(elements.answer, result.message || 'Screen read failed.');
  }

  elements.screenshotBtn.textContent = 'Read Screen';
  elements.screenshotBtn.disabled = false;
});

elements.opacity.addEventListener('input', () => {
  applyOpacity(elements.opacity.value);
  api.invoke('overlay-set-opacity', elements.opacity.value);
});

elements.focusBtn.addEventListener('click', () => {
  updatePreferences({ focus: !overlayState.focus });
});

elements.screenProtectBtn.addEventListener('click', () => {
  updatePreferences({ screenProtection: !overlayState.screenProtection });
});

elements.themeBtn.addEventListener('click', () => {
  updatePreferences({ theme: overlayState.theme === 'dark' ? 'light' : 'dark' });
});

elements.dockBtn.addEventListener('click', async () => {
  const nextDock = overlayState.dock === 'floating' ? 'right' : overlayState.dock === 'right' ? 'left' : 'floating';
  const result = await api.invoke('overlay-dock', nextDock);
  if (result.success) {
    applyPreferences({ dock: result.dock });
  }
});

api.invoke('overlay-get-state').then((state) => {
  if (state.success) {
    applyPreferences({
      ...state.preferences,
      opacity: state.opacity
    });
    logOverlay('overlay_state_applied', collectRenderDiagnostics());
  }
}).catch((error) => {
  logOverlay('overlay_get_state_failed', {
    message: error.message,
    stack: error.stack
  });
});
