import { homedir } from 'os'
import { join } from 'path'

export const WHATZAP_DIR = join(homedir(), '.whatzap')
export const HISTORY_DIR = join(WHATZAP_DIR, 'history')

/**
 * Normalize a phone input (e.g. "+55 (11) 99999-9999") to a WhatsApp JID.
 * Strips +, spaces, hyphens, parentheses. Validates all-digits.
 * If input has no leading + and defaultCountryCode is provided, prepends it.
 * Returns e.g. "5511999999999@s.whatsapp.net".
 */
export function normalizePhone(input: string, defaultCountryCode?: string): string {
  const hasPlus = input.startsWith('+')
  let digits = hasPlus ? input.slice(1) : input
  digits = digits.replace(/[\s\-()]/g, '')
  if (!/^\d+$/.test(digits)) {
    console.error('Invalid phone number.')
    process.exit(1)
  }
  if (!hasPlus && defaultCountryCode) {
    digits = `${defaultCountryCode}${digits}`
  }
  return `${digits}@s.whatsapp.net`
}

/**
 * Convert a JID to a safe filename by replacing '@' with '_' and '.' with '-'.
 * e.g. "5511999999999@s.whatsapp.net" → "5511999999999_s-whatsapp-net"
 */
export function jidToFilename(jid: string): string {
  return jid.replace('@', '_').replace(/\./g, '-')
}
