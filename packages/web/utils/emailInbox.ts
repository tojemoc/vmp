import { isIosLike } from '~/utils/pwa'

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])
const OUTLOOK_DOMAINS = new Set([
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
])

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  return email.slice(at + 1).trim().toLowerCase()
}

/**
 * Best-effort URL to open the native mail client at the inbox (not compose).
 * There is no universal scheme; `mailto:` always opens a new message.
 */
export function getNativeEmailInboxHref(email = ''): string {
  if (import.meta.server) return 'message://'

  const ua = navigator.userAgent
  const domain = emailDomain(email)
  const onMobile = /Android|iPhone|iPad|iPod/i.test(ua) || isIosLike()

  if (onMobile) {
    if (GMAIL_DOMAINS.has(domain)) return 'googlegmail://'
    if (OUTLOOK_DOMAINS.has(domain)) return 'ms-outlook://emails/inbox'
    if (isIosLike()) return 'message://'
    return 'ms-outlook://emails/inbox'
  }

  if (/Macintosh|Mac OS X/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'message://'
  }

  if (/Windows/i.test(ua)) {
    if (OUTLOOK_DOMAINS.has(domain)) return 'ms-outlook://emails/inbox'
    return 'outlookmail:'
  }

  return 'message://'
}
