import { ensureDaemon, listGroups, watchAdd } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'
import { readSettings } from '../utils/settings.js'

function isPhoneInput(input: string): boolean {
  const stripped = input.startsWith('+') ? input.slice(1) : input
  return /^[\d\s\-()+]+$/.test(stripped) && /\d{7,}/.test(stripped)
}

export async function addWatch(input: string): Promise<void> {
  await ensureDaemon()

  let jid: string

  if (isPhoneInput(input)) {
    const { defaultCountryCode } = readSettings()
    jid = normalizePhone(input, defaultCountryCode)
  } else {
    const groups = await listGroups()
    const lower = input.toLowerCase()
    const matches = groups.filter((g) => g.name.trim().toLowerCase() === lower)

    if (matches.length === 0) {
      console.error(`No group found matching '${input}'`)
      process.exitCode = 1
      return
    }
    if (matches.length > 1) {
      const list = matches.map((g) => `${g.name} [${g.jid}]`).join(', ')
      console.error(`Ambiguous name — matches: ${list}`)
      process.exitCode = 1
      return
    }
    jid = matches[0].jid
  }

  const { alreadyPresent } = await watchAdd(jid)
  if (alreadyPresent) {
    console.log(`'${input}' is already being watched.`)
  } else {
    console.log(`Now watching '${input}'.`)
  }
}
