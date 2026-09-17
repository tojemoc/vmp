import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CmsRichTextDocument } from '@vmp/shared';
import { hashCmsRichTextContent } from '../utils/cmsRichTextHash';

// The footer and CMS pages render rich text with v-html. The server produces the
// HTML and the client reuses it during hydration, keyed by this content hash, so
// the client never re-runs the async renderer for the first paint. A stable key
// for equal content is what keeps SSR and the first client render identical.

const docWithText = (text: string): CmsRichTextDocument =>
  ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            text: 'Read more',
          },
        ],
      },
    ],
  }) as unknown as CmsRichTextDocument;

describe('cms rich text hydration key', () => {
  it('returns the same key for equal documents', () => {
    assert.equal(
      hashCmsRichTextContent(docWithText('Personal data notice.')),
      hashCmsRichTextContent(docWithText('Personal data notice.')),
    );
  });

  it('returns different keys for different documents', () => {
    assert.notEqual(
      hashCmsRichTextContent(docWithText('Personal data notice.')),
      hashCmsRichTextContent(docWithText('Different copy.')),
    );
  });

  it('handles nullish content without throwing', () => {
    assert.equal(typeof hashCmsRichTextContent(null as unknown as CmsRichTextDocument), 'string');
  });
});
