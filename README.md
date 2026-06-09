# Interview Copilot AI

Desktop-first AI interview and coding copilot inspired by ParakeetAI. The app listens to interview audio, streams speech through AWS Transcribe, detects likely questions, and uses AWS Bedrock to generate concise interview answers, coding solutions, and debugging guidance.

## What It Does

- Real-time speech transcription with AWS Transcribe Streaming
- Automatic question detection and classification
- Behavioral interview answers using STAR structure
- Technical and system-design answer support
- Coding interview solutions with approach, complexity, code, dry run, and edge cases
- Screenshot OCR for HackerRank, LeetCode, CodeSignal, CoderPad, shared Zoom/Meet screens, and similar surfaces
- Manual prompt/debug composer for pasted questions or broken code
- Electron desktop app plus an Express web fallback

## Stack

- Electron desktop shell
- Express + Socket.IO web fallback
- AWS Bedrock Runtime for LLM generation
- AWS Transcribe Streaming for live speech-to-text
- Tesseract.js and screenshot-desktop for local screen OCR

## Setup

1. Install Node dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set AWS credentials:

   ```bash
   cp .env.example .env
   ```

3. Confirm Bedrock model access in the configured AWS region. The default model is:

   ```text
   anthropic.claude-3-sonnet-20240229-v1:0
   ```

4. Start the desktop app:

   ```bash
   npm run electron
   ```

5. Or run the browser fallback:

   ```bash
   npm start
   ```

   Then open `http://localhost:3003`.

## Local Audio Notes

`node-record-lpcm16` requires a local recording binary. On Linux, install SoX:

```bash
sudo apt-get install sox
```

If AWS Transcribe or local audio is unavailable, the app falls back to demo transcription events so the UI can still be tested.

## Environment

```text
PORT=3003
NODE_ENV=development
REMOTE_API_BASE_URL=
REMOTE_API_KEY=
AWS_REGION=us-east-1
TRANSCRIBE_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_SESSION_TOKEN=
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
BEDROCK_INFERENCE_PROFILE_ID=
ALWAYS_ON_TOP=false
OVERLAY_OPACITY=0.88
AUDIO_RECORDER=
DESKTOP_DOWNLOAD_URL=
DESKTOP_DOWNLOAD_LABEL=Download Desktop App
```

Set `REMOTE_API_BASE_URL=https://your-render-app.onrender.com` in the desktop app to send answer generation to your hosted backend. In that mode, desktop users do not need AWS Bedrock credentials locally for answer generation.
Set `ALWAYS_ON_TOP=true` for an overlay-like desktop utility window.
Set `AUDIO_RECORDER=arecord`, `sox`, or `rec` to force a specific local recorder.
For Claude 4.5 models that do not support on-demand invocation, set `BEDROCK_INFERENCE_PROFILE_ID` instead, for example `eu.anthropic.claude-haiku-4-5-20251001-v1:0` in EU regions.
Set `TRANSCRIBE_REGION` to an Amazon Transcribe Streaming-supported region. For example, use `eu-central-1` when `AWS_REGION=eu-north-1`, because Stockholm currently supports Transcribe batch but not streaming.

## Overlay

Run `npm run electron` for the desktop overlay. Click `Open Overlay`, or click `Start Listening` in the desktop app, to open an always-on-top visible overlay with live transcript, latest question, latest answer, listening controls, and screen reading. Browser tabs cannot create a system-wide overlay or continue after the tab is closed. Use `OVERLAY_OPACITY=0.88` to tune transparency.

Overlay controls:

- `Ctrl+Shift+O`: toggle overlay visibility
- `Ctrl+Shift+P`: toggle privacy mode
- `Ctrl+Shift+F`: toggle focus mode
- `Ctrl+Shift+D`: cycle dock mode
- `Ctrl+Shift+M`: move overlay to next monitor

The overlay is a standard visible desktop window.

## Hosted Web + Desktop Download

When hosting the web app on Render, set `DESKTOP_DOWNLOAD_URL` to your latest Electron installer page or direct file URL. The hosted web UI will show a `Download Desktop App` card that points users to the installer.

Example:

```text
DESKTOP_DOWNLOAD_URL=https://github.com/your-org/interview-copilot-ai/releases/latest
DESKTOP_DOWNLOAD_LABEL=Download Desktop App
```

Build desktop installers separately with `npm run build`, then upload the generated files to GitHub Releases, S3, Cloudflare R2, or another static download host.
