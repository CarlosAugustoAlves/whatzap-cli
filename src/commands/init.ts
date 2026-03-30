import { installSkill } from './install-skill.js'
import { login } from './login.js'

export async function init(): Promise<void> {
  installSkill()
  await login()
}
