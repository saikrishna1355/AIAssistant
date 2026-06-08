require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { InterviewCopilot } = require('./services/interview-copilot');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const copilot = new InterviewCopilot();

// Serve static files
app.use(express.static(path.join(__dirname, 'renderer')));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'renderer', 'web.html'));
});

app.get('/api/config', (req, res) => {
  res.json({
    desktopDownloadUrl: process.env.DESKTOP_DOWNLOAD_URL || '',
    desktopDownloadLabel: process.env.DESKTOP_DOWNLOAD_LABEL || 'Download Desktop App',
    desktopDownloadWin: process.env.DESKTOP_DOWNLOAD_WIN || '',
    desktopDownloadMac: process.env.DESKTOP_DOWNLOAD_MAC || '',
    desktopDownloadLinux: process.env.DESKTOP_DOWNLOAD_LINUX || ''
  });
});

app.post('/api/start-listening', async (req, res) => {
  try {
    const result = await copilot.startListening();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/stop-listening', async (req, res) => {
  try {
    const result = await copilot.stopListening();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/take-screenshot', async (req, res) => {
  try {
    const result = await copilot.takeScreenshot();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/generate-answer', async (req, res) => {
  try {
    const { question, type, options } = req.body;
    const answer = await copilot.generateAnswer(question, type, options);
    res.json({ success: true, answer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/debug-code', async (req, res) => {
  try {
    const { input } = req.body;
    const answer = await copilot.debugCode(input);
    res.json({ success: true, answer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Socket.io for real-time communication
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Store socket reference for copilot to emit events
  global.socketIO = socket;

  socket.on('browser-audio-start', async ({ sampleRate }, callback) => {
    const result = await copilot.startBrowserListening(sampleRate);
    if (typeof callback === 'function') {
      callback(result);
    }
  });

  socket.on('browser-audio-chunk', (chunk) => {
    copilot.writeBrowserAudio(chunk);
  });

  socket.on('browser-audio-stop', async (callback) => {
    const result = await copilot.stopListening();
    if (typeof callback === 'function') {
      callback(result);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3003;
server.on('error', (error) => {
  console.error(`Failed to start Interview Copilot AI server on port ${PORT}:`, error.message);
  process.exitCode = 1;
});

const ready = new Promise((resolve) => {
  server.listen(PORT, () => {
    console.log(`🦜 Interview Copilot AI Server running on http://localhost:${PORT}`);
    resolve(PORT);
  });
});

module.exports = { ready };
