const radios = document.querySelectorAll('input[name="mode"]');
const VALID = ['auto', 'on', 'off'];

chrome.storage.sync.get('mode', (items) => {
  const mode = VALID.includes(items.mode) ? items.mode : 'auto';
  document.querySelector(`input[value="${mode}"]`).checked = true;
});

for (const radio of radios) {
  radio.addEventListener('change', () => chrome.storage.sync.set({ mode: radio.value }));
}
