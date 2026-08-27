/**
 * Fixture: a module whose top-level code never finishes. Probing it must time
 * out and kill the child, not hang the analyzer.
 *
 * When `PROBE_HEARTBEAT_FILE` is set it also records that it is still alive,
 * synchronously — the spin below blocks the event loop, so nothing async would
 * ever run. That is what lets a test tell a probe that merely *reported* a
 * timeout from one that actually killed the target: `tsx` re-spawns node to
 * install its loaders, so this module runs as a grandchild of the process the
 * analyzer spawned, and killing only the direct child leaves it spinning here.
 */
import { appendFileSync } from 'node:fs';

const heartbeat = process.env['PROBE_HEARTBEAT_FILE'];

// oxlint-disable-next-line no-constant-condition
while (true) {
  if (heartbeat !== undefined) appendFileSync(heartbeat, '.');
  // Block the event loop the way a real runaway module initializer does, while
  // still pacing the heartbeat so the file does not grow without bound.
  const until = Date.now() + 50;
  while (Date.now() < until) {
    /* spin */
  }
}
