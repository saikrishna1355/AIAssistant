const { app, BrowserWindow } = require('electron');

console.log('Testing electron app object:', typeof app);
console.log('App available:', !!app);

if (app) {
  console.log('App whenReady:', typeof app.whenReady);
  
  function createWindow() {
    console.log('Creating window...');
    const mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    
    mainWindow.loadURL('data:text/html,<h1>Electron Test</h1>');
  }
  
  app.whenReady().then(() => {
    console.log('App ready!');
    createWindow();
  });
  
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
} else {
  console.error('Electron app not available');
}