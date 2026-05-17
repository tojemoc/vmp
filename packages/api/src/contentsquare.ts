/**
 * Contentsquare: inject a third-party script via <script src="…"> in the page head.
 * Script URL is stored in admin_settings and exposed publicly only when enabled.
 */

import { getSetting } from './settingsStore.js'

const ENABLED_KEY = 'analytics_contentsquare_enabled'
const SCRIPT_URL_KEY = 'analytics_contentsquare_script_url'
const LEGACY_TAG_KEY = 'analytics_contentsquare_tag'
const SCRIPT_PREFIX = 'https://t.contentsquare.net/uxa/'

export function isValidContentsquareScriptUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Accepts a full https script URL or a legacy project tag (e.g. 154548693f2c8). */
export function normalizeContentsquareScriptSrc(raw: string): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (isValidContentsquareScriptUrl(value)) return value

  const tag = value.replace(/^\/+|\/+$/g, '')
  if (/^[a-zA-Z0-9_-]+$/.test(tag)) {
    const built = `${SCRIPT_PREFIX}${tag}.js`
    return isValidContentsquareScriptUrl(built) ? built : null
  }

  return null
}

export async function resolveContentsquareScriptSrc(env: any): Promise<string | null> {
  const enabled = String(await getSetting(env, ENABLED_KEY, { defaultValue: '0' })) === '1'
  if (!enabled) return null

  let raw = String(await getSetting(env, SCRIPT_URL_KEY, { defaultValue: '' })).trim()
  if (!raw) {
    raw = String(await getSetting(env, LEGACY_TAG_KEY, { defaultValue: '' })).trim()
  }

  return normalizeContentsquareScriptSrc(raw)
}
