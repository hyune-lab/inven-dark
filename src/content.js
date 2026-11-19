// 문서 시작 시점에 <html>의 data-inven-dark를 정한다. resolveDark는 mode.js가 먼저 들여온다.
(() => {
  const MIRROR_KEY = 'inven-dark-mode';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'auto';

  try {
    mode = localStorage.getItem(MIRROR_KEY) || 'auto';
  } catch (e) {
    // 저장소가 막힌 환경이면 자동으로 둔다.
  }

  function apply() {
    document.documentElement.setAttribute('data-inven-dark', resolveDark(mode, media.matches) ? 'on' : 'off');
  }

  function setMode(next) {
    mode = next || 'auto';
    try {
      localStorage.setItem(MIRROR_KEY, mode);
    } catch (e) {
      // 미러 저장 실패는 다음 번 번쩍임만 생길 뿐이라 무시한다.
    }
    apply();
  }

  apply();
  chrome.storage.sync.get('mode', (items) => setMode(items && items.mode));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.mode) setMode(changes.mode.newValue);
  });
  media.addEventListener('change', apply);
})();
