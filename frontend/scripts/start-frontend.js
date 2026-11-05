const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const next = require('next');

// 1. Load .env from project root
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const host = process.env.HOST || '0.0.0.0';
const port = parseInt(process.env.FRONTEND_PORT || 8848);
const isProd = process.env.NODE_ENV === 'production';

// 2. Automatic HTTPS Detection
const protocol = 'http';

console.log(`> Starting Next.js in ${isProd ? 'production' : 'development'} on ${protocol}://${host}:${port}`);

if (isProd) {
  // PRODUCTION LOGIC
  const app = next({ dev: false });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    server.listen(port, host, (err) => {
      if (err) throw err;
      console.log(`> Production server ready on ${protocol}://${host}:${port}`);
    });
  });
} else {
  // DEVELOPMENT LOGIC (using Next.js CLI for HMR support)
  const args = ['next', 'dev', '-p', String(port), '-H', String(host), '--webpack'];

  const nextProcess = spawn('npx', args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FRONTEND_PORT: String(port), HOST: String(host) },
  });

  nextProcess.on('error', (err) => console.error('Failed to start frontend:', err));
}
