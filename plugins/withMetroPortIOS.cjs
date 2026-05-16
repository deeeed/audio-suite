/* eslint-disable @typescript-eslint/no-require-imports */
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Get the Mac's LAN IP address for physical device connectivity.
 */
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("169.254.")) {
        // Prefer en0/en1 (WiFi/Ethernet), skip VPN/tunnel interfaces
        if (name.startsWith("en") || name.startsWith("eth")) {
          return iface.address;
        }
      }
    }
  }
  // Fallback: any non-internal IPv4 (skip link-local and VPN)
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("169.254.") && !name.startsWith("utun")) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

/**
 * Config plugin to override the Metro server port on iOS.
 *
 * Prebuilt React-Core frameworks have port 8081 baked into the binary,
 * so patching RCTDefines.h (what setPort.sh does) has no effect.
 * Instead we override the bundleURL() in AppDelegate.swift to construct
 * the correct URL directly.
 *
 * For physical devices, we also need to use the Mac's LAN IP instead of
 * localhost, since localhost on the phone means the phone itself.
 *
 * @param {import("@expo/config-plugins").ConfigPlugin.ConfigProps} config
 * @param {Object} options
 * @param {number} [options.port=7365] - The Metro server port to use
 * @returns {import("@expo/config-plugins").ConfigPlugin.ConfigProps}
 */
module.exports = function withMetroPortIOS(config, { port = 7365 } = {}) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        "AppDelegate.swift"
      );

      if (!fs.existsSync(appDelegatePath)) return config;

      let contents = fs.readFileSync(appDelegatePath, "utf8");

      // Don't add if already patched
      if (contents.includes("METRO_PORT_OVERRIDE")) return config;

      // NOTE: LAN IP is resolved at prebuild time. If your network changes
      // (e.g. switching Wi-Fi), you must re-run prebuild to update the IP.
      const lanIP = getLanIP();

      // Set jsLocation before the factory is created so both simulator
      // (localhost) and physical device (LAN IP) paths work.
      const marker = ") -> Bool {";
      const firstIdx = contents.indexOf(marker);
      if (firstIdx !== -1) {
        const insertPoint = firstIdx + marker.length;
        const portOverride = `
    // METRO_PORT_OVERRIDE: Set Metro port for dev builds
    // Prebuilt React-Core ignores RCTDefines.h patches, so we set it at runtime.
    #if DEBUG
    // For physical devices: use the build machine's LAN IP
    // For simulators: localhost works fine
    #if targetEnvironment(simulator)
    RCTBundleURLProvider.sharedSettings().jsLocation = "localhost:${port}"
    #else
    RCTBundleURLProvider.sharedSettings().jsLocation = "${lanIP}:${port}"
    #endif
    // Allow devicectl/agentic physical-device validation to honor LAN
    // initialUrl launches before Expo Dev Launcher has shown its UI.
    UserDefaults.standard.set(true, forKey: "expo.devlauncher.hasGrantedNetworkPermission")
    #endif
`;
        contents =
          contents.slice(0, insertPoint) +
          portOverride +
          contents.slice(insertPoint);
      }

      fs.writeFileSync(appDelegatePath, contents);

      return config;
    },
  ]);
};
