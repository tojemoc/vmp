import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ObjectStorageProvider } from './types.js'

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return end === value.length ? value : value.slice(0, end)
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

export async function uploadLocalFile(
  storage: ObjectStorageProvider,
  localFile: string,
  key: string,
  opts?: { contentType?: string },
): Promise<void> {
  const body = await readFile(localFile)
  const contentType = opts?.contentType ?? guessContentType(localFile)
  await storage.putObject(key, body, { contentType })
}

export async function uploadLocalDirectory(
  storage: ObjectStorageProvider,
  localDir: string,
  keyPrefix: string,
): Promise<void> {
  const files = await walkFiles(localDir)
  const prefix = trimTrailingSlashes(keyPrefix)
  for (const file of files) {
    const relative = path.relative(localDir, file).split(path.sep).join('/')
    const key = prefix ? `${prefix}/${relative}` : relative
    await uploadLocalFile(storage, file, key)
  }
}

export async function verifyRemoteDirectory(
  storage: ObjectStorageProvider,
  localDir: string,
  keyPrefix: string,
): Promise<void> {
  const files = await walkFiles(localDir)
  const prefix = trimTrailingSlashes(keyPrefix)
  for (const file of files) {
    const relative = path.relative(localDir, file).split(path.sep).join('/')
    const key = prefix ? `${prefix}/${relative}` : relative
    const localStat = await stat(file)
    const remote = await storage.headObject(key)
    if (!remote) {
      throw new Error(`Missing remote object after upload: ${key}`)
    }
    if (remote.size !== localStat.size) {
      throw new Error(`Size mismatch for ${key}: local=${localStat.size} remote=${remote.size}`)
    }
  }
}

function guessContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.m3u8': return 'application/vnd.apple.mpegurl'
    case '.ts': return 'video/mp2t'
    case '.m4s': return 'video/iso.segment'
    case '.mp4': return 'video/mp4'
    case '.mp3': return 'audio/mpeg'
    case '.json': return 'application/json'
  case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    default: return undefined
  }
}
