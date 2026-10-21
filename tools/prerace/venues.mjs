import fs from 'node:fs';
import path from 'node:path';

export const venues = JSON.parse(fs.readFileSync(new URL('./venues.json', import.meta.url), 'utf8'));
export function venueFor(code = '01') {
  const venue = venues.find(v => v.code === code);
  if (!venue) throw Error('対応する場コード（01〜24）を指定してください');
  return venue;
}
export const raceId = (code, date, raceNo) => `${venueFor(code).slug}_${date.replaceAll('-', '')}_R${raceNo}`;
// Preserve the original Kiryu paths, receipts, and immutable predictions.
export const venueDirectory = (cache, date, code = '01') => code === '01'
  ? path.join(cache, date) : path.join(cache, date, 'venues', venueFor(code).code);

export function validateSourceTarget(source, date, raceNo, venueCode = '01') {
  const url = new URL(source);
  venueFor(venueCode);
  if (url.hostname === 'www.boatrace.jp' && (url.protocol !== 'https:'
    || !['/owpc/pc/race/racelist','/owpc/pc/race/odds3t'].includes(url.pathname)
    || url.searchParams.get('hd') !== date.replaceAll('-', '')
    || url.searchParams.get('jcd') !== venueCode || url.searchParams.get('rno') !== String(raceNo))) {
    throw Error('公式資料のURLと開催日・会場・レース番号が違います');
  }
}
