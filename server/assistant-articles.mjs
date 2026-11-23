import { ARTICLE_SLUG } from '../src/assistant-contract.js';

export const publicArticles = Object.freeze([]);
export const ENTRY_UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const published = row => row?.status === 'published' && ['note', 'event'].includes(row.type)
  && row.deletedAt === null && typeof row.id === 'string' && ENTRY_UUID.test(row.id);
const quotedTitles = question => [...question.matchAll(/《([^》]{1,120})》/gu)].map(match => normalize(match[1]));
export const asksAboutRecords = question => quotedTitles(question).length > 0
  || /站内|朝夕.{0,6}(?:随记|记录|文章|帖子)|发的|发过|这篇|那篇|这[条段]|哪篇|记录[里中]|帖子[里中]|发表的|发布的|共享记录|(?:查找|搜索|找找|解读|分析|总结).{0,32}(?:文章|帖子|随记|记录|事件)/u.test(question);

export function asksForSharedPostCount(question) {
  const text = question.normalize('NFKC').replace(/[\s,.。!?！？]/gu, '');
  const query = text.replace(/^(?:瓜子|请问|请|麻烦|帮我(?:查一下|数一下|看一下)?|你看看?|(?:在)?(?:我们(?:的)?|这个|本)?(?:朝夕|系统|网站|站点|站内)(?:[上里内中])?|我们(?:的)?|截至目前|现在|目前|已经|一共|总共|总计|合计|共计|累计)+/u, '');
  // Match the whole question so a date, author or tag qualifier cannot turn
  // a narrower request into the site's overall total.
  return /^(?:有|发了|发过|发表了|发布了|写了)?(?:几|多少)[条篇个]?(?:帖子|贴子|帖文|文章|共享记录|记录)[了吗呢呀啊]*$/u.test(query)
    || /^(?:帖子|贴子|帖文|文章|共享记录|记录)的?(?:(?:总数|总量|数量)(?:(?:有|是)?多少)?|(?:一共|总共)?(?:有|是)?(?:多少|几[条篇个]))[了吗呢呀啊]*$/u.test(query);
}

export function sharedEntrySources(rows, ids) {
  const byId = new Map(rows.filter(published).map(row => [row.id, row]));
  let budget = 12_000;
  return ids.flatMap(id => {
    const row = byId.get(id);
    if (!row || !budget) return [];
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    const excerpt = content.slice(0, Math.min(8000, budget));
    budget -= excerpt.length;
    const day = String(row.occurredAt || '').slice(0, 10);
    return [{ slug: id, title: row.title?.trim() || (day ? `${day} 的随记` : '随记'), author: row.author?.name?.slice(0, 60),
      day, excerpt, truncated: excerpt.length < content.length, href: `#timeline?entry=${id}` }];
  });
}

export function matchSharedEntries(rows, question, memberId) {
  const phrase = normalize(question), named = quotedTitles(question);
  const available = rows.filter(published);
  const names = [...new Set(available.map(row => normalize(row.author?.name)))].filter(name => name.length >= 2 && phrase.includes(name));
  const own = /我(?:发|写|记)的/u.test(question);
  const matches = [];
  for (const row of available) {
    const author = normalize(row.author?.name);
    if ((own && row.authorId !== memberId) || (!own && names.length && !names.includes(author))) continue;
    const title = normalize(row.title);
    const exact = named.length ? named.includes(title) : title.length >= 2 && phrase.includes(title);
    if (named.length && !exact) continue;
    const tag = Array.isArray(row.tags) && row.tags.map(normalize).some(value => value.length >= 2 && phrase.includes(value));
    const searchByAuthor = (own || names.length) && /(?:总结|汇总|最近|哪些|所有|找|发过)/u.test(question);
    if (exact || tag || searchByAuthor) matches.push({ id: row.id, score: exact ? 100 + title.length : tag ? 20 : 10 });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 3).map(match => match.id);
}

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
