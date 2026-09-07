// The two places raw session journals are demoted, in one file so the
// compounding is visible. Keyword search scales a session's BM25 score by
// SESSION_KEYWORD_BOOST; fusion then scales its RRF score by
// SESSION_FUSION_WEIGHT. Both apply on a hybrid query, which is deliberate: the
// committed eval scorecards were calibrated with both in place, and sessions
// still surface when they are the only match. Change one, re-run the eval.

export const SESSION_KEYWORD_BOOST = 0.3;
export const SESSION_FUSION_WEIGHT = 0.7;

/** Synthesised digests stay prominent as they age past the recency window. */
export const DIGEST_KEYWORD_BOOST = 1.5;
