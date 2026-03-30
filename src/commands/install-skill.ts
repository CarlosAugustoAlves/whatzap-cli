import { cpSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

export function installSkill(): void {
  const packageRoot = join(fileURLToPath(import.meta.url), '../../..')
  const skillSrc = join(packageRoot, '.claude/skills/whatzap')
  const skillDest = join(homedir(), '.claude/skills/whatzap')

  if (!existsSync(skillSrc)) {
    console.error('Skill files not found in package. Try reinstalling whatzap-cli.')
    process.exitCode = 1
    return
  }

  mkdirSync(join(homedir(), '.claude/skills'), { recursive: true })
  cpSync(skillSrc, skillDest, { recursive: true })
  console.log(`Skill installed to ${skillDest}`)
  console.log('You can now ask Claude to send WhatsApp messages on your behalf.')
}
