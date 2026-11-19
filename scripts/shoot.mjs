// 확장을 넣은 크로미움으로 인벤 화면을 캡처해 shots/에 저장한다. 사용: node scripts/shoot.mjs
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
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

try {
  await shot('main', 'https://www.inven.co.kr/');
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
