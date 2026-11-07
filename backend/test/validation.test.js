const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBooking } = require('../validation');

const fakeDb = { prepare(sql) { return { get(id) { return id === 2 ? { id: 2 } : null; } }; } };
test('valid booking passes and trims fields', () => {
  const result = validateBooking({ studentName:'  小明 ', phone:'13800000000', courseId:2, note:' hi ' }, fakeDb);
  assert.equal(result.error, undefined);
  assert.equal(result.value.studentName, '小明');
  assert.equal(result.value.note, 'hi');
});
test('invalid phone is rejected', () => {
  assert.match(validateBooking({ studentName:'小明', phone:'123', courseId:2 }, fakeDb).error, /手机号/);
});
test('inactive or unknown course is rejected', () => {
  assert.match(validateBooking({ studentName:'小明', phone:'13800000000', courseId:9 }, fakeDb).error, /课程/);
});
