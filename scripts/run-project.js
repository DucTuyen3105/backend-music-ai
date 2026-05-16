const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const pythonCommand =
  process.env.PYTHON_COMMAND || process.env.PYTHON_PATH || 'python';
const modelHost = process.env.MODEL_API_HOST || '127.0.0.1';
const modelPort = process.env.MODEL_API_PORT || '8001';
const nestPort = process.env.PORT || '3000';
const frontendPort = process.env.FRONTEND_PORT || '5173';
const modelApiUrl =
  process.env.MODEL_API_URL || `http://${modelHost}:${modelPort}/predict`;
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${nestPort}`;

const services = [];
let shuttingDown = false;

function cleanupPort(port) {
  if (!isWindows) {
    return;
  }

  try {
    const output = execFileSync(
      'cmd.exe',
      ['/d', '/s', '/c', `netstat -ano -p tcp | findstr :${port}`],
      {
        cwd: rootDir,
        windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) {
        continue;
      }
      const parts = line.trim().split(/\s+/);
      const pid = parts.at(-1);
      if (pid && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      if (pid === String(process.pid)) {
        continue;
      }
      execFileSync('taskkill', ['/PID', pid, '/F'], {
        cwd: rootDir,
        windowsHide: true,
        stdio: 'ignore',
      });
      console.log(`Freed port ${port} by stopping PID ${pid}`);
    }
  } catch {
    // Port cleanup is best-effort. The service startup will still report errors.
  }
}

function prefixStream(name, stream, writer) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        writer.write(`[${name}] ${line}\n`);
      }
    }
  });
  stream.on('end', () => {
    if (pending.trim()) {
      writer.write(`[${name}] ${pending}\n`);
    }
  });
}

function runService(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env,
    },
    shell: false,
    windowsHide: true,
  });

  services.push({ name, child });
  prefixStream(name, child.stdout, process.stdout);
  prefixStream(name, child.stderr, process.stderr);

  child.on('error', (error) => {
    process.stderr.write(`[${name}] failed to start: ${error.message}\n`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const exitCode = code ?? 1;
    process.stderr.write(
      `[${name}] exited with ${signal || `code ${exitCode}`}\n`,
    );
    shutdown(exitCode);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const service of services) {
    if (!service.child.killed) {
      service.child.kill(isWindows ? 'SIGTERM' : 'SIGINT');
    }
  }

  setTimeout(() => {
    for (const service of services) {
      if (!service.child.killed) {
        service.child.kill('SIGKILL');
      }
    }
    process.exit(code);
  }, 1500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  process.stderr.write(`[runner] ${error.stack || error.message}\n`);
  shutdown(1);
});

console.log('Starting Music AI project...');
console.log(`- Next.js frontend: http://localhost:${frontendPort}`);
console.log(`- NestJS API: http://localhost:${nestPort}`);
console.log(`- Model API: http://${modelHost}:${modelPort}`);
console.log('- Press Ctrl+C to stop all services.');

cleanupPort(modelPort);
cleanupPort(nestPort);
cleanupPort(frontendPort);

startServices();

function startServices() {
  runService('model-api', pythonCommand, [
    '-m',
    'uvicorn',
    'music_genre_classification.model_api:app',
    '--host',
    modelHost,
    '--port',
    modelPort,
  ]);

  const nestArgs = [
    path.join('node_modules', '@nestjs', 'cli', 'bin', 'nest.js'),
    'start',
  ];

  if (process.env.NEST_WATCH !== 'false') {
    nestArgs.push('--watch');
  }

  runService('nestjs', process.execPath, nestArgs, {
    MODEL_API_URL: modelApiUrl,
  });

  runService(
    'nextjs',
    process.execPath,
    [
      path.join('node_modules', 'next', 'dist', 'bin', 'next'),
      'dev',
      'frontend',
      '-p',
      frontendPort,
    ],
    {
      NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
    },
  );
}
