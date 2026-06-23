import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import type { CmsRichTextDocument } from '@vmp/shared'

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

export function renderCmsRichTextHtml(content: CmsRichTextDocument): string {
  if (!content || typeof content !== 'object') return ''
  try {
    return generateHTML(content as Parameters<typeof generateHTML>[0], richTextExtensions)
  } catch {
    return ''
  }
}

export function emptyTiptapDoc(): CmsRichTextDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}
