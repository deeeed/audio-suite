import os from 'node:os'

function getLanIpv4() {
    const interfaces = os.networkInterfaces()
    const candidates = []

    for (const addresses of Object.values(interfaces)) {
        for (const address of addresses || []) {
            if (address.family !== 'IPv4' || address.internal) continue
            if (address.address.startsWith('169.254.')) continue
            candidates.push(address.address)
        }
    }

    return (
        candidates.find((address) => address.startsWith('192.168.')) ||
        candidates.find((address) => address.startsWith('10.')) ||
        candidates.find((address) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) ||
        candidates[0] ||
        'localhost'
    )
}

export function getMetroHost(serial = '') {
    if (process.env.AGENTIC_DEV_HOST) {
        return process.env.AGENTIC_DEV_HOST
    }

    if (serial.startsWith('emulator-')) {
        return '10.0.2.2'
    }

    // Physical Android devices cannot reliably load the Metro bundle through
    // their own loopback interface. Use the workstation LAN address, matching
    // scripts/agentic/preflight.sh.
    return getLanIpv4()
}
