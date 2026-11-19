// 확장을 넣은 크로미움으로 인벤 화면을 캡처해 shots/에 저장한다. 사용: node scripts/shoot.mjs
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const ext = resolve(import.meta.dirname, '..');
const out = join(ext, 'shots');
const boards = [
  ['lostark', 'https://www.inven.co.kr/board/lostark/4811'],
  ['maple', 'https://www.inven.co.kr/board/maple/5974'],
  ['diablo4', 'https://www.inven.co.kr/board/diablo4/6030'],
];
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'inven-dark-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', // 확장은 일반 헤드리스에서 안 돌아 새 헤드리스 모드를 쓴다
  colorScheme: 'dark',
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const page = ctx.pages()[0] || (await ctx.newPage());
let failed = 0;

async function shot(name, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-inven-dark'));
  const ok = attr === 'on';
  if (!ok) failed++;
  console.log(`${ok ? '통과' : '실패'} ${name} data-inven-dark=${attr} ${page.url()}`);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
}

// 펼침 메뉴가 있는 항목마다 마우스를 올려 캡처하고, 펼친 패널 배경이 불투명한지 확인한다.
async function hoverShots(prefix, itemSel, panelSel) {
  const items = await page.$$(itemSel);
  if (!items.length) { failed++; console.log(`실패 펼침 ${prefix} 항목을 못 찾음`); }
  for (const [i, item] of items.entries()) {
    await item.hover();
    await page.waitForTimeout(400);
    const panel = await item.$(panelSel);
    const box = panel && (await panel.boundingBox());
    const alpha = panel && (await panel.evaluate((e) => {
      const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g);
      return m ? (m[3] === undefined ? 1 : +m[3]) : 0;
    }));
    const ok = Boolean(box && box.height > 0 && alpha === 1);
    if (!ok) failed++;
    const label = await item.evaluate((e) => e.textContent.trim().split(/\s+/)[0].slice(0, 10));
    console.log(`${ok ? '통과' : '실패'} 펼침 ${prefix}-${i} '${label}' 배경 불투명도=${alpha}`);
    const top = await item.boundingBox();
    const x = Math.max(0, Math.min(top.x, box ? box.x : top.x) - 20);
    const y = Math.max(0, top.y - 10);
    const bottom = box ? box.y + box.height : top.y + top.height;
    await page.screenshot({ path: join(out, `hover-${prefix}-${i}.png`), clip: { x, y, width: Math.min(1400 - x, Math.max(560, box ? box.width + 40 : 0)), height: bottom - y + 30 } });
  }
  await page.mouse.move(0, 0);
}

try {
  await shot('main', 'https://www.inven.co.kr/');
  // 상단 GNB 펼침 메뉴와 게임 인벤 상단 메뉴(메이플) 펼침 메뉴
  await page.goto(boards[1][1], { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1000);
  await hoverShots('gnb', 'ul.main-menu-list > li:has(.sub-menu-wrap)', '.sub-menu-wrap');
  await hoverShots('maple-menu', '#commu-nav li.system:has(> ol)', ':scope > ol');

  for (const [name, url] of boards) {
    await shot(`${name}-list`, url);
    // 공지를 뺀 일반 글 중 댓글이 달린 첫 글(댓글 화면까지 확인하려고)
    const href = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.board-list tbody tr:not(.notice)')];
      const row = rows.find((r) => +r.querySelector('.con-comment')?.dataset.opinionBbsOpi > 0) || rows[0];
      return row?.querySelector('a.subject-link')?.href;
    });
    if (href) await shot(`${name}-view`, href);
    else { failed++; console.log(`실패 ${name} 첫 글 주소를 못 찾음`); }
  }
  // 아이콘 창에서 고른 값이 열린 인벤 탭에 새로고침 없이 반영되는지(F-04)
  // 압축 해제 확장의 ID는 폴더 절대 경로의 sha256 앞 32자리를 a~p로 바꾼 값이다.
  const id = [...createHash('sha256').update(realpathSync(ext)).digest('hex').slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  for (const [mode, want] of [['off', 'off'], ['on', 'on'], ['auto', 'on']]) {
    await popup.check(`input[value="${mode}"]`);
    await page.waitForTimeout(500);
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-inven-dark'));
    if (attr !== want) failed++;
    console.log(`${attr === want ? '통과' : '실패'} 아이콘 창 '${mode}' 선택 → 인벤 탭 data-inven-dark=${attr}`);
  }
  await popup.close();

  await page.goto('https://example.com', { waitUntil: 'load' });
  const other = await page.evaluate(() => document.documentElement.hasAttribute('data-inven-dark'));
  if (other) failed++;
  console.log(`${other ? '실패' : '통과'} example.com data-inven-dark 속성 ${other ? '있음' : '없음'}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
