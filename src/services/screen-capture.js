const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

class ScreenCapture {
  constructor(options = {}) {
    this.screenshotPath = options.screenshotPath || process.env.SCREENSHOT_TEMP_DIR || path.join(process.cwd(), 'temp');
    this.ensureTempDirectory();
  }

  ensureTempDirectory() {
    try {
      if (!fs.existsSync(this.screenshotPath)) {
        fs.mkdirSync(this.screenshotPath, { recursive: true });
      }
    } catch (error) {
      throw new Error(`Failed to create screenshot temp directory at ${this.screenshotPath}: ${error.message}`);
    }
  }

  async capture(displayId = undefined) {
    try {
      const img = await screenshot({ 
        format: 'png',
        screen: displayId 
      });
      
      const filename = `screenshot_${Date.now()}.png`;
      const filepath = path.join(this.screenshotPath, filename);
      
      fs.writeFileSync(filepath, img);
      
      return {
        path: filepath,
        buffer: img,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      throw new Error('Failed to capture screenshot');
    }
  }

  async extractText(screenshotData) {
    try {
      const { data: { text } } = await Tesseract.recognize(
        screenshotData.buffer,
        'eng',
        {
          logger: m => console.log(m) // Optional: for debugging
        }
      );

      return text.trim();
    } catch (error) {
      console.error('OCR failed:', error);
      throw new Error('Failed to extract text from screenshot');
    }
  }

  async captureRegion(x, y, width, height) {
    // Capture specific screen region
    // This would require additional screen capture library capabilities
    throw new Error('Region capture not implemented yet');
  }

  cleanup() {
    // Clean up temporary screenshot files
    try {
      const files = fs.readdirSync(this.screenshotPath);
      const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
      
      files.forEach(file => {
        const filepath = path.join(this.screenshotPath, file);
        const stats = fs.statSync(filepath);
        
        if (stats.mtime.getTime() < cutoff) {
          fs.unlinkSync(filepath);
        }
      });
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
}

module.exports = { ScreenCapture };
