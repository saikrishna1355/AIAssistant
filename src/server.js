require("dotenv").config();
process.env.INTERVIEW_COPILOT_SERVER = "true";
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { InterviewCopilot } = require("./services/interview-copilot");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const copilot = new InterviewCopilot();

function safeJson(details = {}) {
  try {
    return JSON.stringify(details, (key, value) => {
      const loweredKey = key.toLowerCase();
      if (
        loweredKey.includes("secret") ||
        loweredKey.includes("token") ||
        loweredKey.includes("password") ||
        loweredKey.includes("credential") ||
        loweredKey.includes("accesskey")
      ) {
        return "[redacted]";
      }

      if (Buffer.isBuffer(value)) {
        return `[buffer:${value.length}]`;
      }

      if (typeof value === "string" && value.length > 300) {
        return `[string:${value.length}]`;
      }

      return value;
    });
  } catch (error) {
    return JSON.stringify({ loggingError: error.message });
  }
}

function serverLog(event, details = {}) {
  console.log(
    `[${new Date().toISOString()}] [server] ${event} ${safeJson(details)}`,
  );
}

function serverError(event, error, details = {}) {
  console.error(
    `[${new Date().toISOString()}] [server:error] ${event} ${safeJson(details)}`,
    error && (error.stack || error.message || error),
  );
}

// Serve static files
app.use(express.static(path.join(__dirname, "renderer")));
app.use(express.json());

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }

  const startedAt = Date.now();
  res.on("finish", () => {
    serverLog("http_request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
});

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "renderer", "web.html"));
});

app.get("/api/config", (req, res) => {
  const config = {
    desktopDownloadUrl: process.env.DESKTOP_DOWNLOAD_URL || "",
    desktopDownloadLabel:
      process.env.DESKTOP_DOWNLOAD_LABEL || "Download Desktop App",
    desktopDownloadWin: process.env.DESKTOP_DOWNLOAD_WIN || "",
    desktopDownloadMac: process.env.DESKTOP_DOWNLOAD_MAC || "",
    desktopDownloadLinux: process.env.DESKTOP_DOWNLOAD_LINUX || "",
  };

  serverLog("config_requested", {
    hasDefaultDownload: Boolean(config.desktopDownloadUrl),
    hasWindowsDownload: Boolean(config.desktopDownloadWin),
    hasMacDownload: Boolean(config.desktopDownloadMac),
    hasLinuxDownload: Boolean(config.desktopDownloadLinux),
  });

  res.json(config);
});

app.post("/api/start-listening", async (req, res) => {
  serverLog("start_listening_requested");
  try {
    const result = await copilot.startListening();
    serverLog("start_listening_completed", {
      success: result.success,
      message: result.message,
    });
    res.json(result);
  } catch (error) {
    serverError("start_listening_failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/stop-listening", async (req, res) => {
  serverLog("stop_listening_requested");
  try {
    const result = await copilot.stopListening();
    serverLog("stop_listening_completed", {
      success: result.success,
      message: result.message,
    });
    res.json(result);
  } catch (error) {
    serverError("stop_listening_failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/take-screenshot", async (req, res) => {
  serverLog("take_screenshot_requested");
  try {
    const result = await copilot.takeScreenshot();
    serverLog("take_screenshot_completed", {
      success: result.success,
      extractedTextLength: result.extractedText
        ? result.extractedText.length
        : 0,
      type: result.type || null,
      hasSolution: Boolean(result.solution),
    });
    res.json(result);
  } catch (error) {
    serverError("take_screenshot_failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/generate-answer", async (req, res) => {
  try {
    const { question, type, options } = req.body;
    serverLog("generate_answer_requested", {
      type: type || "general",
      questionLength: question ? question.length : 0,
      hasOptions: Boolean(options && Object.keys(options).length),
    });
    const answer = await copilot.generateAnswer(question, type, options);
    serverLog("generate_answer_completed", {
      answerLength: answer ? answer.length : 0,
    });
    res.json({ success: true, answer });
  } catch (error) {
    serverError("generate_answer_failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/debug-code", async (req, res) => {
  try {
    const { input } = req.body;
    serverLog("debug_code_requested", {
      inputLength: input ? input.length : 0,
    });
    const answer = await copilot.debugCode(input);
    serverLog("debug_code_completed", {
      answerLength: answer ? answer.length : 0,
    });
    res.json({ success: true, answer });
  } catch (error) {
    serverError("debug_code_failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Socket.io for real-time communication
io.on("connection", (socket) => {
  let audioChunkCount = 0;
  let audioStartedAt = null;
  serverLog("socket_connected", {
    socketId: socket.id,
    transport:
      socket.conn && socket.conn.transport
        ? socket.conn.transport.name
        : "unknown",
  });

  // Store socket reference for copilot to emit events
  global.socketIO = socket;

  socket.on("browser-audio-start", async ({ sampleRate }, callback) => {
    serverLog("browser_audio_start_requested", {
      socketId: socket.id,
      sampleRate,
    });

    try {
      audioChunkCount = 0;
      audioStartedAt = Date.now();
      const result = await copilot.startBrowserListening(sampleRate);
      serverLog("browser_audio_start_completed", {
        socketId: socket.id,
        success: result.success,
        message: result.message,
      });
      if (typeof callback === "function") {
        callback(result);
      }
    } catch (error) {
      serverError("browser_audio_start_failed", error, { socketId: socket.id });
      if (typeof callback === "function") {
        callback({ success: false, message: error.message });
      }
    }
  });

  socket.on("browser-audio-chunk", (chunk) => {
    audioChunkCount += 1;
    copilot.writeBrowserAudio(chunk);
  });

  socket.on("browser-audio-stop", async (callback) => {
    serverLog("browser_audio_stop_requested", {
      socketId: socket.id,
      chunks: audioChunkCount,
      durationMs: audioStartedAt ? Date.now() - audioStartedAt : 0,
    });

    try {
      const result = await copilot.stopListening();
      serverLog("browser_audio_stop_completed", {
        socketId: socket.id,
        success: result.success,
        message: result.message,
        chunks: audioChunkCount,
      });
      if (typeof callback === "function") {
        callback(result);
      }
    } catch (error) {
      serverError("browser_audio_stop_failed", error, { socketId: socket.id });
      if (typeof callback === "function") {
        callback({ success: false, message: error.message });
      }
    }
  });

  socket.on("disconnect", () => {
    serverLog("socket_disconnected", {
      socketId: socket.id,
      chunks: audioChunkCount,
      durationMs: audioStartedAt ? Date.now() - audioStartedAt : 0,
    });
  });
});

const PORT = process.env.PORT || 3003;

const ready = new Promise((resolve, reject) => {
  server.on("error", (error) => {
    serverError("server_start_failed", error, { port: PORT });
    reject(error);
  });

  server.listen(PORT, () => {
    serverLog("startup_config", {
      port: PORT,
      nodeEnv: process.env.NODE_ENV || "development",
      awsRegion: process.env.AWS_REGION || "eu-north-1",
      transcribeRegion:
        process.env.TRANSCRIBE_REGION ||
        process.env.AWS_REGION ||
        "eu-central-1",
      bedrockModelConfigured: Boolean(
        process.env.BEDROCK_MODEL_ID ||
        process.env.BEDROCK_MODEL ||
        "anthropic.claude-haiku-4-5-20251001-v1:0",
      ),
      inferenceProfileConfigured: Boolean(
        process.env.BEDROCK_INFERENCE_PROFILE_ID ||
        "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      ),
      desktopDownloadConfigured: Boolean(
        process.env.DESKTOP_DOWNLOAD_URL ||
        process.env.DESKTOP_DOWNLOAD_WIN ||
        process.env.DESKTOP_DOWNLOAD_MAC ||
        process.env.DESKTOP_DOWNLOAD_LINUX,
      ),
    });
    console.log(
      `🦜 Interview Copilot AI Server running on http://localhost:${PORT}`,
    );
    resolve(PORT);
  });
});

module.exports = { ready };
