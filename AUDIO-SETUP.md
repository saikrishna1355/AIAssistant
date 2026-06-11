# Audio Source Configuration

The Interview Copilot AI now supports multiple audio input sources to capture audio from video calls, system output, and microphone input.

## Configuration

### Environment Variables

Set the audio source mode in your `.env` file:

```env
AUDIO_SOURCE_MODE=system  # Options: microphone, system, both
```

### Audio Source Modes

- **microphone** (default): Captures user's microphone input
- **system**: Captures system audio output (loopback) - detects audio from Teams, Zoom, Meet, WhatsApp, etc.
- **both**: Captures and mixes both microphone and system audio

## Platform Setup

### Linux (Ubuntu/Debian)

Install PulseAudio utilities:
```bash
sudo apt-get install pulseaudio-utils
```

The application will automatically use `parec` to capture from PulseAudio monitor sources.

### Windows

Install FFmpeg with WASAPI support:
```bash
winget install FFmpeg
```

Or download from: https://ffmpeg.org/download.html#build-windows

### macOS

Install FFmpeg with AVFoundation support:
```bash
brew install ffmpeg
```

For better system audio capture, install BlackHole:
```bash
brew install blackhole-2ch
```

## API Usage

### Get Available Audio Sources

```bash
curl http://localhost:3003/api/audio-sources
```

Response:
```json
{
  "success": true,
  "sources": {
    "microphone": ["sox", "rec", "arecord"],
    "system": ["pulse-loopback"],
    "loopback": ["alsa_output.pci-0000_00_1f.3.analog-stereo.monitor"]
  },
  "info": {
    "currentMode": "system",
    "isRecording": false,
    "systemAudioAvailable": true
  }
}
```

### Change Audio Mode

```bash
curl -X POST http://localhost:3003/api/set-audio-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "system"}'
```

## Usage Examples

### Capture Teams/Zoom Audio

1. Set environment variable:
   ```env
   AUDIO_SOURCE_MODE=system
   ```

2. Start the application:
   ```bash
   npm start
   ```

3. Click "Start Listening" - it will now capture system audio instead of microphone

### Capture Both Participants and Your Voice

1. Set environment variable:
   ```env
   AUDIO_SOURCE_MODE=both
   ```

2. This will mix microphone input with system audio output

### Switch Modes Dynamically

Use the API to change modes without restarting:

```javascript
// Switch to system audio
fetch('/api/set-audio-mode', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'system' })
});
```

## Troubleshooting

### Linux

If system audio capture fails:
```bash
# Check PulseAudio sources
pactl list sources short

# Test audio capture
parec --device=@DEFAULT_MONITOR@ --format=s16le --rate=16000 --channels=1 | aplay
```

### Windows

If WASAPI fails:
```bash
# Test FFmpeg WASAPI
ffmpeg -list_devices true -f dshow -i dummy
ffmpeg -f wasapi -i audio= -t 5 test.wav
```

### macOS

If system audio capture fails:
```bash
# List audio devices
ffmpeg -f avfoundation -list_devices true -i ""

# Test capture
ffmpeg -f avfoundation -i ":1" -t 5 test.wav
```

## Security Notes

- System audio capture requires appropriate permissions on each platform
- Some corporate environments may block loopback audio access
- The application only processes audio locally and streams to AWS Transcribe
- No audio data is stored locally beyond transcription processing