// 확장을 넣은 크로미움으로 인벤 화면을 캡처해 shots/에 저장한다. 사용: node scripts/shoot.mjs
import { mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ext, launch, contrastIssues } from './lib.mjs';

const out = join(ext, 'shots');
const boards = [
  ['lostark', 'https://www.inven.co.kr/board/lostark/6271'],
  ['maple', 'https://www.inven.co.kr/board/maple/5974'],
  ['diablo4', 'https://www.inven.co.kr/board/diablo4/6030'],
];
mkdirSync(out, { recursive: true });
const { ctx, page, close } = await launch();
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
  await contrastCheck(name);
}

// 글자 대비 4.5:1 미만 목록을 출력한다. 원래 디자인의 흐린 글자도 섞일 수 있어 실패로 세지 않는다.
async function contrastCheck(name) {
  const rows = await contrastIssues(page);
  console.log(`대비 경고 ${name}: ${rows.length}종`);
  if (rows.length) console.log(rows.slice(0, 20).map((r) => '  ' + r).join('\n'));
}

// position: fixed/sticky로 떠 있는 넓은 요소가 투명하면 뒤 내용이 비친다. 자신이나 거의 같은 크기의 자식이 불투명해야 한다.
async function fixedCheck(name) {
  const bad = await page.evaluate(() => {
    const opaque = (e) => { const m = (getComputedStyle(e).backgroundColor.match(/[\d.]+/g) || []).map(Number); return m.length >= 3 && (m[3] === undefined || m[3] >= 0.95); };
    const res = [];
    for (const e of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(e);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (e.matches('.inven-float-alarm')) continue; // 원래 투명한 알림 묶음(안쪽 알림 상자만 불투명)
      if (e.querySelector('iframe') || /ad_?layer/i.test(e.id)) continue; // 광고 틀은 광고 색을 건드리지 않는다
      const r = e.getBoundingClientRect();
      if (r.width < 300 || r.height < 30 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const area = r.width * r.height;
      const covered = opaque(e) || [...e.querySelectorAll('*')].some((d) => { const q = d.getBoundingClientRect(); return q.width * q.height >= 0.9 * area && opaque(d); });
      if (!covered) res.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return res;
  });
  if (bad.length) failed++;
  console.log(`${bad.length ? '실패' : '통과'} 고정 요소 불투명 ${name}${bad.length ? ': ' + bad.join(', ') : ''}`);
}

// 마우스를 올리거나 메뉴 버튼을 누르기 전에 화면 안에 보이던 요소를 기억해 두고, 그 뒤 화면 안에 새로 들어온
// 절대위치·고정 글자 레이어가 투명하면 실패로 센다(뒤 내용과 겹쳐 안 읽힘). 자신이나 거의 같은 크기의 자식이 불투명해야 한다.
// '화면 안' 기준이라 숨어 있다 나타나는 펼침뿐 아니라 화면 밖에서 밀려 들어오는 서랍 메뉴도 잡는다.
const markVisible = () => page.evaluate(() => {
  const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
  window.__invenDarkInView = inView;
  window.__invenDarkVisible = new Set([...document.querySelectorAll('body *')].filter(inView));
});
async function newLayerCheck(name) {
  const bad = await page.evaluate(() => {
    const seen = window.__invenDarkVisible || new Set();
    const opaque = (e) => { const s = getComputedStyle(e); const m = (s.backgroundColor.match(/[\d.]+/g) || []).map(Number); return s.backgroundImage !== 'none' || (m.length >= 3 && (m[3] === undefined || m[3] >= 0.95)); };
    // 시간에 따라 돌아가는 롤링·스와이퍼 항목은 레이어가 아니다
    const freshAll = [...document.querySelectorAll('body *')].filter((e) => !seen.has(e) && window.__invenDarkInView(e) && !e.closest('[class*="swiper"], [class*="roll"]'));
    const freshSet = new Set(freshAll);
    // 새 레이어의 맨 바깥(부모는 원래 화면에 있던 요소)만, 그중 절대위치·고정인 것만 본다
    const fresh = freshAll.filter((e) => { const s = getComputedStyle(e); return !freshSet.has(e.parentElement) && s.visibility !== 'hidden' && (s.position === 'absolute' || s.position === 'fixed'); });
    // 레이어가 괜찮은 조건: 자신이나 거의 같은 크기의 자식이 불투명. 화면을 덮는 반투명 덮개(알파 0.5 이상)라면
    // 그 안의 글자 있는 자식 패널들이 각각 이 조건을 만족하면 된다.
    const ok = (e) => {
      if (e.textContent.trim().length < 2) return true;
      const r = e.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 2000) return true;
      if (opaque(e) || [...e.querySelectorAll('*')].some((d) => { const q = d.getBoundingClientRect(); return q.width * q.height >= 0.9 * area && opaque(d); })) return true;
      const a = (getComputedStyle(e).backgroundColor.match(/[\d.]+/g) || []).map(Number)[3];
      return a >= 0.5 && [...e.children].every(ok);
    };
    return fresh.filter((e) => !ok(e)).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
  });
  if (bad.length) { failed++; console.log(`실패 떠 있는 글자 레이어 투명 ${name}: ${bad.join(', ')}`); }
}

// 클릭으로 여는 메뉴(모바일 햄버거, PC 전체 메뉴 버튼): 눌러서 연 뒤 새로 화면에 들어온 레이어가 불투명한지 본다.
// 메뉴를 여는 버튼만 누른다(javascript: 링크라도 메뉴 열기는 허용, 글쓰기 같은 동작 링크는 누르지 않는다).
async function menuCheck(name, selector) {
  const btn = await page.$(selector);
  if (!btn) { failed++; console.log(`실패 메뉴 ${name} 버튼(${selector})을 못 찾음`); return; }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await markVisible();
  await btn.click();
  await page.waitForTimeout(1000);
  const before = failed;
  await newLayerCheck(`메뉴 ${name}`);
  console.log(`${failed === before ? '통과' : '실패'} 메뉴 ${name} 연 뒤 새 레이어 불투명`);
  await page.screenshot({ path: join(out, `menu-${name}.png`) });
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'load' }); // 열린 메뉴를 닫은 상태로 되돌린다
  await page.waitForTimeout(800);
}

// 목록 제목에 마우스를 올리면 뜨는 본문 미리보기(.boardPreview)를 확인한다.
// 미리보기 스크립트는 로그인한 사용자에게만 내려와서, 안 뜨면 같은 클래스의 레이어를 띄워 CSS만 확인한다.
async function previewCheck(name) {
  let layer = null;
  for (const a of (await page.$$('.board-list tbody tr:not(.notice) a.subject-link')).slice(0, 5)) {
    await a.scrollIntoViewIfNeeded();
    await markVisible();
    await a.hover();
    await page.waitForTimeout(1200);
    await newLayerCheck(`${name} 제목`);
    layer = await page.$('.boardPreview:visible');
    if (layer) break;
  }
  let how = '실제';
  if (!layer) {
    how = '모형(로그인 전이라 실제 미리보기 안 뜸)';
    await page.evaluate(() => {
      const a = document.querySelector('.board-list tbody tr:not(.notice) a.subject-link');
      const d = document.createElement('div');
      d.className = 'boardPreview';
      d.style.display = 'block';
      d.textContent = '미리보기 확인용 문장입니다. 글 내용 앞부분이 여러 줄로 표시되는 자리이며 뒤의 목록 글자와 겹치지 않아야 합니다.';
      a.closest('.board-list').appendChild(d); // 목록과 같은 쌓임 영역에 넣어야 실제처럼 목록 위에 뜬다
      const base = (d.offsetParent || document.body).getBoundingClientRect();
      const r = a.getBoundingClientRect();
      d.style.left = `${r.left - base.left + 40}px`;
      d.style.top = `${r.bottom - base.top + 6}px`;
    });
    layer = await page.$('.boardPreview:visible');
  }
  const alpha = await layer.evaluate((e) => { const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g); return m ? (m[3] === undefined ? 1 : +m[3]) : 0; });
  if (alpha !== 1) failed++;
  console.log(`${alpha === 1 ? '통과' : '실패'} 제목 미리보기(${how}) 배경 불투명도=${alpha}`);
  await page.screenshot({ path: join(out, `hover-${name}-preview.png`) });
  await page.evaluate(() => document.querySelectorAll('.boardPreview').forEach((e) => e.style.display = 'none'));
  await page.mouse.move(0, 0);
}

// 스크롤 위치별로 "커뮤니티" 펼침을 열어 화면을 캡처하고 패널 불투명을 확인한다.
async function communityHover(name) {
  const item = await page.$('ul.main-menu-list > li:has(.sub-menu-wrap):nth-child(2)') || await page.$('ul.main-menu-list > li:has(.sub-menu-wrap)');
  await markVisible();
  await item.hover();
  await page.waitForTimeout(500);
  await newLayerCheck(name);
  const alpha = await item.$eval('.sub-menu-wrap', (e) => { const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g); return m ? (m[3] === undefined ? 1 : +m[3]) : 0; });
  if (alpha !== 1) failed++;
  console.log(`${alpha === 1 ? '통과' : '실패'} 펼침 ${name} 배경 불투명도=${alpha}`);
  await page.screenshot({ path: join(out, `hover-${name}.png`) });
  await page.mouse.move(0, 0);
}

// 펼침 메뉴가 있는 항목마다 마우스를 올려 캡처하고, 펼친 패널 배경이 불투명한지 확인한다.
async function hoverShots(prefix, itemSel, panelSel) {
  const items = await page.$$(itemSel);
  if (!items.length) { failed++; console.log(`실패 펼침 ${prefix} 항목을 못 찾음`); }
  for (const [i, item] of items.entries()) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    await markVisible();
    await item.hover();
    await page.waitForTimeout(400);
    await newLayerCheck(`${prefix}-${i}`);
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
  await menuCheck('pc-all-menu', 'header.community-header button.btn-all');
  await hoverShots('maple-menu', '#commu-nav li.system:has(> ol)', ':scope > ol');

  for (const [name, url] of boards) {
    await shot(`${name}-list`, url);
    if (name === 'lostark') await previewCheck('lostark-list');
    // 공지를 뺀 일반 글 중 댓글이 달린 첫 글(댓글 화면까지 확인하려고)
    const href = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.board-list tbody tr:not(.notice)')];
      const row = rows.find((r) => +r.querySelector('.con-comment')?.dataset.opinionBbsOpi > 0) || rows[0];
      return row?.querySelector('a.subject-link')?.href;
    });
    if (href) await shot(`${name}-view`, href);
    else { failed++; console.log(`실패 ${name} 첫 글 주소를 못 찾음`); }
    if (href && name === 'lostark') {
      // 글 보기에서 스크롤 0과 1000(상단 메뉴가 화면 위에 고정된 상태)을 모두 확인
      await page.evaluate(() => window.scrollTo(0, 0));
      await communityHover('lostark-view-scroll0');
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(800);
      await fixedCheck('lostark-view-scroll1000');
      await page.screenshot({ path: join(out, 'sticky-lostark-view.png') });
      await communityHover('lostark-view-scroll1000');
    }
  }
  // 글쓴이 프로필 카드: 꾸미기 그림이 없는 기본 카드와 있는 카드를 각각 2장까지 요소 단위로 캡처
  await page.goto(boards[0][1], { waitUntil: 'domcontentloaded', timeout: 30000 });
  const posts = await page.evaluate(() => [...document.querySelectorAll('.board-list tbody tr:not(.notice) a.subject-link')].slice(0, 40).map((a) => a.href));
  const cards = { default: 0, skin: 0 };
  for (const url of posts) {
    if (cards.default >= 2 && cards.skin >= 2) break;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    const card = await page.$('.inventory-section');
    if (!card) continue;
    // 흰 기본 그림(i8244447807)을 쓰면 기본 카드, 그 밖은 사용자가 고른 꾸미기 그림
    const kind = (await card.evaluate((e) => e.querySelector('.summary')?.getAttribute('style')?.includes('i8244447807'))) ? 'default' : 'skin';
    if (cards[kind] >= 2) continue;
    await card.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 150)); // 고정 헤더에 가리지 않게
    await page.waitForTimeout(500);
    await card.screenshot({ path: join(out, `card-${kind}-${++cards[kind]}.png`) });
  }
  console.log(`프로필 카드 캡처: 기본 ${cards.default}장, 꾸미기 그림 ${cards.skin}장`);

  // "로아 프로필" 탭(캐릭터 연동한 글쓴이)을 열어 다크 끔/켬을 같은 자리에서 캡처해 비교한다
  let loa = null;
  for (const url of posts) {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    loa = await page.$('.inventory-section ul.tabs button:text("로아 프로필")');
    if (loa) break;
  }
  if (loa) {
    await loa.click();
    await page.waitForTimeout(1500);
    const card = await page.$('.inventory-section');
    await card.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 150));
    for (const mode of ['off', 'on']) {
      await page.evaluate((m) => document.documentElement.setAttribute('data-inven-dark', m), mode);
      await page.waitForTimeout(400);
      await card.screenshot({ path: join(out, `loa-profile-${mode}.png`) });
    }
    console.log(`로아 프로필 캡처: ${page.url()}`);
  } else console.log('로아 프로필 탭이 있는 글을 최근 40개에서 못 찾음');

  // 글 보기의 "댓글 보기" 새 창(베스트 댓글 포함)
  await shot('lostark-opinion', 'https://www.inven.co.kr/board/opinionbbs.php?come_idx=6271&l=4303145&iskin=');
  // 글 보기 안의 베스트 댓글(답글인 베스트·사진 있는 베스트 포함)
  await shot('lostark-best', 'https://www.inven.co.kr/board/lostark/6271/4321771');
  // 모바일 인벤(PC 창에서 연 m.inven.co.kr): PC 폭과 휴대폰 폭(390)에서 목록·글 보기, 스크롤 후 고정 탭 줄 불투명
  const cdp = await ctx.newCDPSession(page);
  for (const mobile of [false, true]) {
    const tag = mobile ? 'm390' : 'mpc';
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await cdp.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    }
    await shot(`${tag}-list`, 'https://m.inven.co.kr/board/lostark/6271');
    await menuCheck(`${tag}-hamburger`, 'a#bttnCommunity');
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(800);
    await fixedCheck(`${tag}-list 스크롤 700`);
    const bar = await page.evaluate(() => { const s = document.querySelector('section.tab-navi'); return s && `${getComputedStyle(s).position} ${getComputedStyle(s).backgroundColor}`; });
    const barOk = Boolean(bar && /fixed|sticky/.test(bar) && !/rgba\(0, 0, 0, 0\)/.test(bar));
    if (!barOk) failed++;
    console.log(`${barOk ? '통과' : '실패'} ${tag}-list 고정 탭 줄 ${bar}`);
    await page.screenshot({ path: join(out, `${tag}-list-scrolled.png`) });
    const view = await page.evaluate(() => document.querySelector('a.com-btn')?.href);
    if (view) await shot(`${tag}-view`, view);
    else { failed++; console.log(`실패 ${tag} 글 주소를 못 찾음`); }
  }
  await cdp.send('Network.setUserAgentOverride', { userAgent: '' });
  await page.setViewportSize({ width: 1400, height: 900 });

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
  await close();
}
process.exitCode = failed ? 1 : 0;
