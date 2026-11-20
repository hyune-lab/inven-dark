// 인벤 여러 종류의 페이지를 돌며 다크 적용 상태를 검사한다.
// 사용: node scripts/survey.mjs [--collect | --collect-mobile] [--only=A,B] [--match=문자열]
//  - --collect: 메인·서비스 첫 화면 링크에서 종류별 대표 주소를 모아 docs/survey-urls.json에 저장만 한다(없으면 검사 전에 자동으로).
//  - --collect-mobile: 모바일 인벤(m.inven.co.kr) 대표 주소를 모아 묶음 M으로 목록에 더한다(기존 M은 바꿈).
//  - 묶음 M은 PC 창 폭(1400)과 휴대폰 폭(390, 모바일 흉내) 두 가지로 검사한다.
//  - 페이지마다 글자 대비, 밝은 바탕 비율(사진·영상 제외), 큰 흰 요소를 재고 shots/survey/에 캡처와 보고서를 남긴다.
// 읽기만 한다(로그인·글쓰기·투표 금지). 요청은 한 번에 하나, 페이지 사이 2.5초 쉰다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ext, launch, contrastIssues, whiteElements, brightRatio } from './lib.mjs';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const match = (args.find((a) => a.startsWith('--match=')) || '').slice(8);
const listFile = join(ext, 'docs', 'survey-urls.json');
const out = join(ext, 'shots', 'survey');
mkdirSync(out, { recursive: true });

const { ctx, page, close } = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function visit(url) {
  const wait = 2500 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

// 행동이 일어나거나(로그인·글쓰기·투표 등) 검색 결과 대량 순회가 되는 주소는 뺀다. PC 목록에서는 모바일 주소도 뺀다.
const ACTION = /login|logout|member\/|mypage|write|modify|delete|vote|search|javascript:|\.(jpg|png|gif|zip|exe)$|act=|query=|bbsadmin|note\//i;
const SKIP = new RegExp(`${ACTION.source}|m\\.inven|\\/mobile`, 'i');
const NON_GAME_HOST = /^(www|imart|it|pc|m|static|upload\d*|member|gamezone|store|live|webzine|news|event|ad|cdn|shop|game|gamecalendar|chat|tv|pick)\./;
const GAME_SKIP = new Set(['board', 'webzine', 'common', 'member', 'search', 'event', 'imart', 'gamezone', 'gamecalendar', 'live', 'store']);

// 같은 종류의 페이지를 하나로 묶는 열쇠: 숫자 마디는 #, 질의는 이름만
function keyOf(u) {
  const segs = u.pathname.split('/').filter(Boolean).map((s) => (/^\d+$/.test(s) ? '#' : s.length > 24 ? '*' : s));
  if (segs[0] === 'board' && segs.length >= 2) segs[1] = '{game}'; // 게시판은 게임 구분 없이 종류만
  if (u.hostname === 'party.inven.co.kr' && segs.length) segs[0] = '{party}'; // 팟벤은 주제만 다른 같은 화면
  return `${u.hostname}/${segs.join('/')}?${[...u.searchParams.keys()].sort().join('&')}`;
}
// 묶음: A 뉴스·웹진, B 게임 인벤 첫 화면, C 게임 정보·도구, D 그 밖
function groupOf(u) {
  const p = u.pathname;
  const segs = p.split('/').filter(Boolean);
  if (/^\/webzine\/(calendar|zone|live|invengames)/.test(p)) return 'D'; // 게임캘린더·게이머존·라이브·인벤게임즈
  if (/webzine|news/i.test(u.hostname + p)) return 'A';
  if (segs.some((s) => /^(dataninfo|db|calculator|calc|simulator|simul|skill|item|dic|tool|guide|map|codex|build|tier)$/i.test(s))) return 'C';
  if (u.hostname === 'www.inven.co.kr' && segs.length === 1 && !GAME_SKIP.has(segs[0])) return 'B';
  // 게임 인벤은 gta6.inven.co.kr처럼 하위 도메인 첫 화면인 경우가 많다
  if (segs.length <= 1 && !NON_GAME_HOST.test(u.hostname) && (!segs[0] || /^index|^main/.test(segs[0]))) return 'B';
  return 'D';
}

async function links() {
  return page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
}

async function collect() {
  const seen = new Map(); // key → {url, group}
  const add = (href) => {
    let u;
    try { u = new URL(href); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || !/(^|\.)inven\.co\.kr$/.test(u.hostname) || SKIP.test(href)) return;
    u.hash = '';
    const k = keyOf(u);
    const list = seen.get(k) || [];
    if (list.length < 2 && !list.includes(u.href)) list.push(u.href);
    seen.set(k, list);
  };
  await visit('https://www.inven.co.kr/');
  const first = await links();
  first.forEach(add);
  // 서비스 첫 화면(주소 마디가 1개 이하)들을 한 번씩 더 열어 그 안의 링크도 모은다
  const roots = [...new Set(first.filter((h) => { try { const u = new URL(h); return /inven\.co\.kr$/.test(u.hostname) && !SKIP.test(h) && u.pathname.split('/').filter(Boolean).length <= 1 && !u.search; } catch { return false; } }))].slice(0, 25);
  for (const r of roots) {
    try { await visit(r); (await links()).forEach(add); console.log(`모음 ${r}`); } catch (e) { console.log(`건너뜀 ${r} ${e.message.split('\n')[0]}`); }
  }
  // 묶음별로 고르게: B(게임 첫 화면)는 10곳까지, 전체 80곳까지
  const picked = { A: [], B: [], C: [], D: [] };
  const cap = { A: 22, B: 10, C: 22, D: 26 };
  for (const [k, urls] of seen) {
    const g = groupOf(new URL(urls[0]));
    const room = cap[g] - picked[g].length;
    if (room <= 0) continue;
    const take = g === 'B' ? urls.slice(0, 1) : urls.slice(0, Math.min(2, room));
    picked[g].push(...take.map((url) => ({ url, key: k })));
  }
  const list = Object.entries(picked).flatMap(([group, items]) => items.map((it) => ({ group, ...it })));
  mkdirSync(join(ext, 'docs'), { recursive: true });
  writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');
  console.log(`주소 ${list.length}곳 저장: ${listFile} (A ${picked.A.length}, B ${picked.B.length}, C ${picked.C.length}, D ${picked.D.length})`);
  return list;
}

// 모바일 인벤: 메인과 그 안의 첫 화면들에서 링크를 모아 종류별로 고른다(22곳까지).
// 게임 첫 화면(m.inven.co.kr/게임)은 한 종류로 묶어 4곳, 게시판 목록·글 보기는 2곳, 나머지는 1곳씩.
async function collectMobile() {
  const seen = new Map();
  const mkey = (u) => {
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length === 1 && !/\./.test(segs[0]) && !['webzine', 'party', 'imart', 'common', 'board'].includes(segs[0])) return 'm/{game}';
    if (segs[0] === 'board') return `m/board/${segs.length >= 4 ? 'view' : 'list'}`; // 쪽 번호·말머리 같은 질의는 같은 화면
    if (u.searchParams.has('idx')) return `${keyOf(u).split('?')[0]}?idx`; // 뉴스 기사
    return keyOf(u);
  };
  const add = (href) => {
    let u;
    try { u = new URL(href); } catch { return; }
    if (u.hostname !== 'm.inven.co.kr' || ACTION.test(href)) return;
    u.hash = '';
    u.protocol = 'https:';
    if (!u.pathname.endsWith('/') && !/\.\w+$/.test(u.pathname) && u.pathname.split('/').filter(Boolean).length === 1) u.pathname += '/';
    const k = mkey(u);
    const list = seen.get(k) || [];
    if (!list.includes(u.href)) list.push(u.href);
    seen.set(k, list);
  };
  // 사용자가 알려 준 로아 자유게시판 목록을 맨 앞에
  const starts = ['https://m.inven.co.kr/board/lostark/6271', 'https://m.inven.co.kr/'];
  starts.forEach(add);
  for (const start of starts) { await visit(start); (await links()).forEach(add); }
  const roots = [...new Set([...seen.values()].flat())].filter((h) => new URL(h).pathname.split('/').filter(Boolean).length <= 1).slice(0, 10);
  for (const r of roots) {
    try { await visit(r); (await links()).forEach(add); console.log(`모음 ${r}`); } catch (e) { console.log(`건너뜀 ${r} ${e.message.split('\n')[0]}`); }
  }
  const items = [];
  for (const [k, urls] of seen) {
    const take = k === 'm/{game}' ? 4 : /\/board\//.test(k) ? 2 : 1;
    for (const url of urls.slice(0, take)) if (items.length < 22) items.push({ group: 'M', url, key: k });
  }
  const old = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')).filter((it) => it.group !== 'M') : [];
  writeFileSync(listFile, JSON.stringify([...old, ...items], null, 2) + '\n');
  console.log(`모바일 주소 ${items.length}곳 추가: ${listFile}`);
}

// 휴대폰 폭 흉내: 창 크기와 함께 모바일 기기·터치·사용자 에이전트를 맞춘다
const cdp = await ctx.newCDPSession(page);
async function setMobile(on) {
  if (on) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  } else {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Network.setUserAgentOverride', { userAgent: '' });
  }
}

try {
  const collectOnly = args.includes('--collect') || args.includes('--collect-mobile'); // 목록만 새로 만든다
  let list = args.includes('--collect') || !existsSync(listFile) ? await collect() : JSON.parse(readFileSync(listFile, 'utf8'));
  if (args.includes('--collect-mobile')) await collectMobile();
  if (collectOnly) list = [];
  // 묶음 M은 PC 폭과 휴대폰 폭 두 번 검사한다
  list = list.flatMap((it) => (it.group === 'M' ? [{ ...it, mobile: false }, { ...it, mobile: true }] : [it]));
  if (only.length) list = list.filter((it) => only.includes(it.group));
  if (match) list = list.filter((it) => it.url.includes(match));
  const report = [];
  for (const [i, it] of list.entries()) {
    const name = `${it.group}-${String(i).padStart(2, '0')}${it.group === 'M' ? (it.mobile ? '-m' : '-pc') : ''}`;
    try {
      if (it.group === 'M') await setMobile(it.mobile);
      await visit(it.url);
      const attr = await page.evaluate(() => document.documentElement.getAttribute('data-inven-dark'));
      // 아주 긴 페이지는 위쪽 6000px만 본다(캡처 크기·시간 제한)
      const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 6000));
      const width = await page.evaluate(() => window.innerWidth);
      const png = await page.screenshot({ path: join(out, `${name}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } });
      const bright = await brightRatio(ctx, page, png);
      const contrast = await contrastIssues(page);
      const whites = await whiteElements(page);
      const score = Math.round(bright * 100) + contrast.length + whites.length;
      report.push({ name, group: it.group, url: it.url, final: page.url(), dark: attr, bright: +bright.toFixed(3), contrast: contrast.slice(0, 15), whites, score });
      console.log(`${name} 점수=${score} 밝음=${(bright * 100).toFixed(1)}% 대비=${contrast.length} 흰요소=${whites.length} ${attr !== 'on' ? '(다크 아님) ' : ''}${it.url}`);
    } catch (e) {
      report.push({ name, group: it.group, url: it.url, error: e.message.split('\n')[0] });
      console.log(`${name} 오류 ${it.url} ${e.message.split('\n')[0]}`);
    }
  }
  if (!collectOnly) {
    report.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    writeFileSync(join(out, 'survey-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`보고서: ${join(out, 'survey-report.json')}`);
  }
} finally {
  await close();
}
