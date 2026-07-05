import { existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'

export type GpuBackend = 'cpu' | 'vaapi' | 'nvenc'

export type GpuEncodeConfig = {
  backend: GpuBackend
  /** Appended to Encore profile base name, e.g. vmp-720p-audio-gpu-vaapi */
  profileSuffix: '' | '-gpu-vaapi' | '-gpu-nvenc'
  vaapiDevice: string
}

const VAAPI_DEVICE = (process.env.VAAPI_DEVICE || '/dev/dri/renderD128').trim()
const FORCE_GPU = (process.env.VMP_GPU_BACKEND || 'auto').trim().toLowerCase()

let cached: GpuEncodeConfig | null = null

function runQuick(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(false)
    }, 10_000)
    child.on('error', () => {
      clearTimeout(timeout)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve(code === 0)
    })
  })
}

async function canUseVaapi(): Promise<boolean> {
  if (!existsSync(VAAPI_DEVICE)) return false
  try {
    await access(VAAPI_DEVICE)
  } catch {
    return false
  }
  return runQuick('ffmpeg', ['-hide_banner', '-init_hw_device', `vaapi=va:${VAAPI_DEVICE}`, '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=1', '-t', '0.1', '-c:v', 'h264_vaapi', '-f', 'null', '-'])
}

async function canUseNvenc(): Promise<boolean> {
  return runQuick('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=1', '-t', '0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'])
}

export async function detectGpuEncodeConfig(): Promise<GpuEncodeConfig> {
  if (cached) return cached

  if (FORCE_GPU === 'cpu' || FORCE_GPU === 'none') {
    cached = { backend: 'cpu', profileSuffix: '', vaapiDevice: VAAPI_DEVICE }
    return cached
  }
  if (FORCE_GPU === 'vaapi') {
    cached = { backend: 'vaapi', profileSuffix: '-gpu-vaapi', vaapiDevice: VAAPI_DEVICE }
    return cached
  }
  if (FORCE_GPU === 'nvenc' || FORCE_GPU === 'nvidia') {
    cached = { backend: 'nvenc', profileSuffix: '-gpu-nvenc', vaapiDevice: VAAPI_DEVICE }
    return cached
  }

  if (await canUseNvenc()) {
    cached = { backend: 'nvenc', profileSuffix: '-gpu-nvenc', vaapiDevice: VAAPI_DEVICE }
    return cached
  }
  if (await canUseVaapi()) {
    cached = { backend: 'vaapi', profileSuffix: '-gpu-vaapi', vaapiDevice: VAAPI_DEVICE }
    return cached
  }

  cached = { backend: 'cpu', profileSuffix: '', vaapiDevice: VAAPI_DEVICE }
  return cached
}

export function resolveEncoreProfileBase(base: string, profileSuffix: string): string {
  if (!profileSuffix) return base
  const withGpu = `${base}${profileSuffix}`
  return withGpu
}
