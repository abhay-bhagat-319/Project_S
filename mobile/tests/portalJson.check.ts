/**
 * Assertions for the portal JSON extraction helpers.
 *
 * Run with:  npm run check:portal
 *
 * The third case is the important one: the pre-Patch-1 lazy regexes
 * (`/(\{[\s\S]*?\})/`, `/initReports\s*\(\s*(\[.*?\])\s*\)/s`) truncate the
 * payload at a brace/bracket that appears *inside a string value*, which is
 * exactly what a PDF filename or an annotation containing brackets does.
 */

import { extractJsonCall, describePortalPage, decodePortalEntities } from '../src/utils/portalJson.ts';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}`);
    if (detail !== undefined) console.error('    ', detail);
  }
}

// --- extractJsonCall -------------------------------------------------------

// 1. The shape documented in docs/student_report_cards_and_pdf_cache_research.md:
//    server-rendered ng-init inside a double-quoted attribute (quotes escaped as &quot;).
const reportsHtml = `
<body id="layouts-horizontal" ng-app="studentReport"
      ng-init="initReports([{&quot;type&quot;:&quot;Semester Grade Report&quot;,&quot;sem&quot;:&quot;2024-2025-1&quot;,&quot;annotation&quot;:&quot;Semester Grade Report for 2024-2025-1&quot;,&quot;file&quot;:&quot;https://shiksha.iiserb.ac.in/reports/students/04km/SGR-24401-2024-2025-1-e9ef0c34.pdf&quot;,&quot;show&quot;:true},{&quot;type&quot;:&quot;Cumulative Grade Report&quot;,&quot;sem&quot;:&quot;2025-2026-3&quot;,&quot;annotation&quot;:&quot;Cumulative Grade Report upto 2025-2026-3&quot;,&quot;file&quot;:&quot;/reports/students/04km/CGR.pdf&quot;,&quot;show&quot;:true}])">
`;
const reports = extractJsonCall(reportsHtml, 'initReports');
check(
  'initReports: &quot;-escaped array inside a double-quoted attribute',
  Array.isArray(reports) && (reports as any[]).length === 2 && (reports as any[])[1].sem === '2025-2026-3',
  reports
);

// 2. Single-quoted attribute with raw JSON (the other observed ng-init style).
const profileRaw = {
  name: 'Abhay',
  roll: '24401',
  acadIISER: { major: 'BIO' },
  current: { passedCourses: ['BIO101'], failedCourses: [] },
  performance: [{ sem: '2024-2025-1', spi: 8.2, cpi: 8.1 }],
};
const profileHtml = `<body ng-init='initProfileInfo(${JSON.stringify(profileRaw)})'>`;
const profile = extractJsonCall(profileHtml, 'initProfileInfo');
check(
  'initProfileInfo: raw JSON object in a single-quoted attribute',
  !!profile && (profile as any).roll === '24401' && (profile as any).acadIISER.major === 'BIO',
  profile
);

// 3. THE REGRESSION CASE: a closing bracket/brace inside a string value.
//    Lazy regexes stop here and produce invalid JSON.
const trickyHtml = `<body ng-init='initReports([{"type":"Transcript [final]","sem":"2024-2025-2","file":"https://shiksha.iiserb.ac.in/reports/students/04km/T-{v2}-24401.pdf","annotation":"Cumulative report } upto 2025","show":true}])'>`;
const tricky = extractJsonCall(trickyHtml, 'initReports');
check(
  'initReports: braces/brackets inside string values do not truncate the payload',
  Array.isArray(tricky) &&
    (tricky as any[]).length === 1 &&
    (tricky as any[])[0].file.includes('{v2}') &&
    (tricky as any[])[0].annotation.includes('}'),
  tricky
);

// 4. Quoted string argument: initProfileInfo('...json...')
const quotedHtml = `<body ng-init="initProfileInfo('${JSON.stringify(profileRaw).replace(/"/g, '&quot;')}')">`;
const quoted = extractJsonCall(quotedHtml, 'initProfileInfo');
check('initProfileInfo: quoted, entity-escaped string argument', !!quoted && (quoted as any).name === 'Abhay', quoted);

// 5. Absent call → null (caller falls back to other strategies).
check('absent call returns null', extractJsonCall('<html><body>no payload</body></html>', 'initReports') === null);

// 6. Malformed payload → null rather than throwing.
check('malformed payload returns null', extractJsonCall('initReports([{"a":1,])', 'initReports') === null);

// 7. A *different* function must not be matched by a prefix.
check(
  'prefix of another function name is not mis-matched',
  extractJsonCall('doInitReportsX([1,2,3])', 'initReports') === null
);

// 8. Nested arrays/objects with escaped quotes inside strings.
const nested = `initReports([{"a":{"b":[{"c":"quote \\" here"}]}}])`;
const nestedResult = extractJsonCall(nested, 'initReports');
check(
  'nested structures with escaped quotes parse correctly',
  Array.isArray(nestedResult) && (nestedResult as any)[0].a.b[0].c === 'quote " here',
  nestedResult
);

// --- entity decoding -------------------------------------------------------

check(
  'decodePortalEntities handles the entity set the portal emits',
  decodePortalEntities('&quot;a&quot; &amp; &#39;b&#39; &lt;c&gt;') === `"a" & 'b' <c>`
);

// --- page fingerprint ------------------------------------------------------

const loginFp = describePortalPage('<form action="/ldap_login_progress"><input name="secret"></form>', 'https://x/login/');
check('fingerprint flags a login redirect', loginFp.includes('login=y'), loginFp);

const emptyTableFp = describePortalPage('<table id="dataTable" class="mdl-data-table"><tbody></tbody></table>');
check(
  'fingerprint distinguishes a rendered-but-empty table (Angular-injected shape)',
  emptyTableFp.includes('dataTable=y') && emptyTableFp.includes('tbodyTr=0'),
  emptyTableFp
);

const serverRenderedFp = describePortalPage(
  '<table id="dataTable"><tbody><tr><td>BIO301</td></tr><tr><td>CHM302</td></tr></tbody></table>'
);
check(
  'fingerprint counts server-rendered rows',
  serverRenderedFp.includes('tbodyTr=2'),
  serverRenderedFp
);

const angularedFp = describePortalPage(
  '<table id="dataTable"><tbody><tr ng-repeat="c in myCourses"><td>{{c.code}}</td></tr></tbody></table>'
);
check(
  'fingerprint flags ng-repeat templates and embedded course keys',
  angularedFp.includes('ngRepeat=y'),
  angularedFp
);

if (failures > 0) {
  console.error(`\n${failures} portal JSON check(s) failed.`);
  process.exit(1);
}

console.log('\nAll portal JSON checks passed.');
