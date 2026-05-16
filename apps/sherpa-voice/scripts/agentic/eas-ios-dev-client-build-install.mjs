#!/usr/bin/env node
/**
 * Build the SherpaVoiceDev iOS development client with EAS, download the IPA,
 * extract the .app from the IPA, and install it on the connected physical iPhone.
 *
 * This intentionally avoids local Xcode signing. It requires EAS iOS internal
 * distribution credentials to exist first. If credentials are missing, run
 * `yarn dlx eas-cli credentials -p ios` and complete Apple 2FA.
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(appRoot, '../..');
const outputDir = path.join(appRoot, '.agent/eas');
const ipaPath = path.join(outputDir, 'SherpaVoiceDev-development.ipa');
const extractedDir = path.join(outputDir, 'SherpaVoiceDev-development-extracted');
const deviceUdid = process.env.IOS_DEVICE_UDID || '00008101-001348AC1490801E';
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      APP_VARIANT: 'development',
      EAS_PROJECT_ID: process.env.EAS_PROJECT_ID || '5360ada5-3236-4b98-8b54-4d680e9267c6',
      APPLE_TEAM_ID: process.env.APPLE_TEAM_ID || 'G5DZE7G2V4',
      YARN_ENABLE_IMMUTABLE_INSTALLS: process.env.YARN_ENABLE_IMMUTABLE_INSTALLS || 'false',
      YARN_ENABLE_GLOBAL_CACHE: process.env.YARN_ENABLE_GLOBAL_CACHE || 'false',
    },
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    if (
      combinedOutput.includes("couldn't find any credentials suitable for internal distribution") ||
      combinedOutput.includes("couldn’t find any credentials suitable for internal distribution")
    ) {
      throw new Error(
        `${command} ${args.join(' ')} failed because EAS iOS internal-distribution credentials are missing.\n\n` +
          `Run this interactive command and complete Apple 2FA:\n` +
          `  cd apps/sherpa-voice && APP_VARIANT=development APPLE_TEAM_ID=G5DZE7G2V4 yarn dlx eas-cli credentials -p ios\n\n` +
          `Then rerun:\n` +
          `  yarn ios:device:eas-build-install\n\n` +
          `Original output:\n${combinedOutput}`
      );
    }
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result;
}


function commandSucceeds(command) {
  return spawnSync('bash', ['-lc', command], { cwd: appRoot, stdio: 'ignore' }).status === 0;
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('EAS JSON output was empty');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // EAS/Yarn can print warnings before the JSON payload. Try every plausible
    // JSON opener so a prefix like `(node) [DEP0040] ...` does not make us parse
    // the warning bracket as JSON.
    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] !== '[' && trimmed[index] !== '{') {
        continue;
      }
      try {
        return JSON.parse(trimmed.slice(index));
      } catch {
        // Keep scanning for the real JSON payload.
      }
    }
    throw new Error(`Could not parse EAS JSON output:\n${trimmed}`);
  }
}

function findArtifactUrl(buildJson) {
  const builds = Array.isArray(buildJson) ? buildJson : [buildJson];
  for (const build of builds) {
    const url =
      build?.artifacts?.buildUrl ||
      build?.artifacts?.applicationArchiveUrl ||
      build?.artifactUrl ||
      build?.buildUrl;
    if (url) {
      return { url, build };
    }
  }
  throw new Error(`No build artifact URL found in EAS output: ${JSON.stringify(buildJson, null, 2)}`);
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const file = fs.createWriteStream(destination);
    https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.rmSync(destination, { force: true });
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.rmSync(destination, { force: true });
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (error) => {
      file.close();
      fs.rmSync(destination, { force: true });
      reject(error);
    });
  });
}


function extractIpa(ipa, destinationDir) {
  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  run('unzip', ['-q', ipa, '-d', destinationDir], { cwd: repoRoot });
  const payloadDir = path.join(destinationDir, 'Payload');
  const apps = fs.existsSync(payloadDir)
    ? fs.readdirSync(payloadDir).filter((entry) => entry.endsWith('.app'))
    : [];
  if (apps.length !== 1) {
    throw new Error(`Expected exactly one .app in ${payloadDir}, found ${apps.length}: ${apps.join(', ')}`);
  }
  return path.join(payloadDir, apps[0]);
}

async function main() {
  const report = {
    appRoot,
    repoRoot,
    outputDir,
    ipaPath,
    deviceUdid,
    commands: {
      build: 'yarn dlx -q eas-cli build -p ios -e development --non-interactive --wait --json',
      extract: `unzip -q ${ipaPath} -d ${extractedDir}`,
      install: `xcrun devicectl device install app --device ${deviceUdid} ${path.join(extractedDir, 'Payload/*.app')}`,
    },
    checks: {
      appRoot: fs.existsSync(appRoot),
      easJson: fs.existsSync(path.join(appRoot, 'eas.json')),
      packageJson: fs.existsSync(path.join(appRoot, 'package.json')),
      unzip: commandSucceeds('command -v unzip >/dev/null'),
      devicectl: commandSucceeds('xcrun -f devicectl >/dev/null'),
    },
  };

  if (dryRun) {
    console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 2));
    if (Object.values(report.checks).some((ok) => !ok)) process.exit(1);
    return;
  }

  const build = run('yarn', [
    'dlx',
    '-q',
    'eas-cli',
    'build',
    '-p',
    'ios',
    '-e',
    'development',
    '--non-interactive',
    '--wait',
    '--json',
    '--message',
    'physical ios diarization validation dev client',
  ]);
  const buildJson = parseJsonOutput(build.stdout);
  const { url, build: selectedBuild } = findArtifactUrl(buildJson);
  await download(url, ipaPath);
  const appPath = extractIpa(ipaPath, extractedDir);
  const install = run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceUdid, appPath], {
    cwd: repoRoot,
  });
  console.log(JSON.stringify({
    ipaPath,
    extractedDir,
    appPath,
    buildId: selectedBuild?.id,
    artifactUrl: url,
    installStdout: install.stdout,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
