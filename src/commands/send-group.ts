import { ensureDaemon, listGroups, sendViaDaemon } from '../daemon/client.js'

/**
 * Resolve group name from the beginning of args by finding the longest
 * prefix that matches a known group name, leaving the rest as the message.
 */
async function resolveGroupAndMessage(
  args: string[]
): Promise<{ jid: string; message: string } | null> {
  const groups = await listGroups()

  // Try longest prefix first so "ai for life chat" doesn't match "ai for life" if a longer name exists
  for (let len = args.length - 1; len >= 1; len--) {
    const candidate = args.slice(0, len).join(' ').toLowerCase()
    const matches = groups.filter((g) => g.name.trim().toLowerCase() === candidate)

    if (matches.length === 1) {
      return { jid: matches[0].jid, message: args.slice(len).join(' ') }
    }
    if (matches.length > 1) {
      const list = matches.map((g) => `${g.name} [${g.jid}]`).join(', ')
      console.error(`Ambiguous name — matches: ${list}`)
      process.exitCode = 1
      return null
    }
  }

  return null
}

export async function sendGroup(args: string[]): Promise<void> {
  await ensureDaemon()

  const result = await resolveGroupAndMessage(args)

  if (!result) {
    const attempted = args.slice(0, -1).join(' ')
    console.error(`No group found matching '${attempted}'`)
    process.exitCode = 1
    return
  }

  if (!result.message) {
    console.error('Message cannot be empty')
    process.exitCode = 1
    return
  }

  try {
    await sendViaDaemon(result.jid, result.message)
    console.log('Message sent.')
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
