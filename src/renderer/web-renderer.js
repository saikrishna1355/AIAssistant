class InterviewCopilotWebUI {
  constructor() {
    this.questionCount = 0;
    this.sessionStartTime = null;
    this.sessionTimer = null;
    this.socket = io();

    this.initializeElements();
    this.bindEvents();
    this.setupSocketHandlers();
  }

  initializeElements() {
    this.elements = {
      startBtn: document.getElementById('start-listening'),
      stopBtn: document.getElementById('stop-listening'),
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
      sessionTime: document.getElementById('session-time')
    };
  }

  bindEvents() {
    this.elements.startBtn.addEventListener('click', () => this.startListening());
    this.elements.stopBtn.addEventListener('click', () => this.stopListening());
    this.elements.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
    this.elements.manualBtn.addEventListener('click', () => this.generateManualAnswer());
  }

  setupSocketHandlers() {
    this.socket.on('connect', () => this.setStatus('Connected', 'status-online'));
    this.socket.on('disconnect', () => this.setStatus('Disconnected', 'status-offline'));
    this.socket.on('question-detected', (data) => this.handleQuestionDetected(data));
    this.socket.on('transcription-update', (transcription) => this.updateTranscription(transcription));
  }

  async startListening() {
    const result = await this.post('/api/start-listening');
    if (!result.success) return this.showError(result.message);

    this.sessionStartTime = Date.now();
    this.startSessionTimer();
    this.elements.startBtn.disabled = true;
    this.elements.stopBtn.disabled = false;
    this.setStatus('Listening', 'status-listening');
    this.updateTranscription('Listening for interview questions...');
  }

  async stopListening() {
    const result = await this.post('/api/stop-listening');
    if (!result.success) return this.showError(result.message);

    this.stopSessionTimer();
    this.elements.startBtn.disabled = false;
    this.elements.stopBtn.disabled = true;
    this.setStatus('Connected', 'status-online');
  }

  async takeScreenshot() {
    this.setButtonLoading(this.elements.screenshotBtn, 'Reading...');
    try {
      const result = await this.post('/api/take-screenshot');
      if (!result.success) return this.showError(result.message);
      this.displayScreenshotAnalysis(result);
      if (result.solution) this.addAnswer(result.solution, result.type || 'coding');
    } catch (error) {
      this.showError(`Screenshot failed: ${error.message}`);
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
      const endpoint = type === 'debug' ? '/api/debug-code' : '/api/generate-answer';
      const payload = type === 'debug' ? { input: question } : { question, type };
      const result = await this.post(endpoint, payload);
      if (!result.success) return this.showError(result.message);

      this.addQuestion(question, type);
      this.addAnswer(result.answer, type);
      this.incrementQuestionCount();
    } catch (error) {
      this.showError(`Generation failed: ${error.message}`);
    } finally {
      this.resetButton(this.elements.manualBtn, 'Generate Answer');
    }
  }

  async post(url, body = undefined) {
    const response = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return response.json();
  }

  handleQuestionDetected(data) {
    this.incrementQuestionCount();
    this.addQuestion(data.question, data.type);
    this.addAnswer(data.answer, data.type);
  }

  addQuestion(question, type) {
    this.clearPlaceholder(this.elements.questions);
    this.elements.questions.prepend(this.createItem(type, question));
  }

  addAnswer(answer, type) {
    this.clearPlaceholder(this.elements.answers);
    this.elements.answers.prepend(this.createItem(`${type} answer`, answer, true));
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
    this.elements.transcription.classList.remove('muted');
    this.elements.transcription.textContent = transcription || 'Listening...';
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
    window.alert(message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new InterviewCopilotWebUI();
});
