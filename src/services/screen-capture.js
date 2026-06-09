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
      // Check if screenshot-desktop is available
      if (!screenshot) {
        throw new Error('Screenshot library not available');
      }

      // Platform-specific screenshot options
      const options = {
        format: 'png'
      };

      // Add display selection for multi-monitor setups
      if (displayId !== undefined) {
        options.screen = displayId;
      }

      console.log('Attempting screenshot capture with options:', options);
      const img = await screenshot(options);
      
      if (!img || img.length === 0) {
        throw new Error('Screenshot capture returned empty buffer');
      }
      
      const filename = `screenshot_${Date.now()}.png`;
      const filepath = path.join(this.screenshotPath, filename);
      
      fs.writeFileSync(filepath, img);
      console.log('Screenshot saved to:', filepath);
      
      return {
        path: filepath,
        buffer: img,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Screenshot capture failed:', {
        message: error.message,
        code: error.code,
        platform: process.platform,
        screenshotPath: this.screenshotPath
      });
      
      // Provide platform-specific error messages
      let errorMessage = 'Failed to capture screenshot';
      if (process.platform === 'linux') {
        errorMessage += '. On Linux, try running: sudo apt-get install imagemagick scrot';
      } else if (process.platform === 'win32') {
        errorMessage += '. On Windows, ensure the app has screen capture permissions.';
      } else if (process.platform === 'darwin') {
        errorMessage += '. On macOS, grant screen recording permission in System Preferences > Security & Privacy.';
      }
      
      throw new Error(errorMessage);
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

  async captureWithFallback(displayId = undefined) {
    try {
      return await this.capture(displayId);
    } catch (error) {
      console.warn('Primary screenshot method failed, trying fallback...', error.message);
      
      // Fallback: Try different screenshot methods based on platform
      if (process.platform === 'linux') {
        return await this.captureLinuxFallback();
      } else if (process.platform === 'win32') {
        return await this.captureWindowsFallback();
      } else {
        throw error; // Re-throw if no fallback available
      }
    }
  }

  async captureLinuxFallback() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const filename = `screenshot_${Date.now()}.png`;
      const filepath = path.join(this.screenshotPath, filename);
      
      // Try scrot first, then import (ImageMagick)
      try {
        await execAsync(`scrot '${filepath}'`);
      } catch (scrotError) {
        await execAsync(`import -window root '${filepath}'`);
      }
      
      const img = fs.readFileSync(filepath);
      
      return {
        path: filepath,
        buffer: img,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error('Linux fallback screenshot failed. Install scrot or imagemagick: sudo apt-get install scrot imagemagick');
    }
  }

  async captureWindowsFallback() {
    // Windows fallback using PowerShell
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const filename = `screenshot_${Date.now()}.png`;
      const filepath = path.join(this.screenshotPath, filename);
      
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save('${filepath.replace(/\\/g, '\\')}')
        $graphics.Dispose()
        $bitmap.Dispose()
      `;
      
      await execAsync(`powershell -Command "${psScript}"`);
      const img = fs.readFileSync(filepath);
      
      return {
        path: filepath,
        buffer: img,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error('Windows fallback screenshot failed. Check screen capture permissions.');
    }
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
