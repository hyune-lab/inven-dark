// shoot.mjs와 survey.mjs가 함께 쓰는 부분: 확장을 넣은 크로미움 띄우기, 글자 대비 검사, 밝은 바탕 검사.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ext = resolve(import.meta.dirname, '..');

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'inven-dark-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // 확장은 일반 헤드리스에서 안 돌아 새 헤드리스 모드를 쓴다
    colorScheme: 'dark',
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const close = async () => { await ctx.close(); rmSync(profile, { recursive: true, force: true }); };
  return { ctx, page, close };
}

// 보이는 글자마다 실제 배경(조상까지 올라가 첫 불투명 배경)과 글자색 대비를 계산해 4.5:1 미만을 묶어서 돌려준다.
// 배경 그림 위 글자는 색을 알 수 없어 건너뛴다. 다크를 껐을 때(인벤 원래 화면)보다 나빠진 것만 센다:
// 원래 디자인부터 흐린 글자는 우리가 바꿀 대상이 아니다.
export function contrastIssues(page) {
  return page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const measure = (e) => {
      let bg = null;
      for (let x = e; x; x = x.parentElement) {
        const s = getComputedStyle(x);
        if (s.backgroundImage !== 'none') {
          // 그림(url)이면 색을 알 수 없어 건너뛴다. 그라데이션만이면 그 색 중 가장 밝은 색을 배경으로 본다.
          if (/url\(/.test(s.backgroundImage)) break;
          const stops = (s.backgroundImage.match(/rgba?\([^)]*\)/g) || []).map(parse);
          // 완전히 투명한 구간이 있으면 글자 일부에만 걸친 장식(반쪽 밑줄 등)이라 바탕으로 보지 않는다
          if (stops.length && !stops.some((c) => c[3] === 0)) {
            // 반투명 막은 요소 자신의 배경색 위에 섞어 계산하고, 배경색이 없으면 그 구간은 뺀다
            const base = parse(s.backgroundColor);
            const mixed = stops.map((c) => (c[3] === undefined || c[3] >= 0.9 ? c.slice(0, 3)
              : base.length >= 3 && (base[3] === undefined || base[3] >= 0.9) ? c.slice(0, 3).map((v, i) => v * c[3] + base[i] * (1 - c[3])) : null)).filter(Boolean);
            if (mixed.length) { bg = mixed.reduce((a, b) => (lum(b) > lum(a) ? b : a)); break; }
          }
        }
        const c = parse(s.backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.9)) { bg = c.slice(0, 3); break; }
      }
      if (!bg) return null;
      const color = getComputedStyle(e).color;
      const fg = parse(color);
      const a = fg[3] ?? 1;
      const mixed = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const [hi, lo] = [lum(mixed), lum(bg)].sort((p, q) => q - p);
      return { ratio: (hi + 0.05) / (lo + 0.05), color, bg };
    };
    const low = [];
    for (const e of document.querySelectorAll('body *')) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[style*="opacity: 0"], [aria-hidden="true"], .blind, .is-blind, .sr-only, .vjs-control-text')) continue; // 화면에 안 보이는 접근성용 글자 제외
      const m = measure(e);
      if (m && m.ratio < 4.5) low.push([e, m]);
    }
    const html = document.documentElement;
    const state = html.getAttribute('data-inven-dark');
    html.setAttribute('data-inven-dark', 'off');
    const orig = low.map(([e]) => measure(e));
    if (state === null) html.removeAttribute('data-inven-dark'); else html.setAttribute('data-inven-dark', state);
    const groups = new Map();
    low.forEach(([e, m], i) => {
      if (orig[i] && orig[i].ratio <= m.ratio + 0.01) return; // 원래 화면부터 이 정도였다
      const sel = `${e.tagName.toLowerCase()}${[...e.classList].slice(0, 2).map((c) => '.' + c).join('')} < ${e.parentElement.tagName.toLowerCase()}${[...e.parentElement.classList].slice(0, 2).map((c) => '.' + c).join('')}`;
      const key = `${sel} 글자=${m.color} 배경=rgb(${m.bg.join(', ')})`;
      const g = groups.get(key) || { n: 0, ratio: m.ratio, text: e.textContent.trim().slice(0, 14) };
      g.n++;
      groups.set(key, g);
    });
    return [...groups].map(([k, g]) => `${g.ratio.toFixed(2)}:1 ×${g.n} ${k} "${g.text}"`);
  });
}

// 보이는 요소 중 계산된 배경이 밝은 것(사진·영상·iframe 제외)을 면적 큰 순으로 돌려준다.
export function whiteElements(page, limit = 12) {
  return page.evaluate((limit) => {
    const out = [];
    for (const e of document.querySelectorAll('body *')) {
      if (e.closest('img, video, canvas, iframe, svg, .media-partnership, .partner-list')) continue; // 협력사 로고 칸은 일부러 흰 바탕 유지
      const cs = getComputedStyle(e);
      const m = (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (m.length < 3 || (m[3] !== undefined && m[3] < 0.5)) continue;
      const L = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
      if (L < 0.7) continue;
      const r = e.getBoundingClientRect();
      if (r.width * r.height < 1500 || cs.visibility === 'hidden') continue;
      const path = [];
      for (let x = e; x && x !== document.body && path.length < 3; x = x.parentElement) path.unshift(`${x.tagName.toLowerCase()}${x.id ? '#' + x.id : ''}${[...x.classList].slice(0, 2).map((c) => '.' + c).join('')}`);
      out.push({ area: Math.round(r.width * r.height), size: `${Math.round(r.width)}x${Math.round(r.height)}`, bg: cs.backgroundColor, sel: path.join(' > ') });
    }
    // 가상 요소(::before/::after)로 깐 밝은 띠도 본다(크기는 계산된 너비·높이로)
    for (const e of document.querySelectorAll('body *')) {
      for (const ps of ['::before', '::after']) {
        const cs = getComputedStyle(e, ps);
        if (cs.content === 'none' || cs.display === 'none') continue;
        const m = (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
        if (m.length < 3 || (m[3] !== undefined && m[3] < 0.5)) continue;
        if ((0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.7) continue;
        const area = (parseFloat(cs.width) || 0) * (parseFloat(cs.height) || 0);
        if (area < 1500 || !e.getClientRects().length) continue;
        out.push({ area: Math.round(area), size: `${cs.width}x${cs.height}`, bg: cs.backgroundColor, sel: `${e.tagName.toLowerCase()}${[...e.classList].slice(0, 2).map((c) => '.' + c).join('')}${ps}` });
      }
    }
    return out.sort((a, b) => b.area - a.area).slice(0, limit);
  }, limit);
}

// 전체 화면 캡처(PNG)에서 밝은 픽셀(명도 0.75 이상) 비율을 센다. 사진·영상·캔버스·iframe 사각형은 뺀다.
// 그림 해석은 별도 빈 탭의 캔버스로 한다(의존성 추가 없이).
export async function brightRatio(ctx, page, png) {
  const rects = await page.evaluate(() => [...document.querySelectorAll('img, video, canvas, iframe, picture, svg image')]
    .map((e) => e.getBoundingClientRect()).filter((r) => r.width * r.height > 100)
    .map((r) => [r.left + scrollX, r.top + scrollY, r.width, r.height]));
  const tab = await ctx.newPage();
  try {
    return await tab.evaluate(async ({ b64, rects }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      for (const [x, y, w, h] of rects) g.clearRect(x, y, w, h); // 사진 영역은 지워(투명) 세지 않는다
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let bright = 0, total = 0;
      for (let i = 0; i < d.length; i += 16) {
        if (!d[i + 3]) continue;
        total++;
        if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 191) bright++;
      }
      return total ? bright / total : 0;
    }, { b64: png.toString('base64'), rects });
  } finally {
    await tab.close();
  }
}
