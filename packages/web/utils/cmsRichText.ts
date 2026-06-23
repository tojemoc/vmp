import DOMPurify from 'isomorphic-dompurify'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import type { CmsRichTextDocument } from '@vmp/shared'

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:'])

const richTextExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
  }),
  Link.configure({
    openOnClick: true,
    HTMLAttributes: {
      class: 'text-blue-600 dark:text-blue-400 hover:underline',
    },
  }),
]

function sanitizeHref(rawUrl: string): string {
  try {
    const normalized = new URL(rawUrl, 'http://dummy')
    const isAbsoluteHttpUrl = /^https?:\/\//i.test(rawUrl)
    if (!isAbsoluteHttpUrl) return '#'
    if (!SAFE_URL_PROTOCOLS.has(normalized.protocol)) return '#'
    return normalized.toString()
  } catch {
    return '#'
  }
}

function sanitizeLinkHrefs(html: string): string {
  return html.replace(/href\s*=\s*(['"])([^'"]*)\1/gi, (_, quote: string, href: string) => {
    return `href=${quote}${sanitizeHref(href)}${quote}`
  })
}

/** DOM-aware XSS prevention for TipTap HTML before v-html binding. */
export function sanitizeCmsRichTextHtml(html: string): string {
  if (!html) return ''
  const purified = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
  return sanitizeLinkHrefs(purified)
}

export function renderCmsRichTextHtml(content: CmsRichTextDocument): string {
  if (!content || typeof content !== 'object') return ''
  try {
    const html = generateHTML(content as Parameters<typeof generateHTML>[0], richTextExtensions)
    return sanitizeCmsRichTextHtml(html)
  } catch {
    return ''
  }
}

export function emptyTiptapDoc(): CmsRichTextDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}
