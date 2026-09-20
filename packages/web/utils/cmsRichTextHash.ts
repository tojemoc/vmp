import type { CmsRichTextDocument } from '@vmp/shared';

/**
 * Stable, collision-free key material for a rich text document. The rendered
 * HTML is reused from the Nuxt payload during hydration, so the key must retain
 * the complete serialized content rather than a fixed-width hash.
 */
export function serializeCmsRichTextContent(content: CmsRichTextDocument): string {
  return JSON.stringify(content ?? null);
}
