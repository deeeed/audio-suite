import fs from 'node:fs'
import path from 'node:path'

export function acquireBenchmarkHostLock(agentRoot, lane) {
    fs.mkdirSync(agentRoot, { recursive: true })
    const lockPath = path.join(agentRoot, 'host-benchmark.lock')
    let descriptor
    try {
        descriptor = fs.openSync(lockPath, 'wx')
    } catch (error) {
        if (error?.code === 'EEXIST') {
            const ownerText = fs.readFileSync(lockPath, 'utf8').trim()
            let owner = null
            try {
                owner = JSON.parse(ownerText)
            } catch {
                // Keep an invalid lock until a human inspects it.
            }
            if (owner?.pid) {
                try {
                    process.kill(owner.pid, 0)
                } catch (processError) {
                    if (processError?.code === 'ESRCH') {
                        fs.rmSync(lockPath, { force: true })
                        return acquireBenchmarkHostLock(agentRoot, lane)
                    }
                }
            }
            throw new Error(
                `Another benchmark owns this host: ${ownerText || lockPath}. ` +
                    'Wait for it to finish so timing is uncontended.'
            )
        }
        throw error
    }
    fs.writeFileSync(
        descriptor,
        `${JSON.stringify({ lane, pid: process.pid, startedAt: new Date().toISOString() })}\n`
    )
    fs.closeSync(descriptor)
    let released = false
    return () => {
        if (released) return
        released = true
        fs.rmSync(lockPath, { force: true })
    }
}
