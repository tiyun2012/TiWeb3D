import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const reportsDir = join(projectRoot, 'reports');
const reportPath = join(reportsDir, 'static-mesh-construction-test.txt');
const shouldOpen = process.argv.includes('--open');

mkdirSync(reportsDir, { recursive: true });

const commandArgs = [
  '--loader',
  './scripts/test-ts-loader.mjs',
  './scripts/test-static-mesh-construction.ts',
];

const startedAt = new Date();
const transcript = [];
const append = (value) => {
  transcript.push(value);
};

append('TiWeb3D Static Mesh Construction Test Report\n');
append('===========================================\n');
append(`Started: ${startedAt.toISOString()}\n`);
append(`Project: ${projectRoot}\n`);
append(`Command: node ${commandArgs.join(' ')}\n\n`);

const child = spawn(process.execPath, commandArgs, {
  cwd: projectRoot,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  append(text);
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  append(text);
});

child.on('error', (error) => {
  const text = `\n[Test report runner] Could not start test process: ${error.message}\n`;
  process.stderr.write(text);
  append(text);
  finish(1);
});

child.on('close', (code, signal) => {
  const exitCode = typeof code === 'number' ? code : 1;
  if (signal) {
    append(`\nProcess signal: ${signal}\n`);
  }
  finish(exitCode);
});

let finished = false;
function finish(exitCode) {
  if (finished) return;
  finished = true;

  const finishedAt = new Date();
  append('\n===========================================\n');
  append(`Finished: ${finishedAt.toISOString()}\n`);
  append(`Exit code: ${exitCode}\n`);
  append(`Result: ${exitCode === 0 ? 'PASS' : 'FAIL'}\n`);

  writeFileSync(reportPath, transcript.join(''), 'utf8');

  const relativeReport = 'reports\\static-mesh-construction-test.txt';
  process.stdout.write(`\n[Test report] ${relativeReport}\n`);

  if (shouldOpen) {
    openInVSCode(reportPath);
  } else {
    process.stdout.write('[Test report] Open in VS Code: npm run test:mesh-construction:open\n');
  }

  process.exitCode = exitCode;
}

function openInVSCode(filePath) {
  const launch = resolveVSCodeLauncher();
  if (!launch) {
    process.stdout.write(
      `[Test report] VS Code launcher was not found. Open manually: ${filePath}\n`,
    );
    return;
  }

  try {
    const childProcess = spawn(launch.command, [...launch.args, '-r', filePath], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      shell: launch.shell,
      windowsHide: true,
    });
    childProcess.unref();
    process.stdout.write('[Test report] Opening report in the current VS Code window.\n');
  } catch (error) {
    process.stdout.write(
      `[Test report] Could not open VS Code automatically: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stdout.write(`[Test report] Open manually: ${filePath}\n`);
  }
}

function resolveVSCodeLauncher() {
  const shell = process.platform === 'win32';
  const codeProbe = spawnSync('code', ['--version'], {
    stdio: 'ignore',
    shell,
    windowsHide: true,
  });
  if (codeProbe.status === 0) {
    return { command: 'code', args: [], shell };
  }

  if (process.platform === 'win32') {
    const candidates = [
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
        : null,
      process.env.PROGRAMFILES
        ? join(process.env.PROGRAMFILES, 'Microsoft VS Code', 'Code.exe')
        : null,
      process.env['PROGRAMFILES(X86)']
        ? join(process.env['PROGRAMFILES(X86)'], 'Microsoft VS Code', 'Code.exe')
        : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { command: candidate, args: [], shell: false };
      }
    }
  }

  return null;
}
