const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const record = require("node-record-lpcm16");
const { spawnSync } = require("child_process");
const { PassThrough } = require("stream");
const { SystemAudioCapture } = require("./system-audio-capture");

class AudioRecorder {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.transcriptionCallback = null;
    this.browserAudioStream = null;
    this.browserStreamActive = false;
    this.systemAudioCapture = new SystemAudioCapture();
    this.audioSourceMode = process.env.AUDIO_SOURCE_MODE || "system"; // microphone, system, both
    this.transcribeRegion =
      process.env.TRANSCRIBE_REGION ||
      this.getDefaultStreamingRegion(process.env.AWS_REGION || "eu-central-1");
    this.transcribeClient = new TranscribeStreamingClient({
      region: this.transcribeRegion,
    });
  }

  async start(onTranscription) {
    if (this.isRecording) {
      throw new Error("Already recording");
    }

    this.transcriptionCallback = onTranscription;
    this.isRecording = true;

    try {
      if (this.audioSourceMode === "system") {
        this.startSystemAudioTranscription().catch((error) => {
          console.error("System audio transcription failed:", error);
          this.isRecording = false;
          throw error;
        });
      } else if (this.audioSourceMode === "both") {
        // Start both microphone and system audio (mixed)
        this.startMixedAudioTranscription().catch((error) => {
          console.error("Mixed audio transcription failed:", error);
          this.isRecording = false;
          throw error;
        });
      } else {
        // Default microphone mode
        this.startAWSTranscribeStreaming().catch((error) => {
          console.error("Transcription stream stopped:", error);
          this.isRecording = false;
          throw error;
        });
      }
      return { success: true, mode: this.audioSourceMode };
    } catch (error) {
      console.error("Failed to start transcription:", error);
      this.isRecording = false;
      throw error;
    }
  }

  async startSystemAudioTranscription() {
    if (!this.systemAudioCapture.isSystemAudioAvailable()) {
      console.warn("System audio capture not available.");
      throw new Error("System audio capture not available on this platform");
    }

    try {
      const { stream: audioStream, source } =
        this.systemAudioCapture.startSystemCapture();
      console.log(`Started system audio capture from: ${source}`);

      audioStream.on("error", (error) => {
        if (!this.isRecording) return;
        console.error("System audio stream error:", error);
        throw error;
      });

      await this.startTranscribeFromStream(audioStream, 16000);
    } catch (error) {
      console.error("System audio capture failed:", error);
      throw error;
    }
  }

  async startMixedAudioTranscription() {
    // Start both microphone and system audio, mix them together
    const mixedStream = new PassThrough();
    let micStream = null;
    let systemStream = null;

    try {
      // Start microphone
      const recorderName = this.getAvailableRecorder();
      if (recorderName) {
        this.recording = record.record({
          sampleRate: 16000,
          channels: 1,
          threshold: 0,
          verbose: false,
          recorder: recorderName,
          audioType: "raw",
          silence: "1.0s",
        });
        micStream = this.recording.stream();
      }

      // Start system audio
      if (this.systemAudioCapture.isSystemAudioAvailable()) {
        const { stream } = this.systemAudioCapture.startSystemCapture();
        systemStream = stream;
      }

      // Mix audio streams (simple approach: alternate chunks)
      if (micStream && systemStream) {
        let micBuffer = Buffer.alloc(0);
        let sysBuffer = Buffer.alloc(0);

        micStream.on("data", (chunk) => {
          micBuffer = Buffer.concat([micBuffer, chunk]);
          this.processMixedAudio(mixedStream, micBuffer, sysBuffer);
        });

        systemStream.on("data", (chunk) => {
          sysBuffer = Buffer.concat([sysBuffer, chunk]);
          this.processMixedAudio(mixedStream, micBuffer, sysBuffer);
        });
      } else if (micStream) {
        micStream.pipe(mixedStream);
      } else if (systemStream) {
        systemStream.pipe(mixedStream);
      } else {
        throw new Error("No audio sources available");
      }

      await this.startTranscribeFromStream(mixedStream, 16000);
    } catch (error) {
      console.error("Mixed audio transcription failed:", error);
      throw error;
    }
  }

  processMixedAudio(outputStream, micBuffer, sysBuffer) {
    const chunkSize = 1024;
    const minLength = Math.min(micBuffer.length, sysBuffer.length);

    if (minLength >= chunkSize) {
      // Simple audio mixing: average the samples
      const mixed = Buffer.alloc(chunkSize);
      for (let i = 0; i < chunkSize; i += 2) {
        const micSample = micBuffer.readInt16LE(i);
        const sysSample = sysBuffer.readInt16LE(i);
        const mixedSample = Math.round((micSample + sysSample) / 2);
        mixed.writeInt16LE(mixedSample, i);
      }
      outputStream.write(mixed);
    }
  }

  async startAWSTranscribeStreaming() {
    const recorderName = this.getAvailableRecorder();
    if (!recorderName) {
      console.warn("No local recorder binary found. Install SoX or arecord for live audio.");
      throw new Error("No audio recorder available. Install SoX, arecord, or rec.");
    }

    const audioStream = new PassThrough();

    // Start recording
    this.recording = record.record({
      sampleRate: 16000,
      channels: 1,
      threshold: 0,
      verbose: false,
      recorder: recorderName,
      audioType: "raw",
      silence: "1.0s",
    });

    // Pipe audio to stream
    const recordingStream = this.recording.stream();
    recordingStream.on("error", (error) => {
      if (!this.isRecording) {
        return;
      }

      console.error("Local recorder stream error:", error);
      throw error;
    });

    if (this.recording.process) {
      this.recording.process.on("error", (error) => {
        if (!this.isRecording) {
          return;
        }

        console.error("Local recorder process error:", error.message);
        throw error;
      });
    }

    recordingStream.pipe(audioStream);

    await this.startTranscribeFromStream(audioStream, 16000);
  }

  async startBrowserStream(onTranscription, sampleRate = 48000) {
    if (this.isRecording) {
      throw new Error("Already recording");
    }

    this.transcriptionCallback = onTranscription;
    this.isRecording = true;
    this.browserStreamActive = true;
    this.browserAudioStream = new PassThrough();

    this.startTranscribeFromStream(this.browserAudioStream, sampleRate).catch(
      (error) => {
        console.error(
          "Browser microphone transcription stopped:",
          error.message || error,
        );
        if (this.isRecording) {
          this.isRecording = false;
          throw error;
        }
      },
    );

    return { success: true };
  }

  writeBrowserAudio(chunk) {
    if (
      !this.isRecording ||
      !this.browserStreamActive ||
      !this.browserAudioStream
    ) {
      return;
    }

    this.browserAudioStream.write(Buffer.from(chunk));
  }

  async startTranscribeFromStream(audioStream, sampleRate) {
    const params = {
      LanguageCode: "en-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: sampleRate,
      AudioStream: this.asyncGenerator(audioStream),
    };

    try {
      const command = new StartStreamTranscriptionCommand(params);
      const response = await this.transcribeClient.send(command);

      // Process transcription results
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent.Transcript.Results;

          for (const result of results) {
            if (result.Alternatives && result.Alternatives.length > 0) {
              const transcript = result.Alternatives[0].Transcript;
              const confidence = result.Alternatives[0].Confidence;
              
              if (transcript && transcript.trim().length > 0) {
                this.transcriptionCallback(transcript.trim(), {
                  isPartial: result.IsPartial,
                  confidence: confidence,
                  timestamp: Date.now(),
                  resultId: result.ResultId
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `AWS Transcribe streaming failed in ${this.transcribeRegion}:`,
        error.message || error,
      );
      if (this.isRecording) {
        this.isRecording = false;
        throw new Error("AWS Transcribe streaming failed");
      }
    }
  }

  getDefaultStreamingRegion(region) {
    const streamingRegions = new Set([
      "af-south-1",
      "ap-northeast-1",
      "ap-northeast-2",
      "ap-south-1",
      "ap-southeast-1",
      "ap-southeast-2",
      "ap-southeast-5",
      "ap-southeast-7",
      "ca-central-1",
      "eu-central-1",
      "eu-central-2",
      "eu-west-1",
      "eu-west-2",
      "mx-central-1",
      "sa-east-1",
      "us-east-1",
      "us-east-2",
      "us-west-2",
    ]);

    if (streamingRegions.has(region)) {
      return region;
    }

    if (region.startsWith("eu-")) {
      return "eu-central-1";
    }

    if (region.startsWith("us-")) {
      return "us-east-1";
    }

    if (region.startsWith("ap-")) {
      return "ap-southeast-1";
    }

    return "us-east-1";
  }

  getAvailableRecorder() {
    const preferredRecorders = [
      process.env.AUDIO_RECORDER,
      "sox",
      "rec",
      "arecord",
    ].filter(Boolean);

    return preferredRecorders.find((recorderName) => {
      const result = spawnSync("which", [recorderName], { stdio: "ignore" });
      return result.status === 0;
    });
  }

  async *asyncGenerator(audioStream) {
    const maxChunkSize = 1024 * 8; // Reduce chunk size to 8KB for system audio
    
    for await (const chunk of audioStream) {
      if (chunk.length <= maxChunkSize) {
        yield { AudioEvent: { AudioChunk: chunk } };
      } else {
        // Split large chunks into smaller pieces
        for (let offset = 0; offset < chunk.length; offset += maxChunkSize) {
          const smallChunk = chunk.subarray(offset, offset + maxChunkSize);
          yield {
            AudioEvent: {
              AudioChunk: smallChunk,
            },
          };
        }
      }
    }
  }

  fallbackToMock(reason) {
    console.warn(`${reason}. Audio capture failed - stopping recording.`);
    this.stopLocalRecording();
    this.stopSystemAudio();
    this.stopBrowserStream();
    // Don't start mock transcription - just stop
  }

  stopLocalRecording() {
    if (!this.recording) {
      return;
    }

    try {
      this.recording.stop();
    } catch (error) {
      console.warn("Failed to stop local recorder cleanly:", error.message);
    }

    this.recording = null;
  }

  stopSystemAudio() {
    try {
      this.systemAudioCapture.stop();
    } catch (error) {
      console.warn("Failed to stop system audio capture:", error.message);
    }
  }

  stopBrowserStream() {
    this.browserStreamActive = false;

    if (this.browserAudioStream) {
      this.browserAudioStream.end();
      this.browserAudioStream = null;
    }
  }

  async stop() {
    if (!this.isRecording) {
      throw new Error("Not currently recording");
    }

    this.isRecording = false;

    this.stopLocalRecording();
    this.stopSystemAudio();
    this.stopBrowserStream();

    return { success: true };
  }

  setAudioSourceMode(mode) {
    if (["microphone", "system", "both"].includes(mode)) {
      this.audioSourceMode = mode;
      return true;
    }
    return false;
  }

  getAudioSourceMode() {
    return this.audioSourceMode;
  }

  getAvailableAudioSources() {
    return this.systemAudioCapture.getAvailableAudioSources();
  }

  getAudioSourceInfo() {
    return {
      currentMode: this.audioSourceMode,
      isRecording: this.isRecording,
      availableSources: this.getAvailableAudioSources(),
      systemAudioAvailable: this.systemAudioCapture.isSystemAudioAvailable(),
      ...this.systemAudioCapture.getSourceInfo(),
    };
  }
}

module.exports = { AudioRecorder };
