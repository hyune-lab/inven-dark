const test = require('node:test');
const assert = require('node:assert');
const { resolveDark } = require('../src/mode.js');

test('켜기는 시스템 설정과 상관없이 다크', () => {
  assert.strictEqual(resolveDark('on', false), true);
  assert.strictEqual(resolveDark('on', true), true);
});

test('끄기는 시스템 설정과 상관없이 밝게', () => {
  assert.strictEqual(resolveDark('off', false), false);
  assert.strictEqual(resolveDark('off', true), false);
});

test('자동은 시스템 설정을 따른다', () => {
  assert.strictEqual(resolveDark('auto', true), true);
  assert.strictEqual(resolveDark('auto', false), false);
});

test('잘못된 값은 자동으로 취급한다', () => {
  for (const bad of [undefined, null, '', 'ON', 'dark', 1, {}]) {
    assert.strictEqual(resolveDark(bad, true), true);
    assert.strictEqual(resolveDark(bad, false), false);
  }
});
