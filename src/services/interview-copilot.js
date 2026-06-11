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
      const result = await this.audioRecorder.start((transcription, meta) => {
        this.handleTranscription(transcription, meta);
      });
      
      const mode = result.mode || 'microphone';
      const modeText = {
        microphone: 'microphone input',
        system: 'system audio output',
        both: 'microphone and system audio'
      }[mode] || 'audio source';
      
      this.emit('listening-status', { 
        listening: true, 
        message: `Listening to ${modeText}. Speak an interview question.`,
        mode
      });
      
      return { success: true, message: `Started listening for questions via ${modeText}` };
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
    // Process the transcript segment through enhanced question detector
    const result = this.questionDetector.processTranscriptSegment(
      transcription, 
      meta.isPartial, 
      {
        confidence: meta.confidence,
        timestamp: meta.timestamp
      }
    );

    if (meta.isPartial) {
      // For partial transcripts, just update the UI
      const liveText = `${this.currentTranscription} ${transcription}`.trim();
      this.emit('transcription-update', {
        text: liveText || transcription,
        isPartial: true,
        confidence: result.confidence
      });
      return;
    }

    // Update the complete transcription
    this.currentTranscription = `${this.currentTranscription} ${transcription}`.trim();
    this.emit('transcription-update', {
      text: this.currentTranscription,
      isPartial: false,
      confidence: result.confidence
    });
    
    // Process any detected questions
    if (result.isQuestion && result.question) {
      console.log(`🎯 Question detected: ${result.question} (Type: ${result.type})`);
      
      // Emit question detected event immediately
      this.emit('question-detected', {
        question: result.question,
        type: result.type,
        urgency: result.urgency,
        timestamp: result.timestamp,
        confidence: result.confidence,
        pending: true // Indicates answer is being generated
      });

      // Start answer generation in parallel - don't wait
      this.generateAnswerAsync(result.question, result.type, {
        urgency: result.urgency,
        timestamp: result.timestamp
      });
    }
  }

  async generateAnswerAsync(question, questionType, metadata = {}) {
    try {
      console.log(`🤖 Generating answer for: ${question}`);
      const startTime = Date.now();
      
      const answer = await this.generateAnswer(question, questionType, {
        urgency: metadata.urgency
      });
      
      const generationTime = Date.now() - startTime;
      console.log(`✅ Answer generated in ${generationTime}ms`);
      
      this.emit('answer-generated', {
        question,
        type: questionType,
        answer,
        generationTime,
        timestamp: metadata.timestamp,
        urgency: metadata.urgency
      });
    } catch (error) {
      console.error('❌ Failed to generate answer:', error);
      this.emit('answer-generated', {
        question,
        type: questionType,
        answer: 'Unable to generate answer at this time. Please try again.',
        error: error.message,
        timestamp: metadata.timestamp
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
      const screenshot = await this.screenCapture.captureWithFallback();
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
      return { 
        success: false, 
        message: error.message || 'Failed to capture screenshot'
      };
    }
  }

  async debugCode(input) {
    return this.generateAnswer(input, 'debug');
  }

  resetTranscriptionState() {
    this.currentTranscription = '';
    this.lastQuestion = '';
    this.questionDetector.resetState();
  }

  setAudioSourceMode(mode) {
    return this.audioRecorder.setAudioSourceMode(mode);
  }

  getAudioSourceMode() {
    return this.audioRecorder.getAudioSourceMode();
  }

  getAudioSourceInfo() {
    return this.audioRecorder.getAudioSourceInfo();
  }

  getAvailableAudioSources() {
    return this.audioRecorder.getAvailableAudioSources();
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
