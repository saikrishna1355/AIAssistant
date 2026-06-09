const { spawn } = require('child_process');
const electronPath = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..', 'src', 'main.js')], {
  stdio: 'inherit',
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code || 0);
});

child.on('error', (error) => {
  console.error('Failed to launch Electron:', error);
  process.exit(1);
});
