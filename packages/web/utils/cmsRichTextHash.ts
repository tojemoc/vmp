import type { CmsRichTextDocument } from '@vmp/shared';

/**
 * Stable, deterministic key for a rich text document. The rich text HTML is
 * rendered on the server and reused during hydration keyed by this hash, so equal
 * content resolves to the same payload entry on both sides and the client never
 * re-runs the async renderer for the first paint (see CmsRichTextContent).
 */
export function hashCmsRichTextContent(content: CmsRichTextDocument): string {
  const json = JSON.stringify(content ?? null);
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 33 + json.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
