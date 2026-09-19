import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractMarkdownImageRefs } from './markdownImages.js';

describe('extractMarkdownImageRefs', () => {
  it('finds a single GitLab-style uploaded image reference', () => {
    const refs = extractMarkdownImageRefs(
      'See the crash here:\n\n![screenshot](/uploads/abc123/screenshot.png)\n\nThanks.',
    );

    assert.deepEqual(refs, [{ altText: 'screenshot', url: '/uploads/abc123/screenshot.png' }]);
  });

  it('finds multiple references, including absolute URLs', () => {
    const refs = extractMarkdownImageRefs(
      '![one](/uploads/aaa/one.png) some text ![two](https://gitlab.example.com/uploads/bbb/two.jpg)',
    );

    assert.deepEqual(refs, [
      { altText: 'one', url: '/uploads/aaa/one.png' },
      { altText: 'two', url: 'https://gitlab.example.com/uploads/bbb/two.jpg' },
    ]);
  });

  it('returns an empty array for text with no images', () => {
    assert.deepEqual(extractMarkdownImageRefs('Just a plain description, no attachments.'), []);
  });

  it('does not confuse a regular markdown link with an image reference', () => {
    assert.deepEqual(extractMarkdownImageRefs('See [the docs](https://example.com/docs) for details.'), []);
  });

  it('allows an empty alt text', () => {
    const refs = extractMarkdownImageRefs('![](/uploads/xyz/pasted.png)');
    assert.deepEqual(refs, [{ altText: '', url: '/uploads/xyz/pasted.png' }]);
  });
});
