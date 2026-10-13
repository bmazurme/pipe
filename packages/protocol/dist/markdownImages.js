// Matches GitLab's own issue-description image syntax: ![alt](url). Doesn't
// try to handle reference-style links (![alt][ref]) — GitLab's own editor
// never emits those for pasted/uploaded images.
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^\s)]+)\)/g;
export function extractMarkdownImageRefs(markdown) {
    const refs = [];
    for (const match of markdown.matchAll(IMAGE_REF_RE)) {
        refs.push({ altText: match[1], url: match[2] });
    }
    return refs;
}
