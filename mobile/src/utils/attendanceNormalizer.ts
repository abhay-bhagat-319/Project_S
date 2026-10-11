/**
 * Tolerant normaliser for the Shiksha attendance endpoint
 * (`POST /secure/studentMyCourseAttendance`).
 *
 * Why this is a separate, dependency-free module:
 *  - The endpoint's envelope has been observed in several shapes (a `status`
 *    token that is sometimes `ok` and sometimes absent, counts as numbers or
 *    strings, and responses that only carry `relPresentPercentage` plus the
 *    day-by-day record list).
 *  - The previous implementation required `status === 'ok'` and read
 *    `presentClasses` with `?? 0`. Anything else silently produced
 *    "0 present of N total", i.e. a permanent 0% red card, which is a display
 *    bug rather than data.
 *  - Being pure means it can be exercised directly by tests
 *    (`tests/attendanceNormalizer.check.ts`).
 */

export interface NormalizedAttendanceRecord {
  date: string;
  status: string;
}

export interface NormalizedCourseAttendance {
  status: 'ok' | 'empty' | 'error';
  totalClasses: number;
  presentClasses: number;
  relPresentPercentage?: string;
  /** Present count derived from the record list (ground truth when available). */
  derivedPresent: number;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** A record counts as "present" when its status starts with P / contains PRESENT. */
export function isPresentStatus(status: string | undefined): boolean {
  const normalised = (status || '').trim().toUpperCase();
  return normalised.startsWith('P') || normalised.includes('PRESENT');
}

export function normalizeCourseAttendance(
  resJson: unknown,
  records: NormalizedAttendanceRecord[]
): NormalizedCourseAttendance {
  const derivedPresent = records.filter((r) => isPresentStatus(r.status)).length;

  if (!resJson || typeof resJson !== 'object') {
    return {
      status: records.length > 0 ? 'ok' : 'error',
      totalClasses: records.length,
      presentClasses: derivedPresent,
      derivedPresent,
    };
  }

  const raw = resJson as Record<string, unknown>;

  let total = asNumber(raw.totalClasses) ?? asNumber(raw.total);
  let present = asNumber(raw.presentClasses) ?? asNumber(raw.present);
  const relPresentPercentage = asString(raw.relPresentPercentage);

  // The record list is the most trustworthy source when present.
  if (records.length > 0) {
    total = Math.max(total ?? 0, records.length);
    if (present === undefined) present = derivedPresent;
  }

  // Nothing countable anywhere: the portal answered, but not with attendance.
  if (total === undefined && present === undefined && records.length === 0 && relPresentPercentage === undefined) {
    return { status: 'empty', totalClasses: 0, presentClasses: 0, derivedPresent };
  }

  // Only a relative percentage (e.g. "92.86") was returned — surface it for
  // display without inventing counts.
  if (total === undefined && present === undefined) {
    return {
      status: 'ok',
      totalClasses: 0,
      presentClasses: 0,
      relPresentPercentage,
      derivedPresent,
    };
  }

  return {
    status: 'ok',
    totalClasses: total ?? records.length,
    presentClasses: present ?? derivedPresent,
    relPresentPercentage,
    derivedPresent,
  };
}
