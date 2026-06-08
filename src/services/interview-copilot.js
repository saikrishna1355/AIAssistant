const { AWSServices } = require('./aws-services');
const { AudioRecorder } = require('./audio-recorder');
const { ScreenCapture } = require('./screen-capture');
const { QuestionDetector } = require('./question-detector');

class InterviewCopilot {
  constructor() {
    this.aws = new AWSServices();
    this.audioRecorder = new AudioRecorder();
    this.screenCapture = new ScreenCapture();
    this.questionDetector = new QuestionDetector();
    this.isListening = false;
    this.currentTranscription = '';
    this.lastQuestion = '';
  }

  async startListening() {
    if (this.isListening) return { success: false, message: 'Already listening' };
    
    try {
      this.isListening = true;
      await this.audioRecorder.start((transcription, meta) => {
        this.handleTranscription(transcription, meta);
      });
      this.emit('listening-status', { listening: true, message: 'Listening now. Speak an interview question.' });
      
      return { success: true, message: 'Started listening for questions' };
    } catch (error) {
      console.error('Failed to start listening:', error);
      this.isListening = false;
      return { success: false, message: 'Failed to start audio recording' };
    }
  }

  async startBrowserListening(sampleRate) {
    if (this.isListening) return { success: false, message: 'Already listening' };

    try {
      this.isListening = true;
      this.currentTranscription = '';
      await this.audioRecorder.startBrowserStream((transcription, meta) => {
        this.handleTranscription(transcription, meta);
      }, sampleRate);
      this.emit('listening-status', { listening: true, message: 'Browser mic is on. Speak an interview question.' });

      return { success: true, message: 'Browser microphone started' };
    } catch (error) {
      console.error('Failed to start browser microphone:', error);
      this.isListening = false;
      return { success: false, message: 'Failed to start browser microphone' };
    }
  }

  writeBrowserAudio(chunk) {
    this.audioRecorder.writeBrowserAudio(chunk);
  }

  async stopListening() {
    if (!this.isListening) {
      return { success: true, message: 'Already stopped' };
    }
    
    try {
      await this.audioRecorder.stop();
      this.isListening = false;
      this.emit('listening-status', { listening: false, message: 'Stopped listening' });
      return { success: true, message: 'Stopped listening' };
    } catch (error) {
      console.error('Failed to stop listening:', error);
      this.isListening = false;
      this.emit('listening-status', { listening: false, message: 'Stopped with recorder warning' });
      return { success: true, message: 'Stopped listening' };
    }
  }

  async handleTranscription(transcription, meta = {}) {
    if (meta.isPartial) {
      const liveText = `${this.currentTranscription} ${transcription}`.trim();
      this.emit('transcription-update', liveText || transcription);
      return;
    }

    this.currentTranscription = `${this.currentTranscription} ${transcription}`.trim();
    this.emit('transcription-update', this.currentTranscription);
    
    if (this.questionDetector.isQuestion(transcription)) {
      const question = this.questionDetector.extractQuestionFromTranscription(transcription);

      if (question === this.lastQuestion) {
        return;
      }

      this.lastQuestion = question;
      const questionType = this.questionDetector.categorizeQuestion(question);
      this.emit('question-detected', {
        question,
        type: questionType,
        pending: true
      });

      const answer = await this.generateAnswer(question, questionType);
      this.emit('answer-generated', {
        question,
        type: questionType,
        answer
      });
    }
  }

  async generateAnswer(question, questionType = 'general', options = {}) {
    try {
      return await this.aws.generateAnswer(question, questionType, options);
    } catch (error) {
      console.error('Failed to generate answer:', error);
      return 'Unable to generate answer at this time.';
    }
  }

  async takeScreenshot() {
    try {
      const screenshot = await this.screenCapture.capture();
      const extractedText = await this.screenCapture.extractText(screenshot);
      const type = this.questionDetector.isCodingProblem(extractedText) ? 'coding' : 'technical';
      const solution = await this.generateAnswer(extractedText, type);
      
      return {
        success: true,
        screenshot,
        extractedText,
        type,
        solution
      };
    } catch (error) {
      console.error('Screenshot failed:', error);
      return { success: false, message: 'Failed to capture screenshot' };
    }
  }

  async debugCode(input) {
    return this.generateAnswer(input, 'debug');
  }

  emit(eventName, payload) {
    if (global.socketIO) {
      global.socketIO.emit(eventName, payload);
    }

    if (global.mainWindow && global.mainWindow.webContents) {
      global.mainWindow.webContents.send(eventName, payload);
    }

    if (global.overlayWindow && global.overlayWindow.webContents) {
      global.overlayWindow.webContents.send(eventName, payload);
    }
  }
}

module.exports = { InterviewCopilot };
