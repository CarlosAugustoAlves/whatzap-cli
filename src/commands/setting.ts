import { writeSettings } from '../utils/settings.js'

export function setting(args: string[]): void {
  // whatzap setting set default-country-code <code>
  const [sub, key, value] = args

  if (sub === 'set' && key === 'default-country-code') {
    if (!value || !/^\d{1,4}$/.test(value)) {
      console.error('Usage: whatzap setting set default-country-code <digits>')
      console.error('Examples: 55 (Brazil), 1 (USA), 44 (UK)')
      process.exitCode = 1
      return
    }
    writeSettings({ defaultCountryCode: value })
    console.log(`Default country code set to ${value}.`)
    return
  }

  console.error('Usage: whatzap setting set default-country-code <code>')
  process.exitCode = 1
}
