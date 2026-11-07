const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('小程序 JavaScript 与 JSON 配置均可解析', () => {
  const files = walk(path.join(root, 'miniprogram'));
  const scripts = files.filter(file => file.endsWith('.js'));
  const configs = files.filter(file => file.endsWith('.json'));
  assert.ok(scripts.length > 0, '应找到小程序脚本');
  assert.ok(configs.length > 0, '应找到小程序 JSON 配置');
  for (const file of scripts) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }), file);
  }
  for (const file of configs) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')), file);
  }
});

test('管理后台内嵌 JavaScript 可解析', () => {
  const file = path.join(root, 'backend/admin/management.html');
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)];
  assert.ok(scripts.length > 0, '管理后台应包含脚本');
  for (const match of scripts) {
    assert.doesNotThrow(() => new vm.Script(match[1], { filename: file }), file);
  }
});
