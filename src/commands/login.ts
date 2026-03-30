import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import qrcode from 'qrcode-terminal'
import { WhatsAppService } from '../services/whatsapp.js'
import { isDaemonRunning, startDaemon } from '../daemon/client.js'
import { readSettings, writeSettings } from '../utils/settings.js'

const CREDS_FILE = join(homedir(), '.whatzap', 'auth', 'creds.json')

async function promptCountryCode(): Promise<void> {
  const settings = readSettings()
  if (settings.defaultCountryCode) return // already set — skip

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => {
    rl.question('\nDefault country code? (e.g. 55 Brazil, 1 USA, 44 UK — Enter to skip): ', resolve)
  })
  rl.close()

  const code = answer.trim()
  if (code && /^\d{1,4}$/.test(code)) {
    writeSettings({ defaultCountryCode: code })
    console.log(`Default country code set to ${code}.`)
  }
}

export async function login(): Promise<void> {
  if (await isDaemonRunning()) {
    console.log('Already logged in.')
    return
  }

  if (existsSync(CREDS_FILE)) {
    // Creds exist but daemon not running — just start it
    try {
      await startDaemon()
      console.log('Logged in successfully.')
    } catch {
      console.error('Connection failed. Please try again.')
      process.exitCode = 1
    }
    return
  }

  // No creds — need QR scan
  const service = new WhatsAppService()

  try {
    await service.connect((qr) => {
      console.clear()
      console.log('Scan this QR code with WhatsApp on your phone:\n')
      qrcode.generate(qr, { small: true })
    })
  } catch {
    console.error('Connection failed. Please try again.')
    process.exitCode = 1
    await service.disconnect()
    return
  }

  await service.disconnect()

  try {
    await startDaemon()
    console.log('Logged in successfully.')
    await promptCountryCode()
  } catch {
    console.error('Failed to start background session. Please try again.')
    process.exitCode = 1
  }
}
