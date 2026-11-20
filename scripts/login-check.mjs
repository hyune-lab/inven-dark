// 로그인 상태 화면 확인(수동 실행용). 자동 회귀(shoot/survey)에는 넣지 않는다.
// 사용: 확장을 넣고 인벤에 로그인해 둔 크롬을 --remote-debugging-port=9333으로 띄운 뒤 node scripts/login-check.mjs [--only=이름]
// - 그 브라우저에 연결해 새 탭 하나만 열어 쓰고, 끝나면 그 탭만 닫고 연결을 끊는다(브라우저와 기존 탭은 그대로).
// - 읽기만 한다: 글·댓글·쪽지 쓰기, 추천·신고, 설정 변경, 구매, 출석 같은 행동은 하지 않는다. 확인 창은 모두 취소한다.
//   클릭은 메뉴를 펼치는 동작(닉네임 메뉴)만 한다. 글쓰기 화면은 열어서 보기만 한다.
// - 캡처에는 닉네임·쪽지 같은 개인 정보가 찍히므로 shots/login/(저장소에 올리지 않음)에만 둔다.
//   화면 출력에는 글자 조각을 빼고 선택자만 찍는다.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ext, contrastIssues, whiteElements } from './lib.mjs';

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const out = join(ext, 'shots', 'login');
mkdirSync(out, { recursive: true });
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const hide = (rows) => rows.map((r) => r.replace(/ "[^"]*"$/, '')); // 글자 조각(개인 정보일 수 있음) 빼기

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.on('dialog', (d) => d.dismiss().catch(() => {})); // 확인 창은 모두 취소
const cdp = await ctx.newCDPSession(page);
const report = [];
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 작업용 브라우저의 확장은 처음 불러온 때의 파일을 쓰므로, 저장소의 최신 dark.css를 이 탭에만 덧붙여 검사한다
// (확장 자체를 다시 불러오지 않아 사용자 브라우저 상태를 바꾸지 않는다).
const css = readFileSync(join(ext, 'src', 'dark.css'), 'utf8');
async function open(url) {
  await sleep(2000); // 인벤에 부담을 주지 않게 천천히
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.addStyleTag({ content: css });
  await page.evaluate(() => { if (location.hostname === 'm.inven.co.kr') document.documentElement.setAttribute('data-inven-m', ''); });
  await page.waitForTimeout(1500);
}

// 다크 끔/켬 캡처(위쪽 4000px까지)와 검사
async function check(name) {
  const dark = await page.evaluate(() => document.documentElement.getAttribute('data-inven-dark'));
  const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 4000));
  const width = await page.evaluate(() => window.innerWidth);
  for (const m of ['off', 'on']) {
    await page.evaluate((m) => document.documentElement.setAttribute('data-inven-dark', m), m);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `${name}-${m}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } });
  }
  const contrast = hide(await contrastIssues(page));
  const whites = await whiteElements(page);
  report.push({ name, url: page.url(), dark, contrast, whites });
  if (dark !== 'on') failed++;
  console.log(`${name} 다크=${dark} 대비=${contrast.length} 흰요소=${whites.length}`);
  for (const c of contrast.slice(0, 8)) console.log('  대비', c);
  for (const w of whites.slice(0, 5)) console.log('  흰', w.size, w.bg, w.sel);
}

// 마우스를 올리거나 메뉴를 연 뒤 화면 안에 새로 들어온 절대위치·고정 글자 레이어가 투명하면 실패(shoot.mjs와 같은 기준)
const markVisible = () => page.evaluate(() => {
  const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
  window.__idInView = inView;
  window.__idVis = new Set([...document.querySelectorAll('body *')].filter(inView));
});
async function layerCheck(name) {
  const bad = await page.evaluate(() => {
    const seen = window.__idVis || new Set();
    const opaque = (e) => { const s = getComputedStyle(e); const m = (s.backgroundColor.match(/[\d.]+/g) || []).map(Number); return s.backgroundImage !== 'none' || (m.length >= 3 && (m[3] === undefined || m[3] >= 0.95)); };
    const freshAll = [...document.querySelectorAll('body *')].filter((e) => !seen.has(e) && window.__idInView(e) && !e.closest('[class*="swiper"], [class*="roll"]'));
    const set = new Set(freshAll);
    const fresh = freshAll.filter((e) => { const s = getComputedStyle(e); return !set.has(e.parentElement) && s.visibility !== 'hidden' && /absolute|fixed/.test(s.position); });
    const ok = (e) => {
      if (e.textContent.trim().length < 2) return true;
      const r = e.getBoundingClientRect(); const area = r.width * r.height;
      if (area < 2000) return true;
      if (opaque(e) || [...e.querySelectorAll('*')].some((d) => { const q = d.getBoundingClientRect(); return q.width * q.height >= 0.9 * area && opaque(d); })) return true;
      const a = (getComputedStyle(e).backgroundColor.match(/[\d.]+/g) || []).map(Number)[3];
      return a >= 0.5 && [...e.children].every(ok);
    };
    return fresh.filter((e) => !ok(e)).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
  });
  if (bad.length) failed++;
  console.log(`${bad.length ? '실패' : '통과'} 레이어 ${name}${bad.length ? ': ' + bad.join(', ') : ''}`);
  await page.screenshot({ path: join(out, `layer-${name}.png`) });
}

// 클릭으로 여는 메뉴(햄버거·전체 메뉴): 메뉴를 여는 버튼만 누른다(javascript: 링크라도 메뉴 열기는 허용)
async function menuCheck(name, selector) {
  const btn = await page.$(selector);
  if (!btn) { console.log(`메뉴 ${name} 버튼 없음`); return; }
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await markVisible(); await btn.click(); await page.waitForTimeout(1000);
  await layerCheck(`menu-${name}`);
  await page.keyboard.press('Escape');
}

async function setMobile(on) {
  await page.setViewportSize(on ? { width: 390, height: 844 } : { width: 1400, height: 900 });
  await cdp.send('Network.setUserAgentOverride', { userAgent: on ? MOBILE_UA : '' });
}

// 링크 주소 찾기(글자는 출력하지 않는다). javascript: 링크는 열면 동작(쪽지 쓰기 창 등)이 실행되므로 http(s) 주소만 본다.
const findHref = (test) => page.evaluate((src) => { const f = new Function('a', `return ${src}`); return [...document.querySelectorAll('a[href]')].find((a) => /^https?:/.test(a.href) && !/write/i.test(a.href.split('?')[1] || '') && f(a))?.href || null; }, test);

const steps = {
  async pcMain() {
    await open('https://www.inven.co.kr/'); await check('pc-main');
    await open('https://www.inven.co.kr/board/lostark/6271'); await menuCheck('pc-all-menu', 'header.community-header button.btn-all');
  },
  async pcList() {
    await open('https://www.inven.co.kr/board/lostark/6271');
    await check('pc-list');
    // 목록 제목 미리보기(로그인 사용자에게만 뜸): 실제로 뜨는지와 불투명
    for (const a of (await page.$$('.board-list tbody tr:not(.notice) a.subject-link')).slice(0, 5)) {
      await a.scrollIntoViewIfNeeded(); await markVisible(); await a.hover(); await page.waitForTimeout(1500);
      if (await page.$('.boardPreview:visible')) break;
    }
    const pv = await page.$('.boardPreview:visible');
    console.log(`제목 미리보기 ${pv ? '뜸' : '안 뜸'}`);
    await layerCheck('pc-list-preview');
    await page.mouse.move(0, 0);
    // 닉네임 메뉴(클릭하면 펼쳐지는 메뉴, 항목은 누르지 않는다)
    const nick = await page.$('.board-list tbody tr:not(.notice) td.user span.layerNickName, .board-list tbody tr:not(.notice) td.user a, .board-list tbody tr:not(.notice) td.user span');
    if (nick) { await markVisible(); await nick.click(); await page.waitForTimeout(800); await layerCheck('pc-nick-menu'); await page.keyboard.press('Escape'); }
  },
  async pcView() {
    await open('https://www.inven.co.kr/board/lostark/6271');
    const href = await page.evaluate(() => [...document.querySelectorAll('.board-list tbody tr:not(.notice)')].find((r) => +r.querySelector('.con-comment')?.dataset.opinionBbsOpi > 0)?.querySelector('a.subject-link')?.href);
    if (href) { await open(href); await check('pc-view'); }
  },
  async pcWrite() { await open('https://www.inven.co.kr/board/powerbbs.php?come_idx=6271&query=write'); await check('pc-write'); },
  async pcNote() {
    await open('https://www.inven.co.kr/member/note/');
    await check('pc-note-list');
    // 쪽지 읽기는 '보낸 쪽지'로 한다(받은 쪽지를 열면 읽음 표시가 바뀐다)
    const sent = await findHref("/send|sent|outbox/i.test(a.href)");
    if (sent) {
      await open(sent); await check('pc-note-sent');
      const msg = await findHref("/(view|read|idx=|no=)/i.test(a.href) && /note/i.test(a.href)");
      if (msg) { await open(msg); await check('pc-note-read'); } else console.log('보낸 쪽지 읽기 주소 없음');
    } else console.log('보낸 쪽지함 주소 없음');
  },
  async pcMy() {
    for (const [n, u] of [['inventory', 'https://www.inven.co.kr/member/inventory/'], ['skill', 'https://www.inven.co.kr/member/skill/'], ['scrap', 'https://www.inven.co.kr/member/scrap/']]) { await open(u); await check(`pc-my-${n}`); }
    await open('https://www.inven.co.kr/board/lostark/6271');
    const acc = await findHref("/member\\.inven\\.co\\.kr\\/user\\/.*\\/change/.test(a.href)");
    if (acc) { await open(acc); await check('pc-my-account'); }
  },
  async pcImart() { await open('https://imart.inven.co.kr/'); await check('pc-imart'); },
  async mobile() {
    await setMobile(true);
    try {
      await open('https://m.inven.co.kr/'); await check('m-main');
      await open('https://m.inven.co.kr/board/lostark/6271'); await check('m-list');
      await menuCheck('m-hamburger', 'a#bttnCommunity');
      await open('https://m.inven.co.kr/board/lostark/6271');
      // 글쓰기 버튼은 목록 화면에 있다(열어서 보기만)
      const write = await page.evaluate(() => [...document.querySelectorAll('a[href]')].find((a) => /^https?:\/\/m\.inven/.test(a.href) && /query=write|\/write|mode=write/i.test(a.href))?.href || null);
      const view = await page.evaluate(() => document.querySelector('a.com-btn')?.href);
      if (view) { await open(view); await check('m-view'); }
      if (write) { await open(write); await check('m-write'); } else console.log('모바일 글쓰기 주소 없음');
      await open('https://m.inven.co.kr/member/note/'); await check('m-note');
      await open('https://m.inven.co.kr/');
      const my = await findHref("/mypage|myinfo|\\/member\\//i.test(a.href) && !/logout/i.test(a.href)");
      if (my) { await open(my); await check('m-my'); } else console.log('모바일 내 정보 주소 없음');
    } finally { await setMobile(false); }
  },
};

try {
  for (const [name, fn] of Object.entries(steps)) {
    if (only && name !== only) continue;
    try { await fn(); } catch (e) { failed++; console.log(`오류 ${name} ${e.message.split('\n')[0]}`); }
  }
  writeFileSync(join(out, 'login-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`보고서: ${join(out, 'login-report.json')} (실패 ${failed})`);
} finally {
  await page.close().catch(() => {});
  process.exitCode = failed ? 1 : 0;
  // 브라우저는 사용자 것이라 닫지 않는다. 연결만 끊기 위해 프로세스를 끝낸다.
  setTimeout(() => process.exit(process.exitCode), 100);
}
