// 모드('auto'|'on'|'off')와 시스템 다크 여부로 다크 적용 여부를 정한다. 모르는 값은 auto로 본다.
function resolveDark(mode, systemPrefersDark) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return Boolean(systemPrefersDark);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { resolveDark };
