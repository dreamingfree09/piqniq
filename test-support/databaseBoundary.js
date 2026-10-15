// Runs before any test module can import the application or delete collections.
const { resolveTestMongoUri } = require('../config/testDatabase');
process.env.MONGODB_URI = resolveTestMongoUri();
require('./loopbackBoundary');
