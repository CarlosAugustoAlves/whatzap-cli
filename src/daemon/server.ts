import net from 'net'
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { WhatsAppService } from '../services/whatsapp.js'
import { jidToFilename, HISTORY_DIR } from '../utils/phone.js'

const WHATZAP_DIR = join(homedir(), '.whatzap')
const SOCK_PATH = join(WHATZAP_DIR, 'daemon.sock')
const PID_PATH = join(WHATZAP_DIR, 'daemon.pid')

const service = new WhatsAppService()

// --- Config helpers ---

interface Config {
  contacts?: Record<string, unknown>
  watchList?: string[]
}

const CONFIG_PATH = join(WHATZAP_DIR, 'settings.json')

function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Config
  } catch {
    return {}
  }
}

// Serialized write queue — prevents concurrent config mutations losing data
let configWriteQueue: Promise<void> = Promise.resolve()

function writeConfig(config: Config): void {
  configWriteQueue = configWriteQueue.then(() => {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  }).catch(() => {
    // Write failed — queue is reset so next write can still proceed
  })
}

// --- In-memory state ---

const watchSet = new Set<string>(readConfig().watchList ?? [])
const groupCache = new Map<string, string>() // jid → name

let server: net.Server

const HISTORY_MAX = 100

function appendHistory(jid: string, entry: object): void {
  mkdirSync(HISTORY_DIR, { recursive: true })
  const filepath = join(HISTORY_DIR, jidToFilename(jid) + '.jsonl')
  const existing = existsSync(filepath)
    ? readFileSync(filepath, 'utf8').split('\n').filter(Boolean)
    : []
  existing.push(JSON.stringify(entry))
  if (existing.length > HISTORY_MAX) existing.splice(0, existing.length - HISTORY_MAX)
  writeFileSync(filepath, existing.join('\n') + '\n')
}

function cleanup(): void {
  if (server) server.close()
  if (existsSync(SOCK_PATH)) unlinkSync(SOCK_PATH)
  if (existsSync(PID_PATH)) unlinkSync(PID_PATH)
  service.disconnect().finally(() => process.exit(0))
}

async function handleRequest(line: string, socket: net.Socket): Promise<void> {
  let req: { command: string; jid?: string; text?: string }
  try {
    req = JSON.parse(line)
  } catch {
    socket.write(JSON.stringify({ ok: false, error: 'Invalid JSON' }) + '\n')
    return
  }

  if (req.command === 'ping') {
    socket.write(JSON.stringify({ ok: true }) + '\n')
  } else if (req.command === 'send') {
    try {
      await service.sendMessage(req.jid!, req.text!)
      socket.write(JSON.stringify({ ok: true }) + '\n')
    } catch (err) {
      socket.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + '\n')
    }
  } else if (req.command === 'logout') {
    // Delete auth files synchronously before the async logout triggers onClose → cleanup()
    execFileSync('/bin/rm', ['-rf', join(WHATZAP_DIR, 'auth')])
    socket.write(JSON.stringify({ ok: true }) + '\n')
    setTimeout(async () => {
      await service.logout()
    }, 100)
  } else if (req.command === 'stop') {
    socket.write(JSON.stringify({ ok: true }) + '\n')
    setTimeout(cleanup, 100)
  } else if (req.command === 'list-groups') {
    const groups = Array.from(groupCache.entries()).map(([jid, name]) => ({ jid, name }))
    socket.write(JSON.stringify({ ok: true, groups }) + '\n')

  } else if (req.command === 'watch-add') {
    const jid = req.jid!
    const alreadyPresent = watchSet.has(jid)
    watchSet.add(jid)
    const config = readConfig()
    config.watchList = Array.from(watchSet)
    writeConfig(config)
    socket.write(JSON.stringify({ ok: true, alreadyPresent }) + '\n')

  } else if (req.command === 'watch-remove') {
    const jid = req.jid!
    if (!watchSet.has(jid)) {
      socket.write(JSON.stringify({ ok: false, error: 'JID not in watch list' }) + '\n')
    } else {
      watchSet.delete(jid)
      const config = readConfig()
      config.watchList = Array.from(watchSet)
      writeConfig(config)
      socket.write(JSON.stringify({ ok: true }) + '\n')
    }

  } else if (req.command === 'watch-list') {
    const list = Array.from(watchSet).map((jid) => {
      const name = jid.endsWith('@g.us')
        ? (groupCache.get(jid) ?? jid)
        : jid.replace('@s.whatsapp.net', '')
      return { jid, name }
    })
    socket.write(JSON.stringify({ ok: true, list }) + '\n')

  } else {
    socket.write(JSON.stringify({ ok: false, error: 'Unknown command' }) + '\n')
  }
}

async function main(): Promise<void> {
  mkdirSync(WHATZAP_DIR, { recursive: true })

  await service.connect(undefined, () => {
    // WhatsApp connection dropped after being established — exit so ensureDaemon() restarts us
    cleanup()
  })

  // Populate group cache (best-effort — don't fail daemon startup if this errors)
  try {
    const groups = await service.fetchGroups()
    for (const [jid, name] of Object.entries(groups)) {
      groupCache.set(jid, name)
    }
  } catch {
    // Group fetch failed — list-groups will return empty until restart
  }

  service.onMessage((msg) => {
    const { key, message, pushName } = msg
    // Resolve LID (@lid) to phone JID (@s.whatsapp.net) using senderPn when available
    const rawJid = key.remoteJid
    if (!rawJid) return
    const resolvedJid = rawJid.endsWith('@lid') ? ((key as any).senderPn ?? rawJid) : rawJid
    const remoteJid = resolvedJid
    if (!watchSet.has(remoteJid)) return

    const text =
      message?.conversation ??
      message?.extendedTextMessage?.text
    if (!text) return

    if (key.fromMe) {
      appendHistory(remoteJid, {
        ts: new Date().toISOString(),
        d: 'out',
        text,
      })
      return
    }

    const isGroup = remoteJid.endsWith('@g.us')
    const participant = key.participant
    if (isGroup && !participant) return

    appendHistory(remoteJid, {
      ts: new Date().toISOString(),
      d: 'in',
      n: pushName ?? undefined,
      text,
    })
  })

  writeFileSync(PID_PATH, String(process.pid))

  if (existsSync(SOCK_PATH)) unlinkSync(SOCK_PATH)

  server = net.createServer((socket) => {
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) handleRequest(line, socket).catch(() => {})
      }
    })
    socket.on('error', () => {})
  })

  server.listen(SOCK_PATH)

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
}

main().catch(() => process.exit(1))
