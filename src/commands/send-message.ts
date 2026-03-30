import { ensureDaemon, sendViaDaemon } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'
import { readSettings } from '../utils/settings.js'

export async function sendMessage(phone: string, text: string): Promise<void> {
  const { defaultCountryCode } = readSettings()
  const jid = normalizePhone(phone, defaultCountryCode)

  await ensureDaemon()

  try {
    await sendViaDaemon(jid, text)
    console.log('Message sent.')
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
