const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

class ScreenCapture {
  constructor(options = {}) {
    this.screenshotPath = options.screenshotPath || process.env.SCREENSHOT_TEMP_DIR || path.join(process.cwd(), 'temp');
    this.electronCaptureProvider = options.electronCaptureProvider || null;
    this.ensureTempDirectory();
  }

  setElectronCaptureProvider(provider) {
    this.electronCaptureProvider = provider;
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
    if (process.platform === 'win32' && this.electronCaptureProvider) {
      try {
        console.log('Trying Electron desktopCapturer screenshot provider first');
        return await this.electronCaptureProvider(displayId);
      } catch (error) {
        console.warn('Electron desktopCapturer screenshot failed, trying screenshot-desktop:', error.message);
      }
    }

    try {
      return await this.capture(displayId);
    } catch (error) {
      console.warn('Primary screenshot method failed, trying fallback...', error.message);

      if (this.electronCaptureProvider) {
        try {
          console.log('Trying Electron desktopCapturer screenshot provider after primary failure');
          return await this.electronCaptureProvider(displayId);
        } catch (electronError) {
          console.warn('Electron desktopCapturer fallback failed:', electronError.message);
        }
      }
      
      // Fallback: Try different screenshot methods based on platform
      if (process.platform === 'linux') {
        return await this.captureLinuxFallback();
      } else if (process.platform === 'win32') {
        try {
          return await this.captureWindowsFallback();
        } catch (fallbackError) {
          // If Windows fallback fails, try to diagnose and provide helpful error
          console.error('Windows fallback failed:', fallbackError.message);
          
          try {
            const diagnosis = await this.diagnoseWindowsIssues();
            let errorMessage = 'Windows screenshot failed. ';
            
            if (diagnosis.suggestions.length > 0) {
              errorMessage += 'Suggested fixes:\n' + diagnosis.suggestions.map(s => `• ${s}`).join('\n');
            }
            
            throw new Error(errorMessage);
          } catch (diagError) {
            // If diagnosis fails, provide basic error
            throw new Error(`Windows screenshot failed: ${fallbackError.message}. Try running as Administrator or check Windows Privacy Settings > Screen recording.`);
          }
        }
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

  async checkWindowsPermissions() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      // Check if PowerShell can access screen capture APIs
      const testScript = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
      `;
      
      const result = await execAsync(`powershell -Command "${testScript}"`);
      return result.stdout.trim() !== '0';
    } catch (error) {
      console.error('Permission check failed:', error.message);
      return false;
    }
  }

  async captureWindowsFallback() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      // First check permissions
      const hasPermissions = await this.checkWindowsPermissions();
      if (!hasPermissions) {
        throw new Error('Screen capture permissions denied. Grant screen recording access in Windows Settings > Privacy & security > Screen recording');
      }
      
      const filename = `screenshot_${Date.now()}.png`;
      const filepath = path.join(this.screenshotPath, filename).replace(/\\/g, '/');
      
      // Try multiple Windows screenshot methods
      const methods = [
        // Method 1: PowerShell with System.Drawing
        async () => {
          const psScript = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            try {
              $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
              $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
              $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
              $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
              $bitmap.Save('${filepath}', [System.Drawing.Imaging.ImageFormat]::Png)
              $graphics.Dispose()
              $bitmap.Dispose()
              Write-Output "SUCCESS"
            } catch {
              Write-Error $_.Exception.Message
            }
          `;
          
          const result = await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psScript}"`);
          if (!result.stdout.includes('SUCCESS')) {
            throw new Error('PowerShell screenshot failed');
          }
        },
        
        // Method 2: PowerShell with Windows.Graphics.Capture (Windows 10+)
        async () => {
          const winScript = `
            Add-Type -AssemblyName PresentationCore
            Add-Type -TypeDefinition '
              using System;
              using System.Drawing;
              using System.Drawing.Imaging;
              using System.Windows.Forms;
              
              public class ScreenCapture {
                public static void CaptureScreen(string filename) {
                  Rectangle bounds = Screen.PrimaryScreen.Bounds;
                  using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height)) {
                    using (Graphics g = Graphics.FromImage(bitmap)) {
                      g.CopyFromScreen(Point.Empty, Point.Empty, bounds.Size);
                    }
                    bitmap.Save(filename, ImageFormat.Png);
                  }
                }
              }
            ' -ReferencedAssemblies System.Drawing, System.Windows.Forms
            
            [ScreenCapture]::CaptureScreen('${filepath}')
          `;
          
          await execAsync(`powershell -ExecutionPolicy Bypass -Command "${winScript}"`);
        },
        
        // Method 3: Using nircmd (if available)
        async () => {
          try {
            await execAsync(`nircmd savescreenshot '${filepath}'`);
          } catch (error) {
            throw new Error('nircmd not available. Install nircmd for additional screenshot support.');
          }
        }
      ];
      
      let lastError;
      for (const method of methods) {
        try {
          await method();
          
          // Check if file was created successfully
          if (fs.existsSync(filepath)) {
            const img = fs.readFileSync(filepath);
            if (img.length > 0) {
              console.log('Windows fallback screenshot successful:', filepath);
              return {
                path: filepath,
                buffer: img,
                timestamp: new Date().toISOString()
              };
            }
          }
        } catch (error) {
          lastError = error;
          console.warn(`Screenshot method failed: ${error.message}`);
          continue;
        }
      }
      
      throw lastError || new Error('All Windows screenshot methods failed');
      
    } catch (error) {
      console.error('Windows screenshot error:', error.message);
      
      // Provide detailed error message with solutions
      let errorMessage = 'Windows screenshot failed. ';
      
      if (error.message.includes('permissions') || error.message.includes('access')) {
        errorMessage += 'Please check Windows Settings > Privacy & security > Screen recording and ensure this app has permission.';
      } else if (error.message.includes('PowerShell')) {
        errorMessage += 'PowerShell execution failed. Try running as administrator or check PowerShell execution policy.';
      } else {
        errorMessage += 'Try one of these solutions:\n';
        errorMessage += '1. Run the app as administrator\n';
        errorMessage += '2. Check Windows Privacy settings for Screen recording\n';
        errorMessage += '3. Disable Windows Defender real-time protection temporarily\n';
        errorMessage += '4. Install nircmd utility for additional screenshot support';
      }
      
      throw new Error(errorMessage);
    }
  }

  async diagnoseWindowsIssues() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const diagnostics = {
      isAdmin: false,
      powershellAccess: false,
      screenApiAccess: false,
      executionPolicy: 'unknown',
      suggestions: []
    };
    
    try {
      // Check if running as admin
      try {
        await execAsync('net session');
        diagnostics.isAdmin = true;
      } catch (error) {
        diagnostics.suggestions.push('Try running the application as Administrator');
      }
      
      // Check PowerShell execution policy
      try {
        const result = await execAsync('powershell -Command "Get-ExecutionPolicy"');
        diagnostics.executionPolicy = result.stdout.trim();
        diagnostics.powershellAccess = true;
        
        if (diagnostics.executionPolicy === 'Restricted') {
          diagnostics.suggestions.push('PowerShell execution is restricted. Run: Set-ExecutionPolicy RemoteSigned');
        }
      } catch (error) {
        diagnostics.suggestions.push('PowerShell access denied. Check Windows security settings.');
      }
      
      // Test screen capture API access
      try {
        const testResult = await execAsync('powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width"');
        diagnostics.screenApiAccess = testResult.stdout.trim() !== '0';
      } catch (error) {
        diagnostics.suggestions.push('Screen capture API blocked. Check Windows Privacy Settings > Screen recording');
      }
      
      if (!diagnostics.screenApiAccess) {
        diagnostics.suggestions.push('Grant screen recording permission in Windows Settings > Privacy & security > Screen recording');
        diagnostics.suggestions.push('Add this application to the list of allowed apps');
      }
      
    } catch (error) {
      diagnostics.suggestions.push('General system access issue. Try running as Administrator.');
    }
    
    return diagnostics;
  }

  async fixWindowsPermissions() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      console.log('Attempting to fix Windows screenshot permissions...');
      
      // Try to set PowerShell execution policy
      try {
        await execAsync('powershell -Command "Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force"');
        console.log('✓ PowerShell execution policy updated');
      } catch (error) {
        console.warn('⚠ Could not update PowerShell execution policy:', error.message);
      }
      
      // Test if fix worked
      const diagnosis = await this.diagnoseWindowsIssues();
      
      if (diagnosis.screenApiAccess) {
        console.log('✓ Screen capture permissions are working');
        return { success: true, message: 'Permissions fixed successfully' };
      } else {
        return {
          success: false,
          message: 'Manual permission setup required',
          suggestions: diagnosis.suggestions
        };
      }
      
    } catch (error) {
      return {
        success: false,
        message: 'Permission fix failed',
        error: error.message,
        suggestions: [
          'Run application as Administrator',
          'Open Windows Settings > Privacy & security > Screen recording',
          'Enable "Let apps access screen recording"',
          'Add this app to allowed applications'
        ]
      };
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
