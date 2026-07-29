# Increment 14 — Security & MFA (Phase 17)

Adds real two-factor authentication (TOTP) and a Security settings page. Roles
and audit logs already existed in the backend; this hardens sign-in.

## Backend
- **`src/auth/totp.js`** — dependency-free RFC 6238 TOTP / RFC 4226 HOTP
  (base32, HMAC-SHA1, dynamic truncation), secret generation, `verify` with
  ±1-step drift tolerance, and `otpauth://` provisioning URIs.
- **Unit tests** (`test/totp.test.js`) — validated against the **official RFC 6238
  test vectors**. Backend suite now **18/18**.
- **`routes/auth.js`**: `mfa_enabled` / `mfa_secret` columns (migration `006`),
  `/auth/mfa/setup` (generate secret), `/auth/mfa/enable` (verify + turn on),
  `/auth/mfa/disable` (verify + turn off). `/auth/login` now requires a valid
  TOTP code when MFA is enabled, returning `{ mfa_required: true }` as the challenge.

## Frontend
- **LoginPage** — detects the `mfa_required` challenge and shows a 6-digit code step (auth context uses a raw fetch so the global 401 handler doesn't hijack the challenge).
- **SecurityPage** (`/security`) — enable 2FA (shows the secret + otpauth URI to add to an authenticator, then confirm with a code), disable 2FA (requires a current code), current role, and a roles/permissions reference. Added to the Admin nav group.

## Verification
- Backend 18/18 tests (incl. RFC TOTP vectors); web `tsc --noEmit` clean; `vite build` ~116 kB gzip.

## Not yet done
- Backup/recovery codes, WebAuthn/passkeys, enforced-MFA org policy, and a full audit-log viewer UI (data exists via /audit-log).
