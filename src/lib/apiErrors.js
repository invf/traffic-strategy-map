// AUTH-003B - shared HTTP-status -> translation-key mapping, used by
// both services/strategies.js and the OpenAI call path
// (src/services/openai.js's callers): both backend endpoints can fail
// the same few authenticated-request ways (expired session, access
// denied, quota exhausted, feature disabled), and should say so with
// the same wording rather than each inventing its own.
export function errorKeyForStatus(status) {
  if (status === 401) return 'cloud_error_401';
  if (status === 403) return 'cloud_error_403';
  if (status === 429) return 'cloud_error_429';
  if (status === 503) return 'cloud_error_503';
  return null;
}
