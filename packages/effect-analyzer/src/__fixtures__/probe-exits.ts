/**
 * Fixture: a module that calls `process.exit` while initializing, so the probe
 * gets no output at all rather than a result.
 */
process.exit(3);
