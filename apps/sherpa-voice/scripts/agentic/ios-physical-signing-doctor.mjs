#!/usr/bin/env node
/** Diagnose the remaining physical-iOS signing gate for long diarization validation. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(appRoot, '../..');
const deviceUdid = process.env.IOS_DEVICE_UDID || '00008101-001348AC1490801E';
const bundleId = process.env.IOS_BUNDLE_ID || 'net.siteed.sherpavoice.development';
const teamId = process.env.IOS_TEAM_ID || process.env.APPLE_TEAM_ID || 'G5DZE7G2V4';
const profileDirs = [
  path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles'),
  path.join(os.homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles'),
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function decodeXmlEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function extractString(xml, key) {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? decodeXmlEntities(match[1]) : undefined;
}

function extractArrayStrings(xml, key) {
  const arrayMatch = xml.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  if (!arrayMatch) return [];
  return [...arrayMatch[1].matchAll(/<string>([^<]*)<\/string>/g)].map((match) =>
    decodeXmlEntities(match[1])
  );
}

function listProfiles() {
  return profileDirs.flatMap((dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.mobileprovision') || name.endsWith('.provisionprofile'))
      .map((name) => path.join(dir, name));
  });
}

function summarizeProfile(filePath) {
  const decoded = run('security', ['cms', '-D', '-i', filePath]);
  if (!decoded.ok) {
    return {
      file: filePath,
      error: decoded.stderr || decoded.stdout,
    };
  }

  const xml = decoded.stdout;
  const applicationIdentifier =
    extractString(xml, 'application-identifier') ||
    extractString(xml, 'com.apple.application-identifier');
  const teamIds = extractArrayStrings(xml, 'TeamIdentifier');
  const provisionedDevices = extractArrayStrings(xml, 'ProvisionedDevices');
  const appIdentifierSuffix =
    applicationIdentifier && applicationIdentifier.includes('.')
      ? applicationIdentifier.slice(applicationIdentifier.indexOf('.') + 1)
      : applicationIdentifier;
  const bundleMatch =
    appIdentifierSuffix === bundleId ||
    appIdentifierSuffix === '*' ||
    Boolean(appIdentifierSuffix?.endsWith('*') && bundleId.startsWith(appIdentifierSuffix.slice(0, -1)));
  const targetDeviceIncluded = provisionedDevices.includes(deviceUdid);
  const teamMatch = teamIds.includes(teamId);

  return {
    file: filePath,
    name: extractString(xml, 'Name'),
    uuid: extractString(xml, 'UUID'),
    teamName: extractString(xml, 'TeamName'),
    teamIds,
    applicationIdentifier,
    creationDate: extractString(xml, 'CreationDate'),
    expirationDate: extractString(xml, 'ExpirationDate'),
    deviceCount: provisionedDevices.length,
    targetDeviceIncluded,
    bundleMatch,
    teamMatch,
    candidateForTarget: bundleMatch && targetDeviceIncluded && teamMatch,
  };
}

function hasInstalledApp() {
  const result = run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', deviceUdid]);
  return {
    ok: result.ok && result.stdout.includes(bundleId),
    status: result.status,
  };
}

function canLaunchInstalledApp() {
  const url = 'exp+sherpa-voice://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A7500';
  const result = run('xcrun', [
    'devicectl',
    'device',
    'process',
    'launch',
    '--timeout',
    '10',
    '--device',
    deviceUdid,
    '--payload-url',
    url,
    bundleId,
  ]);
  const combined = `${result.stdout}\n${result.stderr}`;
  return {
    ok: result.ok,
    status: result.status,
    securityRejection:
      combined.includes('invalid code signature') ||
      combined.includes('profile has not been explicitly trusted'),
    excerpt: combined.split('\n').filter((line) =>
      /invalid code signature|profile has not been explicitly trusted|Security|ERROR:|BundleIdentifier/.test(line)
    ).slice(-12),
  };
}

function verifyLongGoal() {
  return run('yarn', ['workspace', '@siteed/sherpa-voice', 'diarization:verify-long-goal'], {
    cwd: repoRoot,
  });
}

const profilePaths = listProfiles();
const profiles = profilePaths.map(summarizeProfile);
const installed = hasInstalledApp();
const launch = canLaunchInstalledApp();
const verifier = verifyLongGoal();
const report = {
  ok: launch.ok && verifier.ok,
  deviceUdid,
  bundleId,
  teamId,
  provisioningProfiles: {
    locations: profileDirs.map((dir) => ({
      dir,
      count: profilePaths.filter((profilePath) => profilePath.startsWith(`${dir}${path.sep}`)).length,
    })),
    totalCount: profiles.length,
    targetCandidates: profiles.filter((profile) => profile.candidateForTarget),
    nearMisses: profiles
      .filter((profile) => !profile.candidateForTarget && (profile.teamMatch || profile.targetDeviceIncluded))
      .map((profile) => ({
        file: profile.file,
        name: profile.name,
        teamIds: profile.teamIds,
        applicationIdentifier: profile.applicationIdentifier,
        targetDeviceIncluded: profile.targetDeviceIncluded,
        bundleMatch: profile.bundleMatch,
        teamMatch: profile.teamMatch,
      })),
  },
  installedApp: installed,
  launch,
  finalVerifier: {
    ok: verifier.ok,
    status: verifier.status,
    output: (() => {
      try { return JSON.parse(verifier.stdout); } catch { return verifier.stdout || verifier.stderr; }
    })(),
  },
  nextSteps: launch.ok
    ? ['Run: cd apps/sherpa-voice && yarn diarization:ios:physical']
    : [
        'Complete Apple 2FA/provisioning: cd apps/sherpa-voice && yarn ios:credentials',
        'Build/install signed dev client: cd apps/sherpa-voice && yarn ios:device:eas-build-install',
        'Launch: cd apps/sherpa-voice && yarn ios:device:launch',
      ],
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
