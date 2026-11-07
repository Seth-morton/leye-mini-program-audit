const test = require('node:test');
const assert = require('node:assert/strict');
const { balanceForLot, consumePlan, refundCap } = require('../domain/ledger');

test('赠送课时优先消耗', () => {
  const rows = [
    { id: 1, transaction_type: 'grant_paid', quantity: 10 },
    { id: 2, transaction_type: 'grant_bonus', quantity: 2 }
  ];
  assert.deepEqual(consumePlan(rows, 3), { bonus: 2, paid: 1 });
});

test('课时不足时拒绝消课', () => {
  const rows = [{ id: 1, transaction_type: 'grant_paid', quantity: 1 }];
  assert.throws(() => consumePlan(rows, 2), /不足/);
});

test('余额由流水汇总计算', () => {
  const rows = [
    { id: 1, transaction_type: 'grant_paid', quantity: 10 },
    { id: 2, transaction_type: 'grant_bonus', quantity: 2 },
    { id: 3, transaction_type: 'consume_bonus', quantity: 2 },
    { id: 4, transaction_type: 'consume_paid', quantity: 1 }
  ];
  assert.deepEqual(balanceForLot(rows), { paid: 9, bonus: 0 });
});

test('退款不得超过已收款且按未消耗付费课时核算', () => {
  assert.equal(refundCap({ receivedCents: 300000, paidLessons: 10, consumedPaidLessons: 4 }), 180000);
  assert.equal(refundCap({ receivedCents: 10000, paidLessons: 10, consumedPaidLessons: 9 }), 1000);
});
