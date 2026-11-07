const test=require('node:test');
const assert=require('node:assert/strict');
const {localToUtc,utcToLocalDate}=require('../domain/time');

test('weekly lesson time remains 6pm Chicago across daylight saving transition',()=>{
  assert.equal(localToUtc('2026-03-02','18:00'),'2026-03-03T00:00:00.000Z');
  assert.equal(localToUtc('2026-03-09','18:00'),'2026-03-09T23:00:00.000Z');
  assert.equal(utcToLocalDate('2026-03-09T23:00:00.000Z'),'2026-03-09');
});

test('rejects nonexistent Chicago wall time during spring DST jump',()=>{
  assert.throws(()=>localToUtc('2026-03-08','02:30'),/夏令时/);
});

test('converts ordinary Chicago winter wall time to UTC',()=>{
  assert.equal(localToUtc('2026-01-15','18:30'),'2026-01-16T00:30:00.000Z');
});
