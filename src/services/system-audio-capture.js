const { spawnSync, spawn } = require("child_process");
const { PassThrough } = require("stream");
const os = require("os");

class SystemAudioCapture {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.platform = os.platform();
    this.audioSource = null;
  }

  /**
   * Get available system audio devices and sources
   */
  getAvailableAudioSources() {
    const sources = {
      microphone: [],
      system: [],
      loopback: []
    };

    try {
      if (this.platform === "linux") {
        // Use PulseAudio to get loopback sources
        const result = spawnSync("pactl", ["list", "sources"], { 
          encoding: "utf8", 
          stdio: ["pipe", "pipe", "ignore"] 
        });
        
        if (result.status === 0) {
          const monitors = result.stdout
            .split("\n")
            .filter(line => line.includes(".monitor"))
            .map(line => line.split("Name: ")[1])
            .filter(Boolean);
          
          sources.loopback = monitors;
          sources.system = monitors.length > 0 ? ["pulse-loopback"] : [];
        }
      } else if (this.platform === "win32") {
        // Windows: Use WASAPI loopback
        sources.system = ["wasapi-loopback"];
        sources.loopback = ["WASAPI"];
      } else if (this.platform === "darwin") {
        // macOS: Check for BlackHole or Soundflower
        const result = spawnSync("system_profiler", ["SPAudioDataType", "-json"], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"]
        });
        
        if (result.status === 0) {
          try {
            const audioData = JSON.parse(result.stdout);
            // Look for virtual audio devices
            sources.system = ["macos-loopback"];
          } catch (e) {
            sources.system = [];
          }
        }
      }

      // Always include microphone options
      sources.microphone = ["sox", "rec", "arecord"];
      
    } catch (error) {
      console.warn("Failed to detect audio sources:", error.message);
    }

    return sources;
  }

  /**
   * Start capturing system audio (loopback)
   */
  startSystemCapture() {
    if (this.isRecording) {
      throw new Error("Already recording");
    }

    const audioStream = new PassThrough();
    
    if (this.platform === "linux") {
      return this.startLinuxLoopback(audioStream);
    } else if (this.platform === "win32") {
      return this.startWindowsLoopback(audioStream);
    } else if (this.platform === "darwin") {
      return this.startMacOSLoopback(audioStream);
    } else {
      throw new Error(`System audio capture not supported on ${this.platform}`);
    }
  }

  /**
   * Linux: Use PulseAudio loopback
   */
  startLinuxLoopback(audioStream) {
    // First try to find a monitor source
    const result = spawnSync("pactl", ["list", "sources", "short"], { 
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    
    let monitorSource = null;
    if (result.status === 0) {
      const lines = result.stdout.split("\n");
      monitorSource = lines
        .find(line => line.includes(".monitor"))
        ?.split("\t")[1];
    }

    if (!monitorSource) {
      // Fallback to default monitor
      monitorSource = "@DEFAULT_MONITOR@";
    }

    console.log(`Using PulseAudio source: ${monitorSource}`);

    this.recording = spawn("parec", [
      "--device", monitorSource,
      "--format", "s16le",
      "--rate", "16000",
      "--channels", "1",
      "--latency", "50000", // 50ms latency
      "--buffer-size", "8192"  // 8KB buffer
    ]);

    this.recording.stdout.pipe(audioStream);
    this.isRecording = true;
    this.audioSource = "linux-pulse";
    
    return { stream: audioStream, source: monitorSource };
  }

  /**
   * Windows: Use WASAPI loopback
   */
  startWindowsLoopback(audioStream) {
    // Use FFmpeg with WASAPI loopback and smaller buffer
    const ffmpegArgs = [
      "-f", "wasapi",
      "-i", "audio=",
      "-f", "s16le",
      "-ar", "16000",
      "-ac", "1",
      "-bufsize", "8192", // 8KB buffer
      "-"
    ];

    this.recording = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "ignore"]
    });

    this.recording.stdout.pipe(audioStream);
    this.isRecording = true;
    this.audioSource = "windows-wasapi";

    return { stream: audioStream, source: "WASAPI Loopback" };
  }

  /**
   * macOS: Use BlackHole or system audio
   */
  startMacOSLoopback(audioStream) {
    // Try BlackHole first, then system audio
    const sources = ["BlackHole 2ch", "Soundflower (2ch)", "Built-in Output"];
    let selectedSource = null;

    for (const source of sources) {
      const testResult = spawnSync("ffmpeg", [
        "-list_devices", "true",
        "-f", "avfoundation",
        "-i", "dummy"
      ], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });

      if (testResult.stderr && testResult.stderr.includes(source)) {
        selectedSource = source;
        break;
      }
    }

    if (!selectedSource) {
      selectedSource = ":1"; // Default audio input device
    }

    console.log(`Using macOS audio source: ${selectedSource}`);

    this.recording = spawn("ffmpeg", [
      "-f", "avfoundation",
      "-i", selectedSource,
      "-f", "s16le",
      "-ar", "16000",
      "-ac", "1",
      "-bufsize", "8192", // 8KB buffer
      "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });

    this.recording.stdout.pipe(audioStream);
    this.isRecording = true;
    this.audioSource = "macos-avfoundation";

    return { stream: audioStream, source: selectedSource };
  }

  /**
   * Check if system audio capture is available
   */
  isSystemAudioAvailable() {
    try {
      if (this.platform === "linux") {
        const result = spawnSync("which", ["parec"], { stdio: "ignore" });
        return result.status === 0;
      } else if (this.platform === "win32") {
        const result = spawnSync("where", ["ffmpeg"], { stdio: "ignore" });
        return result.status === 0;
      } else if (this.platform === "darwin") {
        const result = spawnSync("which", ["ffmpeg"], { stdio: "ignore" });
        return result.status === 0;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Stop audio capture
   */
  stop() {
    if (!this.isRecording || !this.recording) {
      return;
    }

    try {
      this.recording.kill("SIGTERM");
      // Force kill after 2 seconds if needed
      setTimeout(() => {
        if (this.recording && !this.recording.killed) {
          this.recording.kill("SIGKILL");
        }
      }, 2000);
    } catch (error) {
      console.warn("Failed to stop system audio capture:", error.message);
    }

    this.recording = null;
    this.isRecording = false;
    this.audioSource = null;
  }

  /**
   * Get current audio source info
   */
  getSourceInfo() {
    return {
      isRecording: this.isRecording,
      platform: this.platform,
      audioSource: this.audioSource,
      available: this.isSystemAudioAvailable()
    };
  }
}

module.exports = { SystemAudioCapture };