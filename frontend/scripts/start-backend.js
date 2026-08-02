const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 1. Load .env from project root
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

// Resolve host and port
const host = process.env.HOST || '0.0.0.0';
const port = process.env.BACKEND_PORT || 8842;
const isProd = process.env.NODE_ENV === 'production';

const backendPath = path.resolve(__dirname, '../../backend/app.py');
const rootPath = path.resolve(__dirname, '../../');
const venvPath = path.join(rootPath, 'venv');
const isWindows = process.platform === 'win32';

let pythonExe = 'python';
if (fs.existsSync(venvPath)) {
  pythonExe = isWindows 
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
}

let cmd, args;

const moduleSpec = "app:app"; // or "backend.app:app" depending on PYTHONPATH

if (isProd) {
  // Use Waitress for production on Windows (or Gunicorn if user preferred Linux)
  console.log(`> Starting backend in PRODUCTION on http://${host}:${port} using waitress`);
  // Assuming the Flask app instance is named 'app' in 'app.py'
  cmd = pythonExe;
  args = ['-m', 'waitress', `--host=${host}`, `--port=${port}`, moduleSpec];
} else {
  console.log(`> Starting backend in DEVELOPMENT on http://${host}:${port}`);
  cmd = pythonExe;
  args = ['app.py'];
}

const pythonProcess = spawn(cmd, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '../../backend'), // Run from backend directory
  env: {
    ...process.env,
    PORT: String(port),
    HOST: String(host),
    FLASK_DEBUG: isProd ? '0' : '1',
  },
});

pythonProcess.on('error', (err) => {
  console.error('Failed to start backend:', err);
});

pythonProcess.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`Backend process exited with code ${code}`);
  }
});
