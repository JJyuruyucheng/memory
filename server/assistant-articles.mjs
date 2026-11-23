import { ARTICLE_SLUG } from '../src/assistant-contract.js';

export const publicArticles = Object.freeze([]);
export const ENTRY_UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const published = row => row?.status === 'published' && ['note', 'event'].includes(row.type)
  && row.deletedAt === null && typeof row.id === 'string' && ENTRY_UUID.test(row.id);
const quotedTitles = question => [...question.matchAll(/《([^》]{1,120})》/gu)].map(match => normalize(match[1]));
export const asksAboutRecords = question => quotedTitles(question).length > 0
  || /站内|朝夕.{0,6}(?:随记|记录|文章|帖子)|发的|发过|这篇|那篇|这[条段]|哪篇|记录[里中]|帖子[里中]|发表的|发布的|共享(?:记录|回忆)|(?:查找|搜索|找找|解读|分析|总结|回顾).{0,32}(?:文章|帖子|随记|记录|事件|回忆)|(?:还记得|记不记得).{0,12}(?:以前|上次|那次|去过|我们|一起)|(?:我们|我).{0,6}(?:有没有|是否|曾经|以前).{0,8}(?:写过|提到|记过|记录过)/u.test(question);

export function asksForSharedPostCount(question) {
  const text = question.normalize('NFKC').replace(/[\s,.。!?！？]/gu, '');
  const query = text.replace(/^(?:瓜子|请问|请|麻烦|帮我(?:查一下|数一下|看一下)?|你看看?|(?:在)?(?:我们(?:的)?|这个|本)?(?:朝夕|系统|网站|站点|站内)(?:[上里内中])?|我们(?:的)?|截至目前|现在|目前|已经|一共|总共|总计|合计|共计|累计)+/u, '');
  // Match the whole question so a date, author or tag qualifier cannot turn
  // a narrower request into the site's overall total.
  return /^(?:有|发了|发过|发表了|发布了|写了)?(?:几|多少)[条篇个]?(?:帖子|贴子|帖文|文章|共享记录|记录)[了吗呢呀啊]*$/u.test(query)
    || /^(?:帖子|贴子|帖文|文章|共享记录|记录)的?(?:(?:总数|总量|数量)(?:(?:有|是)?多少)?|(?:一共|总共)?(?:有|是)?(?:多少|几[条篇个]))[了吗呢呀啊]*$/u.test(query);
}

export function sharedEntrySources(rows, ids, memories = new Map()) {
  const byId = new Map(rows.filter(published).map(row => [row.id, row]));
  let budget = 12_000;
  return ids.flatMap(id => {
    const row = byId.get(id);
    if (!row || !budget) return [];
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    const excerpt = content.slice(0, Math.min(8000, budget));
    budget -= excerpt.length;
    const day = String(row.occurredAt || '').slice(0, 10);
    const saved = memories.get(id);
    const memory = saved && saved.source_updated_at === row.updatedAt ? saved.memory : undefined;
    return [{ slug: id, version: row.updatedAt, title: row.title?.trim() || (day ? `${day} 的随记` : '随记'), author: row.author?.name?.slice(0, 60),
      day, excerpt, memory, truncated: excerpt.length < content.length, href: `#timeline?entry=${id}` }];
  });
}

const genericTerms = new Set(terms('我们 他们 你们 之前 最近 以前 记得 回忆 共享 帖子 随记 记录 文章 发布 发表 查找 搜索 分析 总结 回顾 一些 哪些 什么 怎么 关于 一起 是不是 有没有 经历 当时 那次 帮我 瓜子 朝夕 系统'));

function matchText(text, query) {
  const available = terms(text);
  return query.filter(word => available.has(word)).length;
}

export function sharedSearchTerms(question) {
  if (quotedTitles(question).length) return [];
  return [...terms(question)].filter(word => !genericTerms.has(word) && /^[\p{Script=Han}a-z0-9]{2,32}$/u.test(word)).slice(-12);
}

export function matchSharedEntries(rows, question, memberId, memories = new Map()) {
  const phrase = normalize(question), named = quotedTitles(question);
  const available = rows.filter(published);
  const names = [...new Set(available.map(row => normalize(row.author?.name)))].filter(name => name.length >= 2 && phrase.includes(name));
  const own = /我(?:发|写|记)的/u.test(question);
  const query = [...terms(question)].filter(word => !genericTerms.has(word) && !names.some(name => name.includes(word)));
  const browse = /(?:最近|最新).{0,6}(?:随记|记录|帖子|文章|动态)|(?:总结|回顾|汇总).{0,8}(?:最近|近期)/u.test(question);
  const matches = [];
  for (const row of available) {
    const author = normalize(row.author?.name);
    if ((own && row.authorId !== memberId) || (!own && names.length && !names.includes(author))) continue;
    const title = normalize(row.title);
    const exact = named.length ? named.includes(title) : title.length >= 2 && phrase.includes(title);
    if (named.length && !exact) continue;
    const tag = Array.isArray(row.tags) && row.tags.map(normalize).some(value => value.length >= 2 && phrase.includes(value));
    const searchByAuthor = (own || names.length) && /(?:总结|汇总|最近|哪些|所有|找|发过)/u.test(question);
    const saved = memories.get(row.id);
    const memory = saved && saved.source_updated_at === row.updatedAt ? saved.memory : undefined;
    const themes = Array.isArray(memory?.themes) && memory.themes.map(normalize).some(value => value.length >= 2 && phrase.includes(value));
    const related = matchText([row.title, row.content, memory?.summary, ...(memory?.statedFeelings ?? [])].filter(Boolean).join(' '), query);
    const score = exact ? 100 + title.length : tag ? 40 : themes ? 30 : related >= 2 ? 12 + Math.min(related, 15) : searchByAuthor || browse ? 1 : 0;
    if (score) matches.push({ id: row.id, score });
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
