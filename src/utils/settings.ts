import { existsSync, readFileSync, writeFileSync } from 'fs'
import { WHATZAP_DIR } from './phone.js'
import { join } from 'path'

const SETTINGS_PATH = join(WHATZAP_DIR, 'settings.json')

export interface Settings {
  watchList?: string[]
  defaultCountryCode?: string
}

export function readSettings(): Settings {
  if (!existsSync(SETTINGS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings
  } catch {
    return {}
  }
}

export function writeSettings(patch: Partial<Settings>): void {
  const current = readSettings()
  const updated = { ...current, ...patch }
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2))
}
