import type { Extension } from '@tiptap/core'
import type { CmsRichTextDocument } from '@vmp/shared'
import { sanitizeCmsRichTextHtml } from '~/utils/cmsRichText'

type RichTextRenderer = (content: CmsRichTextDocument) => string

let rendererPromise: Promise<RichTextRenderer> | null = null

async function loadRenderer(): Promise<RichTextRenderer> {
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const [{ generateHTML }, { default: StarterKit }, { default: Link }] = await Promise.all([
        import('@tiptap/html'),
        import('@tiptap/starter-kit'),
        import('@tiptap/extension-link'),
      ])

      const richTextExtensions = [
        StarterKit.configure({
          heading: { levels: [2, 3, 4] },
        }),
        Link.configure({
          openOnClick: true,
          HTMLAttributes: {
            class: 'text-blue-600 dark:text-blue-400 hover:underline',
          },
        }) as Extension,
      ]

      return (content: CmsRichTextDocument) => {
        if (!content || typeof content !== 'object') return ''
        try {
          const html = generateHTML(content as Parameters<typeof generateHTML>[0], richTextExtensions)
          return sanitizeCmsRichTextHtml(html)
        } catch {
          return ''
        }
      }
    })()
  }
  return rendererPromise
}

/** Renders TipTap JSON to sanitized HTML. Loads TipTap in a separate chunk on first use. */
export async function renderCmsRichTextHtml(content: CmsRichTextDocument): Promise<string> {
  const render = await loadRenderer()
  return render(content)
}
