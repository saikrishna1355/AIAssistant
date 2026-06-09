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
  privacyBtn: document.getElementById('overlay-privacy'),
  focusBtn: document.getElementById('overlay-focus'),
  themeBtn: document.getElementById('overlay-theme'),
  dockBtn: document.getElementById('overlay-dock'),
  monitorBtn: document.getElementById('overlay-monitor'),
  closeBtn: document.getElementById('close-overlay'),
  minimizeBtn: document.getElementById('minimize-overlay')
};

const overlayState = {
  privacy: false,
  focus: false,
  theme: 'dark',
  dock: 'floating'
};

if (!api) {
  document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#111827;font-family:Segoe UI,Arial,sans-serif">Overlay failed to initialize: preload bridge is unavailable. Rebuild and reinstall the desktop app.</div>';
  throw new Error('Overlay preload bridge is unavailable');
}

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

  document.body.classList.toggle('privacy-mode', overlayState.privacy);
  document.body.classList.toggle('focus-mode', overlayState.focus);
  document.body.classList.toggle('theme-light', overlayState.theme === 'light');
  document.body.dataset.dock = overlayState.dock;

  elements.privacyBtn.classList.toggle('active', overlayState.privacy);
  elements.focusBtn.classList.toggle('active', overlayState.focus);
  elements.themeBtn.textContent = overlayState.theme === 'light' ? 'Dark' : 'Light';
  elements.dockBtn.textContent = overlayState.dock === 'floating' ? 'Dock' : `Dock: ${overlayState.dock}`;

  if (preferences.opacity) {
    applyOpacity(preferences.opacity);
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

elements.privacyBtn.addEventListener('click', () => {
  updatePreferences({ privacy: !overlayState.privacy });
});

elements.focusBtn.addEventListener('click', () => {
  updatePreferences({ focus: !overlayState.focus });
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

elements.monitorBtn.addEventListener('click', async () => {
  await api.invoke('overlay-next-display');
});

api.invoke('overlay-get-state').then((state) => {
  if (state.success) {
    applyPreferences({
      ...state.preferences,
      opacity: state.opacity
    });
  }
});
