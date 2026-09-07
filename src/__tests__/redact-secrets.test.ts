import { describe, expect, it } from "vitest";
import { redactSecrets } from "../hooks/session-journal.js";

/**
 * Session notes copy user messages and shell commands verbatim, and the vault
 * auto-commits and can be pushed — so a pasted token or an `export API_KEY=...`
 * line reaches git unless something strips it first. Credentials have leaked
 * this way before; these cases cover the shapes most likely to leak next.
 *
 * Every value below is synthetic. Never paste a fragment of a real credential
 * into a fixture, even a revoked one — fixtures outlive the secrets they came
 * from, and a scrubbing pass that misses one case leaves it published forever.
 */
describe("redactSecrets", () => {
  it("redacts a Neon API key", () => {
    const out = redactSecrets(
      "export NEON_API_KEY=napi_0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(out).not.toMatch(/napi_[A-Za-z0-9]{20,}/);
  });

  it("redacts a Neon role password and the connection string reusing it", () => {
    const out = redactSecrets(
      'PGPASSWORD=npg_synthetic000000 psql "postgresql://neondb_owner:npg_synthetic000000@ep-quiet-meadow-a0000000.aws.neon.tech/neondb"'
    );
    expect(out).not.toContain("npg_synthetic000000");
    // The host stays — it identifies which branch was touched, and is not secret.
    expect(out).toContain("ep-quiet-meadow-a0000000");
  });

  it("redacts credentials embedded in any URL", () => {
    const out = redactSecrets(
      "postgresql://postgres:synthetic0000000@db.example-host-0000.example.com:5432/postgres"
    );
    expect(out).not.toContain("synthetic0000000");
  });

  it("redacts full JWTs and truncated fragments alike", () => {
    // A fragment still carries the header/payload and identifies a user.
    for (const jwt of [
      "eyJraWQiOiI5In0.eyJzdWIiOiJhYmMifQ.sig123",
      "eyJraWQiOiJBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBPSIsImFsZyI6IlJTMjU2In0.eyJzdWIi",
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
    // Regressions found while scrubbing a vault: the generic rule matched any
    // identifier ending in "Key", so it mangled `queryKey: [...]` into
    // `queryKey: [REDACTED]...` and redacted placeholders that are not secrets.
    for (const safe of [
      "useQuery({ queryKey: ['orders', customerId, date], queryFn })",
      'export NEON_API_KEY="your-key"',
      "PUBLIC_APP_PUBLISHABLE_KEY=... (same as production)",
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
      "postgresql://ep-calm-harbor-b0000000.aws.neon.tech/neondb?sslmode=require",
      "set DATABASE_URL_SANDBOX before running migrate",
    ]) {
      expect(redactSecrets(safe)).toBe(safe);
    }
  });
});
