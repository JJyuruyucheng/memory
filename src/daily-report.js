import { escapeHtml } from './domain.js';

const reportTitle = /^每日热点速览｜\d{4}-\d{2}-\d{2}$/;
const itemHeading = /^[ \t]*[1-9]\d*、[ \t]*\S/;

export function formatDailyReportBody(body) {
  let afterHeading = false;
  return body.split(/\r?\n/).filter(line => {
    if (afterHeading && !line.trim()) return false;
    afterHeading = itemHeading.test(line);
    return true;
  }).join('\n');
}

export function renderEntryText(title, body) {
  if (!reportTitle.test(title) || typeof body !== 'string') return escapeHtml(body);
  return formatDailyReportBody(body).split('\n').map(line => {
    const text = escapeHtml(line);
    return itemHeading.test(line) ? `<strong class="daily-report-heading">${text}</strong>` : text;
  }).join('\n');
}
