export function getMetroHost(serial = '') {
  if (serial.startsWith('emulator-')) {
    return '10.0.2.2';
  }

  // These scripts install an adb reverse tunnel immediately before launching
  // the Android dev client, so the launch URL should keep targeting the
  // device loopback interface instead of a workstation-specific LAN/mDNS host.
  return '127.0.0.1';
}
