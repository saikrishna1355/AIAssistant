let ipcRenderer = null;

try {
  if (typeof require === 'function') {
    ({ ipcRenderer } = require('electron'));
  }
} catch (error) {
  ipcRenderer = null;
}

class InterviewCopilotUI {
  constructor() {
    this.questionCount = 0;
    this.sessionStartTime = null;
    this.sessionTimer = null;
    this.micStream = null;
    this.audioContext = null;
    this.audioProcessor = null;

    this.initializeElements();
    this.bindEvents();
    this.setupIPCHandlers();
    this.setStatus(ipcRenderer ? 'Desktop Ready' : 'Web Ready', ipcRenderer ? 'status-online' : 'status-online');
    this.setupSocketHandlers().finally(() => this.showStartupAudioHint());
    this.loadAppConfig();
  }

  initializeElements() {
    this.elements = {
      startBtn: document.getElementById('start-listening'),
      stopBtn: document.getElementById('stop-listening'),
      overlayBtn: document.getElementById('open-overlay'),
      screenshotBtn: document.getElementById('take-screenshot'),
      manualBtn: document.getElementById('generate-manual'),
      manualQuestion: document.getElementById('manual-question'),
      manualType: document.getElementById('manual-type'),
      statusIndicator: document.getElementById('status-indicator'),
      transcription: document.getElementById('transcription'),
      questions: document.getElementById('questions'),
      answers: document.getElementById('answers'),
      screenshotAnalysis: document.getElementById('screenshot-analysis'),
      questionCount: document.getElementById('question-count'),
      sessionTime: document.getElementById('session-time'),
      downloadCard: document.getElementById('desktop-download-card'),
      downloadLink: document.getElementById('desktop-download-link'),
      platformDownloads: document.getElementById('platform-downloads'),
      downloadWin: document.getElementById('download-win'),
      downloadMac: document.getElementById('download-mac'),
      downloadLinux: document.getElementById('download-linux')
    };
  }

  bindEvents() {
    const missing = Object.entries(this.elements)
      .filter(([, element]) => !element)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`Missing UI elements: ${missing.join(', ')}`);
    }

    this.elements.startBtn.addEventListener('click', () => this.startListening());
    this.elements.stopBtn.addEventListener('click', () => this.stopListening());
    this.elements.overlayBtn.addEventListener('click', () => this.openOverlay());
    this.elements.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
    this.elements.manualBtn.addEventListener('click', () => this.generateManualAnswer());
  }

  setupIPCHandlers() {
    if (!ipcRenderer) return;

    ipcRenderer.on('question-detected', (event, data) => this.handleQuestionDetected(data));
    ipcRenderer.on('answer-generated', (event, data) => this.handleAnswerGenerated(data));
    ipcRenderer.on('transcription-update', (event, transcription) => this.updateTranscription(transcription));
    ipcRenderer.on('listening-status', (event, data) => this.applyListeningStatus(data.listening, data.message));
  }

  async setupSocketHandlers() {
    if (ipcRenderer) return;

    if (typeof io !== 'function') {
      try {
        await this.loadSocketIoClient();
      } catch (error) {
        this.setStatus('Socket Missing', 'status-offline');
        this.updateTranscription('Socket.IO is not loaded. Start with npm start and open http://localhost:3014, not the HTML file directly.');
        return;
      }
    }

    this.socket = io();
    this.socket.on('connect', () => {
      this.setStatus('Connected', 'status-online');
      this.elements.startBtn.disabled = false;
    });
    this.socket.on('connect_error', (error) => {
      this.setStatus('Socket Error', 'status-offline');
      this.updateTranscription(`Browser is not connected to the server: ${error.message}`);
    });
    this.socket.on('disconnect', () => {
      this.setStatus('Disconnected', 'status-offline');
      this.updateTranscription('Browser disconnected from the server. Refresh the page or restart npm start.');
    });
    this.socket.on('question-detected', (data) => this.handleQuestionDetected(data));
    this.socket.on('answer-generated', (data) => this.handleAnswerGenerated(data));
    this.socket.on('transcription-update', (transcription) => this.updateTranscription(transcription));
    this.socket.on('listening-status', (data) => this.applyListeningStatus(data.listening, data.message));
  }

  loadSocketIoClient() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Socket.IO client'));
      document.head.appendChild(script);
    });
  }

  async startListening() {
    this.setButtonLoading(this.elements.startBtn, 'Starting...');
    this.elements.stopBtn.disabled = true;

    if (!ipcRenderer) {
      try {
        await this.waitForSocketConnection();
      } catch (error) {
        this.resetButton(this.elements.startBtn, 'Start Listening');
        return this.showError(error.message);
      }

      if (!this.canUseBrowserMic()) {
        this.resetButton(this.elements.startBtn, 'Start Listening');
        return;
      }

      return this.startBrowserMicListening();
    }

    let result;
    try {
      result = await this.invoke('start-listening');
    } catch (error) {
      this.resetButton(this.elements.startBtn, 'Start Listening');
      return this.showError(`Start failed: ${error.message}`);
    }

    if (!result.success) {
      this.resetButton(this.elements.startBtn, 'Start Listening');
      return this.showError(result.message);
    }

    this.sessionStartTime = Date.now();
    this.startSessionTimer();
    this.applyListeningStatus(true, 'Listening for interview questions...');
    this.openOverlay();
  }

  async stopListening() {
    this.setButtonLoading(this.elements.stopBtn, 'Stopping...');

    if (!ipcRenderer && this.micStream) {
      return this.stopBrowserMicListening();
    }

    let result;
    try {
      result = await this.invoke('stop-listening');
    } catch (error) {
      this.resetButton(this.elements.stopBtn, 'Stop');
      return this.showError(`Stop failed: ${error.message}`);
    }

    if (!result.success) {
      this.resetButton(this.elements.stopBtn, 'Stop');
      return this.showError(result.message);
    }

    this.stopSessionTimer();
    this.applyListeningStatus(false, result.message || 'Stopped listening.');
  }

  async openOverlay() {
    if (!ipcRenderer) {
      return this.showError('System overlay is available only in the Electron desktop app. Browser tabs cannot stay above other tabs or continue after closing the original tab.');
    }

    try {
      const result = await ipcRenderer.invoke('open-overlay');
      if (!result.success) {
        this.showError(result.message || 'Failed to open overlay.');
      }
    } catch (error) {
      this.showError(`Failed to open overlay: ${error.message}`);
    }
  }

  async loadAppConfig() {
    if (!ipcRenderer && this.elements.overlayBtn) {
      this.elements.overlayBtn.style.display = 'none';
    }

    try {
      const response = await fetch('/api/config');
      if (!response.ok) return;

      const config = await response.json();
      if (!this.elements.downloadCard) return;

      const hasPlatformLinks = config.desktopDownloadWin || config.desktopDownloadMac || config.desktopDownloadLinux;

      if (hasPlatformLinks && this.elements.platformDownloads) {
        if (config.desktopDownloadWin && this.elements.downloadWin) {
          this.elements.downloadWin.href = config.desktopDownloadWin;
          this.elements.downloadWin.style.display = 'inline-block';
        }
        if (config.desktopDownloadMac && this.elements.downloadMac) {
          this.elements.downloadMac.href = config.desktopDownloadMac;
          this.elements.downloadMac.style.display = 'inline-block';
        }
        if (config.desktopDownloadLinux && this.elements.downloadLinux) {
          this.elements.downloadLinux.href = config.desktopDownloadLinux;
          this.elements.downloadLinux.style.display = 'inline-block';
        }
        this.elements.platformDownloads.style.display = 'flex';
        if (this.elements.downloadLink) this.elements.downloadLink.style.display = 'none';
        this.elements.downloadCard.classList.add('is-visible');
      } else if (config.desktopDownloadUrl && this.elements.downloadLink) {
        this.elements.downloadLink.href = config.desktopDownloadUrl;
        this.elements.downloadLink.textContent = config.desktopDownloadLabel || 'Download Desktop App';
        this.elements.downloadCard.classList.add('is-visible');
      }
    } catch (error) {
      if (this.elements.downloadCard) {
        this.elements.downloadCard.classList.remove('is-visible');
      }
    }
  }

  async startBrowserMicListening() {
    try {
      this.updateTranscription('Requesting browser microphone permission...');
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      const result = await this.emitWithAck('browser-audio-start', {
        sampleRate: this.audioContext.sampleRate
      });

      if (!result.success) {
        this.cleanupBrowserMic();
        this.resetButton(this.elements.startBtn, 'Start Listening');
        return this.showError(result.message);
      }

      this.audioProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        this.socket.emit('browser-audio-chunk', this.floatTo16BitPcm(input));
      };

      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);

      this.sessionStartTime = Date.now();
      this.startSessionTimer();
      const track = this.micStream.getAudioTracks()[0];
      this.applyListeningStatus(true, `Browser mic is on (${track ? track.label : 'default microphone'}). Speak now.`);
    } catch (error) {
      this.cleanupBrowserMic();
      this.resetButton(this.elements.startBtn, 'Start Listening');
      this.showError(this.getMicErrorMessage(error));
    }
  }

  canUseBrowserMic() {
    if (!window.isSecureContext) {
      this.showError([
        'Browser microphone is blocked because this page is not a secure context.',
        'Open the app as http://localhost:3014, not by LAN IP, file path, or remote host.'
      ].join('\n'));
      return false;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.showError('This browser does not expose microphone access. Use Chrome/Edge/Firefox on http://localhost:3014.');
      return false;
    }

    if (!this.socket || !this.socket.connected) {
      this.showError('Browser is not connected to the server. Refresh http://localhost:3014 and confirm npm start is still running.');
      return false;
    }

    return true;
  }

  waitForSocketConnection() {
    if (this.socket && this.socket.connected) {
      return Promise.resolve();
    }

    if (!this.socket) {
      return Promise.reject(new Error('Socket.IO is not loaded. Open the app from npm start, not by opening the HTML file directly.'));
    }

    this.updateTranscription('Connecting browser to server...');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Could not connect to the server. Check that npm start is running and open http://localhost:3014.'));
      }, 8000);

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const onError = (error) => {
        cleanup();
        reject(new Error(`Socket connection failed: ${error.message}`));
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onError);
      };

      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onError);
      this.socket.connect();
    });
  }

  getMicErrorMessage(error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Microphone permission was blocked. Click the lock/microphone icon in the address bar, allow microphone access, then refresh.';
    }

    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No microphone device was found by the browser. Check OS sound input settings.';
    }

    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'The microphone is already in use or blocked by the OS. Close other apps using the mic and try again.';
    }

    return `Microphone failed: ${error.message}`;
  }

  async showStartupAudioHint() {
    if (ipcRenderer) {
      this.updateTranscription('Desktop mode uses system audio recorder. For browser mic permission, run npm start and open http://localhost:3014.');
      return;
    }

    const secureState = window.isSecureContext ? 'secure' : 'not secure';
    const micState = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? 'available' : 'not available';
    let permissionState = 'unknown';

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        permissionState = permission.state;
      }
    } catch (error) {
      permissionState = 'unknown';
    }

    this.updateTranscription(`Web mode ready. Origin: ${window.location.origin}. Secure context: ${secureState}. Browser mic API: ${micState}. Mic permission: ${permissionState}.`);
  }

  async stopBrowserMicListening() {
    try {
      this.cleanupBrowserMic();
      const result = await this.emitWithAck('browser-audio-stop', {});
      this.stopSessionTimer();
      this.applyListeningStatus(false, result.message || 'Stopped listening.');
    } catch (error) {
      this.cleanupBrowserMic();
      this.stopSessionTimer();
      this.applyListeningStatus(false, 'Stopped listening.');
    }
  }

  cleanupBrowserMic() {
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor.onaudioprocess = null;
      this.audioProcessor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
  }

  floatTo16BitPcm(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return buffer;
  }

  emitWithAck(eventName, payload) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(`${eventName} timed out`)), 12000);
      this.socket.emit(eventName, payload, (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      });
    });
  }

  async takeScreenshot() {
    this.setButtonLoading(this.elements.screenshotBtn, 'Reading...');
    try {
      const result = await this.invoke('take-screenshot');
      if (!result.success) {
        // If screenshot fails on Windows, offer permission help
        if (ipcRenderer && result.message && result.message.includes('Windows') && result.message.includes('permission')) {
          const shouldFix = confirm(
            `${result.message}\n\nWould you like to check and fix Windows screenshot permissions?`
          );
          
          if (shouldFix) {
            await this.checkAndFixScreenshotPermissions();
            return;
          }
        }
        return this.showError(result.message);
      }
      this.displayScreenshotAnalysis(result);
      if (result.solution) this.addAnswer(result.solution, result.type || 'coding');
    } catch (error) {
      this.showError(`Screenshot failed: ${error.message}`);
    } finally {
      this.resetButton(this.elements.screenshotBtn, 'Read Screen');
    }
  }

  async checkAndFixScreenshotPermissions() {
    if (!ipcRenderer) {
      this.showError('Permission fixes are only available in the desktop app');
      return;
    }

    try {
      // First check current permissions
      this.setButtonLoading(this.elements.screenshotBtn, 'Checking...');
      const checkResult = await ipcRenderer.invoke('check-screenshot-permissions');
      
      if (checkResult.success && checkResult.diagnosis) {
        const { diagnosis } = checkResult;
        
        if (diagnosis.screenApiAccess) {
          window.alert('Screenshot permissions are working correctly. Try taking a screenshot again.');
          return;
        }
        
        // Show diagnostic information
        const diagMessage = [
          'Screenshot Permission Diagnosis:',
          `• Running as Admin: ${diagnosis.isAdmin ? 'Yes' : 'No'}`,
          `• PowerShell Access: ${diagnosis.powershellAccess ? 'Yes' : 'No'}`,
          `• Screen API Access: ${diagnosis.screenApiAccess ? 'Yes' : 'No'}`,
          `• Execution Policy: ${diagnosis.executionPolicy}`,
          '',
          'Suggested fixes:',
          ...diagnosis.suggestions.map(s => `• ${s}`),
          '',
          'Try automatic fix?'
        ].join('\n');
        
        const shouldAutoFix = confirm(diagMessage);
        
        if (shouldAutoFix) {
          this.setButtonLoading(this.elements.screenshotBtn, 'Fixing...');
          const fixResult = await ipcRenderer.invoke('fix-screenshot-permissions');
          
          if (fixResult.success) {
            window.alert('Permissions fixed! Try taking a screenshot again.');
          } else {
            const fixMessage = [
              'Automatic fix failed. Manual steps required:',
              '',
              ...(fixResult.suggestions || []).map(s => `• ${s}`),
              '',
              'After completing these steps, restart the application.'
            ].join('\n');
            
            window.alert(fixMessage);
          }
        }
      } else {
        this.showError('Unable to check screenshot permissions');
      }
    } catch (error) {
      this.showError(`Permission check failed: ${error.message}`);
    } finally {
      this.resetButton(this.elements.screenshotBtn, 'Read Screen');
    }
  }

  async generateManualAnswer() {
    const question = this.elements.manualQuestion.value.trim();
    const type = this.elements.manualType.value;
    if (!question) return this.showError('Enter a question, prompt, or code snippet first.');

    this.setButtonLoading(this.elements.manualBtn, 'Generating...');
    try {
      const result = type === 'debug'
        ? await this.invoke('debug-code', question)
        : await this.invoke('generate-answer', question, type);
      if (typeof result !== 'string' && !result.success) {
        return this.showError(result.message || 'Generation failed.');
      }
      const answer = typeof result === 'string' ? result : result.answer;

      this.addQuestion(question, type);
      this.addAnswer(answer, type);
      this.incrementQuestionCount();
    } catch (error) {
      this.showError(`Generation failed: ${error.message}`);
    } finally {
      this.resetButton(this.elements.manualBtn, 'Generate Answer');
    }
  }

  async invoke(channel, ...args) {
    if (ipcRenderer) {
      return this.withTimeout(ipcRenderer.invoke(channel, ...args), 12000, `${channel} timed out`);
    }

    const routeMap = {
      'start-listening': ['/api/start-listening'],
      'stop-listening': ['/api/stop-listening'],
      'take-screenshot': ['/api/take-screenshot'],
      'generate-answer': ['/api/generate-answer', { question: args[0], type: args[1] }],
      'debug-code': ['/api/debug-code', { input: args[0] }]
    };
    const [url, body] = routeMap[channel] || [];

    if (!url) {
      throw new Error(`Unsupported action: ${channel}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }

    return response.json();
  }

  withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  handleQuestionDetected(data) {
    this.incrementQuestionCount();
    
    // Enhanced question display with metadata
    const questionText = data.question;
    const questionType = data.type || 'general';
    const urgency = data.urgency ? ' (Urgent)' : '';
    const confidence = data.confidence ? ` [${Math.round(data.confidence * 100)}%]` : '';
    
    this.addQuestion(`${questionText}${urgency}${confidence}`, questionType);
    
    if (data.answer) {
      this.addAnswer(data.answer, questionType);
    } else if (data.pending) {
      this.addAnswer('🤖 Generating answer with AI...', questionType);
    }
  }

  handleAnswerGenerated(data) {
    // Replace the "generating" message with the actual answer
    const existingAnswer = this.elements.answers.querySelector('.item:first-child .answer-text');
    if (existingAnswer && existingAnswer.textContent.includes('Generating')) {
      existingAnswer.textContent = data.answer;
      
      // Add generation time if available
      if (data.generationTime) {
        const timeEl = existingAnswer.parentElement.querySelector('.generation-time');
        if (!timeEl) {
          const timeSpan = document.createElement('span');
          timeSpan.className = 'generation-time';
          timeSpan.textContent = ` (${data.generationTime}ms)`;
          existingAnswer.appendChild(timeSpan);
        }
      }
    } else {
      // Fallback: add as new answer
      this.addAnswer(data.answer, data.type);
    }
  }

  addQuestion(question, type) {
    this.clearPlaceholder(this.elements.questions);
    const item = this.createItem(type, question);
    this.elements.questions.prepend(item);
  }

  addAnswer(answer, type) {
    this.clearPlaceholder(this.elements.answers);
    const item = this.createItem(`${type} answer`, answer, true);
    this.elements.answers.prepend(item);
  }

  createItem(label, text, copyable = false) {
    const item = document.createElement('article');
    item.className = 'item';

    const header = document.createElement('div');
    header.className = 'item-header';

    const chip = document.createElement('span');
    chip.className = 'type-chip';
    chip.textContent = label.toUpperCase();

    const right = copyable ? document.createElement('button') : document.createElement('span');
    if (copyable) {
      right.className = 'copy-btn';
      right.textContent = 'Copy';
      right.addEventListener('click', () => navigator.clipboard.writeText(text));
    } else {
      right.className = 'item-time';
      right.textContent = new Date().toLocaleTimeString();
    }

    const body = document.createElement('div');
    body.className = copyable ? 'answer-text' : 'question-text';
    body.textContent = text;

    header.append(chip, right);
    item.append(header, body);
    return item;
  }

  updateTranscription(transcription) {
    if (typeof transcription === 'object') {
      // Enhanced transcription object with metadata
      this.elements.transcription.classList.remove('muted');
      const displayText = transcription.text || transcription;
      const confidence = transcription.confidence;
      const isPartial = transcription.isPartial;
      
      // Add confidence indicator if available
      let displayHtml = displayText;
      if (confidence && confidence < 0.8) {
        displayHtml = `<span class="low-confidence">${displayText}</span>`;
      }
      if (isPartial) {
        displayHtml = `<span class="partial-transcript">${displayHtml}</span>`;
      }
      
      this.elements.transcription.innerHTML = displayHtml;
    } else {
      // Legacy string transcription
      this.elements.transcription.classList.remove('muted');
      this.elements.transcription.textContent = transcription || 'Listening...';
    }
  }

  applyListeningStatus(isListening, message) {
    this.elements.startBtn.disabled = isListening;
    this.elements.stopBtn.disabled = !isListening;
    this.elements.startBtn.textContent = 'Start Listening';
    this.elements.stopBtn.textContent = 'Stop';
    this.setStatus(isListening ? 'Listening' : 'Stopped', isListening ? 'status-listening' : 'status-online');
    this.updateTranscription(message || (isListening ? 'Listening for interview questions...' : 'Stopped listening.'));
  }

  displayScreenshotAnalysis(result) {
    this.elements.screenshotAnalysis.classList.remove('muted');
    this.elements.screenshotAnalysis.replaceChildren();

    const extracted = document.createElement('pre');
    extracted.className = 'extracted-text';
    extracted.textContent = result.extractedText || 'No readable text detected.';

    const solution = document.createElement('div');
    solution.className = 'solution';
    solution.textContent = result.solution || 'No coding prompt detected.';

    this.elements.screenshotAnalysis.append(extracted, solution);
  }

  incrementQuestionCount() {
    this.questionCount += 1;
    this.elements.questionCount.textContent = this.questionCount;
  }

  startSessionTimer() {
    this.stopSessionTimer();
    this.sessionTimer = setInterval(() => {
      const elapsed = Date.now() - this.sessionStartTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      this.elements.sessionTime.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
  }

  stopSessionTimer() {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    this.sessionTimer = null;
  }

  setStatus(text, className) {
    this.elements.statusIndicator.textContent = text;
    this.elements.statusIndicator.className = `status-pill ${className}`;
  }

  setButtonLoading(button, text) {
    button.dataset.defaultText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  }

  resetButton(button, fallbackText) {
    button.textContent = button.dataset.defaultText || fallbackText;
    button.disabled = false;
  }

  clearPlaceholder(element) {
    if (element.classList.contains('muted')) {
      element.classList.remove('muted');
      element.textContent = '';
    }
  }

  showError(message) {
    console.error(message);
    this.setStatus('Error', 'status-offline');
    window.alert(message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    new InterviewCopilotUI();
  } catch (error) {
    console.error('Failed to initialize Interview Copilot UI:', error);
    window.alert(`UI failed to initialize: ${error.message}`);
  }
});
