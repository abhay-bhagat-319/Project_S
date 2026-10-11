/**
 * Assertions for the tolerant attendance normaliser.
 *
 * Run with:  npm run check:attendance
 * (Node 22+ strips the TypeScript types; no test framework required.)
 *
 * Every case below is a response envelope the Shiksha attendance endpoint
 * can plausibly return. The first two are the shapes the old implementation
 * turned into "0 present" — i.e. a permanent 0% attendance card.
 */

import { normalizeCourseAttendance } from '../src/utils/attendanceNormalizer.ts';

interface Case {
  name: string;
  response: unknown;
  records: Array<{ date: string; status: string }>;
  expect: { total: number; present: number; status: string };
}

const cases: Case[] = [
  {
    name: 'canonical ok payload',
    response: { status: 'ok', totalClasses: 28, presentClasses: 26, relPresentPercentage: '92.86' },
    records: [{ date: '2026-08-05', status: 'Present' }],
    expect: { total: 28, present: 26, status: 'ok' },
  },
  {
    name: 'status:"success" + numeric counts (previously 0 present)',
    response: { status: 'success', totalClasses: 28, presentClasses: 26 },
    records: [],
    expect: { total: 28, present: 26, status: 'ok' },
  },
  {
    name: 'no status token at all (previously 0 present)',
    response: { totalClasses: 28, presentClasses: 26 },
    records: [],
    expect: { total: 28, present: 26, status: 'ok' },
  },
  {
    name: 'counts serialised as strings',
    response: { status: 'ok', totalClasses: '28', presentClasses: '26' },
    records: [],
    expect: { total: 28, present: 26, status: 'ok' },
  },
  {
    name: 'alternative key names (total/present)',
    response: { total: '30', present: '24' },
    records: [],
    expect: { total: 30, present: 24, status: 'ok' },
  },
  {
    name: 'only percentages + record list (previously 0 present)',
    response: {
      status: 'ok',
      relPresentPercentage: '92.86',
      userAttendanceInfo: [
        { date: '2026-08-05', status: 'Present' },
        { date: '2026-08-07', status: 'Present' },
        { date: '2026-08-12', status: 'Absent' },
      ],
    },
    records: [
      { date: '05-08-2026', status: 'Present' },
      { date: '07-08-2026', status: 'Present' },
      { date: '12-08-2026', status: 'Absent' },
    ],
    expect: { total: 3, present: 2, status: 'ok' },
  },
  {
    name: 'record list empty + short statuses (P/A)',
    response: { status: 'ok', data: [{ date: '2026-08-05', status: 'P' }, { date: '2026-08-06', status: 'A' }] },
    records: [
      { date: '05-08-2026', status: 'P' },
      { date: '06-08-2026', status: 'A' },
    ],
    expect: { total: 2, present: 1, status: 'ok' },
  },
  {
    name: 'server under-counts total vs record list (record list wins)',
    response: { status: 'ok', totalClasses: 2, presentClasses: 2 },
    records: [
      { date: '05-08-2026', status: 'Present' },
      { date: '07-08-2026', status: 'Present' },
      { date: '12-08-2026', status: 'Absent' },
    ],
    expect: { total: 3, present: 2, status: 'ok' },
  },
  {
    name: 'portal answered with a payload carrying nothing useful → empty',
    response: { status: 'ok' },
    records: [],
    expect: { total: 0, present: 0, status: 'empty' },
  },
  {
    name: 'HTML-ish / null payload → error (never a fake 0% card)',
    response: null,
    records: [],
    expect: { total: 0, present: 0, status: 'error' },
  },
];

let failures = 0;

for (const testCase of cases) {
  const result = normalizeCourseAttendance(testCase.response, testCase.records);
  const ok =
    result.status === testCase.expect.status &&
    result.totalClasses === testCase.expect.total &&
    result.presentClasses === testCase.expect.present;

  if (!ok) {
    failures++;
    console.error(`✗ ${testCase.name}`);
    console.error(
      `    expected status=${testCase.expect.status} total=${testCase.expect.total} present=${testCase.expect.present}`
    );
    console.error(`    got      status=${result.status} total=${result.totalClasses} present=${result.presentClasses}`);
  } else {
    console.log(`✓ ${testCase.name}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${cases.length} attendance normaliser checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} attendance normaliser checks passed.`);
