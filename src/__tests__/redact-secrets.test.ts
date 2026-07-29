import { describe, expect, it } from "vitest";
// @ts-expect-error — the capture hook is plain ESM, outside the TS build.
import { redactSecrets } from "../../hooks/session-journal.mjs";

/**
 * Session notes copy user messages and shell commands verbatim, and the vault
 * auto-commits and can be pushed. On 2026-07-28 a live Neon API key and a
 * production database password were found in committed notes. These cases are
 * the shapes that actually leaked, plus the ones most likely to leak next.
 */
describe("redactSecrets", () => {
  it("redacts a Neon API key", () => {
    const out = redactSecrets(
      "export NEON_API_KEY=napi_000000abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"
    );
    expect(out).not.toMatch(/napi_[A-Za-z0-9]{20,}/);
  });

  it("redacts a Neon role password and the connection string reusing it", () => {
    const out = redactSecrets(
      'PGPASSWORD=npg_REDACTED psql "postgresql://neondb_owner:npg_REDACTED@ep-redacted-host.aws.neon.tech/neondb"'
    );
    expect(out).not.toContain("npg_REDACTED");
    // The host stays — it identifies which branch was touched, and is not secret.
    expect(out).toContain("ep-redacted-host");
  });

  it("redacts credentials embedded in any URL", () => {
    const out = redactSecrets(
      "postgresql://postgres:REDACTED@db.example-host-0001.example.com:5432/postgres"
    );
    expect(out).not.toContain("REDACTED");
  });

  it("redacts full JWTs and truncated fragments alike", () => {
    // A fragment still carries the header/payload and identifies a user.
    for (const jwt of [
      "eyJraWQiOiI5In0.eyJzdWIiOiJhYmMifQ.sig123",
      "REDACTED_JWT_HEADER.eyJzdWIi",
    ]) {
      expect(redactSecrets(jwt)).toBe("[REDACTED_JWT]");
    }
  });

  it("redacts vendor tokens and generic assignments", () => {
    expect(redactSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE")).not.toContain(
      "AKIAIOSFODNN7EXAMPLE"
    );
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).not.toContain(
      "abcdefghijklmnopqrstuvwxyz"
    );
    expect(redactSecrets('{"apiKey": "super-secret-value"}')).not.toContain(
      "super-secret-value"
    );
    expect(redactSecrets("db_password: hunter2hunter2")).not.toContain("hunter2hunter2");
  });

  it("does not eat code examples or documented placeholders", () => {
    // Regressions found while scrubbing the vault: the generic rule matched any
    // identifier ending in "Key", so it mangled `queryKey: [...]` into
    // `queryKey: [REDACTED]...` and redacted placeholders that are not secrets.
    for (const safe of [
      "useQuery({ queryKey: ['rides', riderId, date], queryFn })",
      'export NEON_API_KEY="your-key"',
      "EXPO_PUBLIC_APP_PUBLISHABLE_KEY=... (same as production)",
      "const cacheKey = {a:1}",
      "API_TOKEN=${MY_VAR}",
    ]) {
      expect(redactSecrets(safe)).toBe(safe);
    }
  });

  it("leaves ordinary session content untouched", () => {
    // False positives cost readability in every note, so guard against them.
    for (const safe of [
      "npm run build && git push origin feat/ui-ux-overhaul",
      "rotate the key in the Neon console under Account Settings",
      "postgresql://ep-redacted-host.aws.neon.tech/neondb?sslmode=require",
      "set NEON_DATABASE_URL_SANDBOX before running migrate",
    ]) {
      expect(redactSecrets(safe)).toBe(safe);
    }
  });
});
