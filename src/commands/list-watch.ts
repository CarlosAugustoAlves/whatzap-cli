import { ensureDaemon, watchList } from '../daemon/client.js'

export async function listWatch(): Promise<void> {
  await ensureDaemon()
  const list = await watchList()

  if (list.length === 0) {
    console.log('No contacts or groups are being watched.')
    return
  }

  for (const { jid, name } of list) {
    const display = jid.endsWith('@g.us') ? name : `+${name}`
    console.log(`  ${display}  (${jid})`)
  }
}
