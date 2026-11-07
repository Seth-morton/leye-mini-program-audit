const TIME_ZONE = 'America/Chicago';

function partsAt(date, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function localToUtc(dateText, timeText, timeZone = TIME_ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeText))
    throw new Error('本地日期或时间格式无效');
  const [year,month,day] = dateText.split('-').map(Number);
  const [hour,minute] = timeText.split(':').map(Number);
  const target = Date.UTC(year,month-1,day,hour,minute,0);
  let guess = target;
  for (let i=0;i<6;i++) {
    const p = partsAt(new Date(guess),timeZone);
    const wall = Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
    const delta = target-wall;
    if (!delta) break;
    guess += delta;
  }
  const p = partsAt(new Date(guess),timeZone);
  if (Number(p.year)!==year || Number(p.month)!==month || Number(p.day)!==day || Number(p.hour)!==hour || Number(p.minute)!==minute)
    throw new Error('该本地时间因夏令时切换而不存在，请调整上课时间');
  return new Date(guess).toISOString();
}

function utcToLocalDate(utc, timeZone = TIME_ZONE) {
  const p = partsAt(new Date(utc),timeZone);
  return [p.year,p.month,p.day].join('-');
}

function addLocalDays(dateText, days) {
  const [y,m,d] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(y,m-1,d+days));
  return [date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join('-');
}

function weekdayOf(dateText) {
  const [y,m,d] = dateText.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).getUTCDay();
}

module.exports = { TIME_ZONE, localToUtc, utcToLocalDate, addLocalDays, weekdayOf };
