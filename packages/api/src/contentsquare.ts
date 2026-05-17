/**
 * Contentsquare: inject a third-party script via <script src="…"> in the page head.
 * Script URL is stored in admin_settings and exposed publicly only when enabled.
 */

import { getSetting } from './settingsStore.js'

const ENABLED_KEY = 'analytics_contentsquare_enabled'
const SCRIPT_URL_KEY = 'analytics_contentsquare_script_url'
const LEGACY_TAG_KEY = 'analytics_contentsquare_tag'

export function isValidContentsquareScriptUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function resolveContentsquareScriptSrc(env: any): Promise<string | null> {
  const enabled = String(await getSetting(env, ENABLED_KEY, { defaultValue: '0' })) === '1'
  if (!enabled) return null

  let url = String(await getSetting(env, SCRIPT_URL_KEY, { defaultValue: '' })).trim()
  if (!url) {
    const legacy = String(await getSetting(env, LEGACY_TAG_KEY, { defaultValue: '' })).trim()
    if (legacy.startsWith('https://')) url = legacy
  }

  return isValidContentsquareScriptUrl(url) ? url : null
}
