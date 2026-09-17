/**
 * One source of truth for the macOS release-signing boundary.
 *
 * Local/dev packaging may stay ad-hoc so contributors can build without Apple credentials.
 * Public release packaging sets COS_REQUIRE_MACOS_SIGNING=1 and must fail before electron-builder
 * runs unless both the Developer ID certificate and notarization credentials are present.
 */

export const MACOS_RELEASE_SIGNING_FLAG = 'COS_REQUIRE_MACOS_SIGNING';

export function macOSReleaseSigningRequired(env = process.env) {
  return env[MACOS_RELEASE_SIGNING_FLAG] === '1';
}

export function assertMacOSReleaseSigningEnvironment(env = process.env) {
  if (!macOSReleaseSigningRequired(env)) return null;

  const hasImportedCertificate = String(env.CSC_LINK ?? '').trim() && String(env.CSC_KEY_PASSWORD ?? '').trim();
  const hasKeychainIdentity = String(env.CSC_NAME ?? '').trim();
  if (!hasImportedCertificate && !hasKeychainIdentity) {
    throw new Error(
      'macOS release signing is required but neither CSC_LINK + CSC_KEY_PASSWORD nor CSC_NAME is configured. ' +
        'Public macOS artifacts must not fall back to ad-hoc signing.'
    );
  }

  const api = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  const complete = (names) => names.every((name) => String(env[name] ?? '').trim());
  const any = (names) => names.some((name) => String(env[name] ?? '').trim());
  const keychain = ['APPLE_KEYCHAIN_PROFILE'];
  const mode = complete(api) ? 'api-key' : complete(appleId) ? 'apple-id' : complete(keychain) ? 'keychain-profile' : null;
  if (!mode) {
    const attempted = any(api) ? api : any(appleId) ? appleId : keychain;
    const missing = attempted.filter((name) => !String(env[name] ?? '').trim());
    throw new Error(
      `macOS notarization is required but these credentials are missing: ${missing.join(', ')}. ` +
        'Configure the App Store Connect API-key triplet, Apple-ID triplet, or an Apple keychain profile.'
    );
  }

  return {
    mode,
    teamId: mode === 'apple-id' ? String(env.APPLE_TEAM_ID).trim() : null
  };
}
