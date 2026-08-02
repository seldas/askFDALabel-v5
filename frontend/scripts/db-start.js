const { spawnSync } = require('child_process');
const os = require('os');

/**
 * Cross-platform docker-compose up -d
 * Handles the UID environment variable for Linux systems.
 */
function startDb() {
  const isWin = os.platform() === 'win32';
  const env = { ...process.env };

  // On Linux/macOS, attempt to set UID if not already present
  if (!isWin && !env.UID && process.getuid) {
    try {
      env.UID = process.getuid().toString();
    } catch (e) {
      // Fallback if getuid fails
    }
  }

  console.log('Starting Docker services...');
  
  const result = spawnSync('docker', ['compose', 'up', '-d'], {
    stdio: 'inherit',
    env,
    shell: true
  });

  if (result.error) {
    console.error('Failed to start docker:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
}

startDb();
