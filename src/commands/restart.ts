import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { stopDaemon, ensureDaemon } from '../daemon/client.js'

const SOCK_PATH = join(homedir(), '.whatzap', 'daemon.sock')
const POLL_INTERVAL = 100
const TIMEOUT_MS = 5000

async function waitForSocketGone(): Promise<boolean> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!existsSync(SOCK_PATH)) return true
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL))
  }
  return false
}

export async function restart(): Promise<void> {
  if (existsSync(SOCK_PATH)) {
    try {
      await stopDaemon()
    } catch {
      // Daemon may already be shutting down — proceed to poll
    }
    const stopped = await waitForSocketGone()
    if (!stopped) {
      console.error('Daemon did not stop within 5s')
      process.exitCode = 1
      return
    }
  }
  await ensureDaemon()
  console.log('Daemon restarted.')
}
