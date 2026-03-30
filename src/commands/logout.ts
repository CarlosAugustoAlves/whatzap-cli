import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { isDaemonRunning, logoutDaemon } from '../daemon/client.js'

const AUTH_DIR = join(homedir(), '.whatzap', 'auth')

export async function logout(): Promise<void> {
  if (await isDaemonRunning()) {
    await logoutDaemon()
    // Belt-and-suspenders: delete auth files from client side too,
    // in case the daemon's async cleanup lost the race with process.exit
    if (existsSync(AUTH_DIR)) {
      execFileSync('/bin/rm', ['-rf', AUTH_DIR])
    }
    console.log('Logged out.')
    return
  }

  if (existsSync(AUTH_DIR)) {
    // No daemon running — just wipe local credentials
    execFileSync('/bin/rm', ['-rf', AUTH_DIR])
    console.log('Logged out.')
    return
  }

  console.log('Not logged in.')
}
