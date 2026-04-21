import { execSync } from 'child_process'
import * as readline from 'readline'

interface Contact {
  name: string
  phones: string[]
}

function normalizePhone(raw: string): string {
  const hasPlus = raw.trimStart().startsWith('+')
  const digits = raw.replace(/[^\d]/g, '')
  return hasPlus ? `+${digits}` : digits
}

const APPLESCRIPT = `
set query to system attribute "WHATZAP_QUERY"
tell application "Contacts"
  set matchingPeople to (every person whose name contains query)
  set output to ""
  repeat with p in matchingPeople
    set phoneList to phones of p
    if (count of phoneList) > 0 then
      set phoneValues to ""
      repeat with ph in phoneList
        if phoneValues is "" then
          set phoneValues to value of ph
        else
          set phoneValues to phoneValues & "," & (value of ph)
        end if
      end repeat
      set output to output & (name of p) & "|||" & phoneValues & linefeed
    end if
  end repeat
  return output
end tell
`

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer) }))
}

export async function findContact(query: string): Promise<void> {
  if (!query.trim()) {
    console.error('Usage: whatzap find-contact <query>')
    process.exitCode = 1
    return
  }

  if (process.platform !== 'darwin') {
    console.error('Note: automatic contact lookup is only available on macOS.')
    console.error('On Linux and Windows, find-contact cannot query Contacts.app.')
    const phone = await prompt(`Enter phone number for "${query}" (with country code, e.g. +15551234567): `)
    if (!phone.trim()) {
      console.error('No phone number provided.')
      process.exitCode = 1
      console.log('[]')
      return
    }
    const normalized = phone.trim().startsWith('+')
      ? `+${phone.replace(/[^\d]/g, '')}`
      : phone.replace(/[^\d]/g, '')
    console.log(JSON.stringify([{ name: query, phones: [normalized] }], null, 2))
    return
  }

  let raw: string
  try {
    raw = execSync('osascript', {
      input: APPLESCRIPT,
      env: { ...process.env, WHATZAP_QUERY: query },
      encoding: 'utf8',
    })
  } catch (err) {
    const msg =
      err instanceof Error && 'stderr' in err
        ? String((err as NodeJS.ErrnoException & { stderr: string }).stderr).trim() || err.message
        : String(err)
    console.error(msg)
    process.exitCode = 1
    console.log('[]')
    return
  }

  const contacts: Contact[] = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const sepIdx = line.indexOf('|||')
      if (sepIdx === -1) return null
      const name = line.slice(0, sepIdx)
      const phones = line
        .slice(sepIdx + 3)
        .split(',')
        .map(normalizePhone)
        .filter(Boolean)
      return { name, phones }
    })
    .filter((c): c is Contact => c !== null && c.phones.length > 0)

  console.log(JSON.stringify(contacts, null, 2))
}
