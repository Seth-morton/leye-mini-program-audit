const GRANT_TYPES = new Set(['grant_paid', 'grant_bonus']);
const CONSUME_TYPES = new Set(['consume_paid', 'consume_bonus']);

function balanceForLot(rows) {
  return rows.reduce((balance, row) => {
    if (GRANT_TYPES.has(row.transaction_type)) balance[row.transaction_type === 'grant_paid' ? 'paid' : 'bonus'] += row.quantity;
    if (CONSUME_TYPES.has(row.transaction_type)) balance[row.transaction_type === 'consume_paid' ? 'paid' : 'bonus'] -= row.quantity;
    if (row.transaction_type === 'refund_cancel') balance[row.reference_bucket === 'bonus' ? 'bonus' : 'paid'] -= row.quantity;
    if (row.transaction_type === 'reverse') {
      const target = rows.find(item => item.id === row.reference_transaction_id);
      if (target && CONSUME_TYPES.has(target.transaction_type)) balance[target.transaction_type === 'consume_paid' ? 'paid' : 'bonus'] += row.quantity;
      if (target && GRANT_TYPES.has(target.transaction_type)) balance[target.transaction_type === 'grant_paid' ? 'paid' : 'bonus'] -= row.quantity;
    }
    return balance;
  }, { paid: 0, bonus: 0 });
}

function consumePlan(rows, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('消课数量必须是正整数');
  const balance = balanceForLot(rows);
  const available = balance.bonus + balance.paid;
  if (quantity > available) throw new Error('剩余课时不足，不能消课');
  const bonus = Math.min(quantity, balance.bonus);
  return { bonus, paid: quantity - bonus };
}

function refundCap({ receivedCents, paidLessons, consumedPaidLessons, alreadyRefundedCents = 0 }) {
  for (const value of [receivedCents, paidLessons, consumedPaidLessons, alreadyRefundedCents]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('退款核算参数无效');
  }
  const remainingPaid = Math.max(0, paidLessons - consumedPaidLessons);
  const perLesson = paidLessons > 0 ? receivedCents / paidLessons : 0;
  return Math.max(0, Math.min(receivedCents - alreadyRefundedCents, Math.floor(remainingPaid * perLesson)));
}

module.exports = { balanceForLot, consumePlan, refundCap };
