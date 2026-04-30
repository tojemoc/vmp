import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 120000

export async function runCommand(command: string, args: string[], label: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    let stdout = ''
    let stderr = ''
    let resolved = false

    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      child.kill()
      reject(new Error(`${label} timed out after ${timeoutMs}ms. Recent stderr: ${stderr.slice(-300)}`))
    }, timeoutMs)

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
      }
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })
    child.on('error', (err) => {
      cleanup()
      reject(err)
    })
    child.on('close', (code) => {
      cleanup()
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(`${label} failed with exit ${String(code)} ${stderr.slice(-300)}`))
    })
  })
}
