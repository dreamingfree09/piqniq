/** Refuse destructive test execution without an explicitly acknowledged local DB. */
function resolveTestMongoUri(env = process.env) {
  const uri = env.MONGODB_URI_TEST;
  const match = /^mongodb:\/\/(127\.0\.0\.1|localhost):([1-9]\d{0,4})\/(piqniq-[a-z0-9_-]*test-[a-z0-9_-]+)$/.exec(String(uri || ''));
  if (!match || Number(match[2]) > 65535 || env.PIQNIQ_TEST_DB_ACK !== match[3]) {
    throw new Error('Tests require an explicit loopback MONGODB_URI_TEST with a unique piqniq-*-test-* database and matching PIQNIQ_TEST_DB_ACK. No database was selected.');
  }
  return uri;
}
module.exports = { resolveTestMongoUri };
