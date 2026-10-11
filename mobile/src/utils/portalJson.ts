/**
 * Extraction helpers for JSON payloads embedded in Shiksha's server-rendered HTML.
 *
 * The portal embeds data in AngularJS `ng-init` attributes, e.g.
 *
 *   <body ng-app="studentReport"
 *         ng-init='initReports([{"type":"Semester Grade Report","sem":"2024-2025-1",
 *                                "file":"https://shiksha.iiserb.ac.in/reports/...pdf","show":true}])'>
 *
 * and inside double-quoted attributes the JSON quotes arrive as `&quot;`.
 *
 * The previous implementation used lazy regexes such as
 * `/(\{[\s\S]*?\})/` and `/initReports\s*\(\s*(\[.*?\])\s*\)/s`. Those stop at
 * the first closing brace/bracket *anywhere* — including one inside a string
 * value (a filename, an annotation, a course title) — which silently produces
 * a truncated payload and a parse failure. That is one plausible cause of
 * "profile sometimes works, sometimes doesn't".
 *
 * A single-pass bracket scanner with string/escape tracking handles all of the
 * observed quoting styles, nesting depths and entity encodings. It is pure and
 * therefore unit-testable (see tests/portalJson.check.ts).
 */

/** Decodes the HTML entities the portal mixes into embedded JSON. */
export function decodePortalEntities(input: string): string {
  return input
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/**
 * Extracts and parses the JSON argument of a JS call such as
 * `initProfileInfo({...})` or `initReports([...])`.
 *
 * Tolerates: optional whitespace, single/double quotes around the argument,
 * HTML entities, nested objects/arrays, and braces inside string values.
 * Returns null when the call is absent or the payload is not valid JSON —
 * callers decide whether to fall back to other strategies.
 */
export function extractJsonCall(source: string, fnName: string): unknown | null {
  if (!source || !fnName) return null;

  const callIndex = source.indexOf(fnName);
  if (callIndex === -1) return null;

  // Find the opening parenthesis of the call (allow whitespace).
  let cursor = callIndex + fnName.length;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
  if (source[cursor] !== '(') return null;
  cursor++;

  // Skip whitespace and any wrapping quote / quote-entity.
  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    const rest = source.slice(cursor, cursor + 6);
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor++;
    } else if (/^&quot;/i.test(rest)) {
      cursor += 6;
    } else if (/^&#34;/i.test(rest)) {
      cursor += 5;
    } else if (/^&#39;/i.test(rest) || /^&apos;/i.test(rest)) {
      cursor += 5;
    } else {
      break;
    }
  }

  // The payload must start with an object or array literal.
  while (cursor < source.length && source[cursor] !== '{' && source[cursor] !== '[') {
    const ch = source[cursor];
    // Anything other than whitespace/quote noise before the literal means this
    // is a different call signature → give up.
    if (!/\s/.test(ch) && ch !== '"' && ch !== "'" && ch !== '&' && ch !== '#' && ch !== ';') {
      return null;
    }
    cursor++;
  }
  if (cursor >= source.length) return null;

  const open = source[cursor];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = cursor; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        const raw = source.slice(cursor, i + 1);
        // Entities may appear *inside* the literal (escaped quotes in a
        // double-quoted attribute), so decode before parsing.
        const candidates = [raw, decodePortalEntities(raw)];
        for (const candidate of candidates) {
          try {
            return JSON.parse(candidate);
          } catch {
            // try the next candidate
          }
        }
        // JSON.parse can still fail on e.g. newlines inside strings: normalise
        // control characters and retry once.
        for (const candidate of candidates) {
          try {
            return JSON.parse(candidate.replace(/[\u0000-\u001f]/g, ' '));
          } catch {
            // fall through
          }
        }
        return null;
      }
    }
  }

  return null;
}

/**
 * Structural fingerprint of a portal HTML response.
 *
 * This exists so that a single line of the in-app diagnostics log is enough to
 * tell whether a page was server-rendered, Angular-injected, a login redirect,
 * or an outright error page — the exact question that decides whether the
 * courses/attendance parsers are reading the right document.
 */
export function describePortalPage(html: string, finalUrl?: string): string {
  const source = html || '';
  const bytes = source.length;
  const hasDataTable = /id=["']dataTable["']/i.test(source);
  const rowCount = (source.match(/<tr[\s>]/gi) || []).length;
  const tbodyRowCount = (source.match(/<tbody[\s\S]*?<\/tbody>/gi) || []).reduce(
    (sum, block) => sum + (block.match(/<tr[\s>]/gi) || []).length,
    0
  );
  const hasNgRepeat = /ng-repeat\s*=/i.test(source);
  const hasNgApp = /ng-app\s*=/i.test(source);
  const isLoginPage =
    /name=["']secret["']/i.test(source) ||
    /ldap_login_progress/i.test(source) ||
    /Please\s+Login/i.test(source);
  const courseJsonKeys = (source.match(/"[Cc]ourse\s?(Code|Number|Title)"/g) || []).length;
  const reportHits = (source.match(/initReports\s*\(/g) || []).length;
  const profileHits = (source.match(/initProfileInfo\s*\(/g) || []).length;
  const path = finalUrl ? finalUrl.replace(/^https?:\/\/[^/]+/i, '') : '';

  return [
    `bytes=${bytes}`,
    `dataTable=${hasDataTable ? 'y' : 'n'}`,
    `tr=${rowCount}`,
    `tbodyTr=${tbodyRowCount}`,
    `ngRepeat=${hasNgRepeat ? 'y' : 'n'}`,
    `ngApp=${hasNgApp ? 'y' : 'n'}`,
    `login=${isLoginPage ? 'y' : 'n'}`,
    `courseKeys=${courseJsonKeys}`,
    `initReports=${reportHits}`,
    `initProfile=${profileHits}`,
    path ? `url=${path}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
