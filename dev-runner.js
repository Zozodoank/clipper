import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const SERVER_PORT_START = 5000;

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '::' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`Tidak menemukan port backend kosong mulai dari ${startPort}.`);
}

console.log('🚀 Starting Local AI Affiliate Clipper Development Environment...');

const serverPort = await findFreePort(SERVER_PORT_START);
console.log(`Backend proxy target: http://localhost:${serverPort}`);

const serverProcess = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(__dirname, 'server'),
  env: {
    ...process.env,
    PORT: String(serverPort),
  },
  stdio: 'inherit',
  shell: true,
});

const clientProcess = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(__dirname, 'client'),
  env: {
    ...process.env,
    VITE_API_TARGET: `http://localhost:${serverPort}`,
  },
  stdio: 'inherit',
  shell: true,
});

const cleanup = () => {
  console.log('\n🛑 Shutting down services...');
  serverProcess.kill();
  clientProcess.kill();
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
