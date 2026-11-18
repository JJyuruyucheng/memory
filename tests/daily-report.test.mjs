import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDailyReportBody, renderEntryText } from '../src/daily-report.js';

test('日报只收紧每项小标题下方的空行', () => {
  const source = '1、第一条\r\n \r\n\r\n内容一\r\n\r\n后续段落\r\n\r\n2、第二条\r\n\r\n内容二\r\n\r\n以上是全文。';
  const formatted = '1、第一条\n内容一\n\n后续段落\n\n2、第二条\n内容二\n\n以上是全文。';
  assert.equal(formatDailyReportBody(source), formatted);
  assert.equal(formatDailyReportBody(formatted), formatted);
});

test('日报仅加粗编号小标题，所有原文先转义', () => {
  const headline = '每日热点速览｜2026-11-17';
  const source = '1、设备 <型号>\n\n记录 <参数>。\n\n2、第二条\n内容二';
  assert.equal(renderEntryText(headline, source),
    '<strong class="daily-report-heading">1、设备 &lt;型号&gt;</strong>\n记录 &lt;参数&gt;。\n\n<strong class="daily-report-heading">2、第二条</strong>\n内容二');
  assert.equal(renderEntryText('普通随记', source), '1、设备 &lt;型号&gt;\n\n记录 &lt;参数&gt;。\n\n2、第二条\n内容二');
});
