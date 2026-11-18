import { ARTICLE_SLUG } from '../src/assistant-contract.js';

// Add a source here only when its content has been approved for public release.
// The shared timeline, whispers and drafts do not provide records to this index.
export const publicArticles = Object.freeze([]);

function terms(value) {
  const text = value.normalize('NFKC').toLowerCase();
  const words = text.match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu) ?? [];
  return new Set(words.flatMap(word => {
    if (!/\p{Script=Han}/u.test(word)) return [word];
    return Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2));
  }));
}

export function indexPublicArticles(articles) {
  const index = new Map();
  for (const { slug, title, excerpt } of articles) {
    if (typeof slug !== 'string' || !ARTICLE_SLUG.test(slug) || index.has(slug)
      || typeof title !== 'string' || !title.trim() || typeof excerpt !== 'string' || !excerpt.trim()) {
      throw new Error('助手公开文章索引无效。');
    }
    const article = { slug, title: title.trim().slice(0, 160), excerpt: excerpt.trim().slice(0, 1200) };
    index.set(slug, { ...article, titleTerms: terms(article.title), excerptTerms: terms(article.excerpt) });
  }
  return index;
}

export function articleContext(index, slug, question) {
  const current = index.get(slug);
  const query = terms(question);
  const matches = [];
  for (const article of index.values()) {
    if (article === current) continue;
    let score = 0;
    for (const token of query) {
      if (article.titleTerms.has(token)) score += 3;
      else if (article.excerptTerms.has(token)) score++;
    }
    if (score >= 2) matches.push({ article, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return [current, ...matches.map(({ article }) => article)].filter(Boolean).slice(0, 3)
    .map(({ slug, title, excerpt }) => ({ title, excerpt, href: `#timeline?entry=${encodeURIComponent(slug)}` }));
}
