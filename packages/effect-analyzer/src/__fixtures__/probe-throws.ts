/**
 * Fixture: a module that throws while initializing. The runner reports this as
 * a failed probe rather than crashing.
 */
throw new Error('module initialization blew up');
