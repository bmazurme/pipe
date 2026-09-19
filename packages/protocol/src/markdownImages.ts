// Pure parsing only — no fetch. sync and reports each have their own GitLab
// HTTP client/auth (deliberately not shared, see gitlabClient.ts in both),
// so downloading whatever this finds is each product's own job; this just
// answers "what image references does this markdown contain".
export interface MarkdownImageRef {
  url: string;
  altText: string;
}

// Matches GitLab's own issue-description image syntax: ![alt](url). Doesn't
// try to handle reference-style links (![alt][ref]) — GitLab's own editor
// never emits those for pasted/uploaded images.
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^\s)]+)\)/g;

export function extractMarkdownImageRefs(markdown: string): MarkdownImageRef[] {
  const refs: MarkdownImageRef[] = [];

  for (const match of markdown.matchAll(IMAGE_REF_RE)) {
    refs.push({ altText: match[1], url: match[2] });
  }

  return refs;
}
