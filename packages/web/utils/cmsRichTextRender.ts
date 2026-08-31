import type { Extension } from '@tiptap/core';
import type { CmsRichTextDocument } from '@vmp/shared';
import { sanitizeCmsRichTextHtml } from '~/utils/cmsRichText';

type RichTextRenderer = (content: CmsRichTextDocument) => string;

let rendererPromise: Promise<RichTextRenderer> | null = null;

async function loadRenderer(): Promise<RichTextRenderer> {
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const [htmlModule, starterKitModule, linkModule] = await Promise.all([
        import('@tiptap/html'),
        import('@tiptap/starter-kit'),
        import('@tiptap/extension-link'),
      ]);

      // The chunk-load-recovery plugin calls preventDefault on vite:preloadError,
      // so a failed chunk load resolves the import to undefined instead of
      // rejecting. Guard the fields so the destructure never throws.
      const generateHTML = htmlModule?.generateHTML;
      const StarterKit = starterKitModule?.default;
      const Link = linkModule?.default;
      if (!generateHTML || !StarterKit || !Link) {
        throw new Error('CMS rich text renderer chunk failed to load');
      }

      const richTextExtensions = [
        StarterKit.configure({
          heading: { levels: [2, 3, 4] },
          // StarterKit v3 ships Link; configure separately for HTMLAttributes.
          link: false,
        }),
        Link.configure({
          openOnClick: true,
          HTMLAttributes: {
            class: 'text-blue-600 dark:text-blue-400 hover:underline',
          },
        }) as Extension,
      ];

      return (content: CmsRichTextDocument) => {
        if (!content || typeof content !== 'object') return '';
        try {
          const html = generateHTML(
            content as Parameters<typeof generateHTML>[0],
            richTextExtensions,
          );
          return sanitizeCmsRichTextHtml(html);
        } catch {
          return '';
        }
      };
    })().catch((err) => {
      rendererPromise = null;
      throw err;
    });
  }
  return rendererPromise;
}

/** Renders TipTap JSON to sanitized HTML. Loads TipTap in a separate chunk on first use. */
export async function renderCmsRichTextHtml(content: CmsRichTextDocument): Promise<string> {
  let render: RichTextRenderer;
  try {
    render = await loadRenderer();
  } catch {
    // A failed chunk load leaves the renderer unavailable. Degrade to empty HTML;
    // the chunk-load-recovery plugin reloads the page for fresh assets.
    return '';
  }
  return render(content);
}
