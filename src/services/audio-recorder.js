const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const record = require("node-record-lpcm16");
const { spawnSync } = require("child_process");
const { PassThrough } = require("stream");

class AudioRecorder {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.transcriptionCallback = null;
    this.mockInterval = null;
    this.browserAudioStream = null;
    this.browserStreamActive = false;
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
      this.startAWSTranscribeStreaming().catch((error) => {
        console.error("Transcription stream stopped:", error);
        if (this.isRecording) {
          this.startMockTranscription();
        }
      });
      return { success: true };
    } catch (error) {
      console.error("Failed to start transcription:", error);
      this.isRecording = false;
      throw error;
    }
  }

  async startAWSTranscribeStreaming() {
    const recorderName = this.getAvailableRecorder();
    if (!recorderName) {
      console.warn(
        "No local recorder binary found. Install SoX or arecord for live audio. Falling back to demo transcription.",
      );
      this.startMockTranscription();
      return;
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
      this.fallbackToMock("local recorder stream failed");
    });

    if (this.recording.process) {
      this.recording.process.on("error", (error) => {
        if (!this.isRecording) {
          return;
        }

        console.error("Local recorder process error:", error.message);
        this.fallbackToMock("local recorder process failed");
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
          this.fallbackToMock("browser microphone transcription failed");
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
              if (transcript && transcript.trim().length > 0) {
                this.transcriptionCallback(transcript.trim(), {
                  isPartial: result.IsPartial,
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
        this.fallbackToMock("AWS Transcribe streaming failed");
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
    for await (const chunk of audioStream) {
      if (chunk.length <= 1024 * 32) {
        yield { AudioEvent: { AudioChunk: chunk } };
      } else {
        for (let offset = 0; offset < chunk.length; offset += 1024 * 32) {
          yield {
            AudioEvent: {
              AudioChunk: chunk.subarray(offset, offset + 1024 * 32),
            },
          };
        }
      }
    }
  }

  fallbackToMock(reason) {
    console.warn(`${reason}. Falling back to demo transcription.`);
    this.stopLocalRecording();
    this.stopBrowserStream();
    this.startMockTranscription();
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

  stopBrowserStream() {
    this.browserStreamActive = false;

    if (this.browserAudioStream) {
      this.browserAudioStream.end();
      this.browserAudioStream = null;
    }
  }

  startMockTranscription() {
    if (this.mockInterval) {
      return;
    }

    // Fallback mock transcription for demo purposes
    const mockQuestions = [
      "Tell me about a time you faced a challenge",
      "How would you implement a binary search algorithm?",
      "What are your greatest strengths and weaknesses?",
      "Explain how you would reverse a linked list",
      "Describe a situation where you had to work with a difficult team member",
      "Write a function to find the maximum element in an array",
      "How do you handle stress and pressure?",
      "Implement a function to check if a string is a palindrome",
    ];

    const mockInterval = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(mockInterval);
        return;
      }

      if (Math.random() < 0.4) {
        const question =
          mockQuestions[Math.floor(Math.random() * mockQuestions.length)];
        this.transcriptionCallback(question, { isPartial: false });
      }
    }, 5000);

    this.mockInterval = mockInterval;
  }

  async stop() {
    if (!this.isRecording) {
      throw new Error("Not currently recording");
    }

    this.isRecording = false;

    this.stopLocalRecording();
    this.stopBrowserStream();

    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }

    return { success: true };
  }
}

module.exports = { AudioRecorder };
