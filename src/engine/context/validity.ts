// Validity metadata on curated notes, rendered wherever a note is placed in
// front of a model. A note says when it was last reviewed, when it is due, and
// whether something newer replaces it, so a stale note announces itself instead
// of being served with unchanged confidence.
//
// Frontmatter keys (all optional): `last_reviewed`, `valid_from`, `review_by`,
// `superseded_by` (a note name or path). Dates may be bare YAML dates (parsed
// as Date objects) or quoted strings; both vaults in use differ on this.

import { coerceDate } from "../lifecycle/brief-staleness.js";

export interface ValidityInfo {
  lastReviewed?: string;
  validFrom?: string;
  reviewBy?: string;
  /** review_by is in the past. */
  overdue?: boolean;
  supersededBy?: string;
}

const DAY_MS = 86_400_000;

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function readValidity(fm: Record<string, unknown>, now: Date = new Date()): ValidityInfo {
  const out: ValidityInfo = {};
  const lr = coerceDate(fm.last_reviewed);
  if (lr) out.lastReviewed = day(lr);
  const vf = coerceDate(fm.valid_from);
  if (vf) out.validFrom = day(vf);
  const rb = coerceDate(fm.review_by);
  if (rb) {
    out.reviewBy = day(rb);
    out.overdue = rb.getTime() < now.getTime();
  }
  const sb = fm.superseded_by;
  if (typeof sb === "string" && sb.trim()) out.supersededBy = sb.trim().replace(/^\[\[|\]\]$/g, "");
  return out;
}

/** One line for the model, or null when the note carries no validity fields. */
export function validityLine(fm: Record<string, unknown>, now: Date = new Date()): string | null {
  const v = readValidity(fm, now);
  const parts: string[] = [];
  if (v.supersededBy) parts.push(`Superseded by [[${v.supersededBy}]]; read that instead.`);
  if (v.validFrom) parts.push(`Valid from ${v.validFrom}.`);
  if (v.lastReviewed) parts.push(`Last reviewed ${v.lastReviewed}.`);
  if (v.reviewBy) {
    if (v.overdue) {
      const days = Math.floor((now.getTime() - Date.parse(v.reviewBy)) / DAY_MS);
      parts.push(`Review was due ${v.reviewBy} (${days} days overdue); treat details as possibly stale.`);
    } else {
      parts.push(`Review due ${v.reviewBy}.`);
    }
  }
  return parts.length ? parts.join(" ") : null;
}
