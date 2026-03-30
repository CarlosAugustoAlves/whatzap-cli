import { isDaemonRunning, stopDaemon } from '../daemon/client.js'

export async function stop(): Promise<void> {
  if (!await isDaemonRunning()) {
    console.log('No active session.')
    return
  }
  await stopDaemon()
  console.log('Session stopped.')
}
