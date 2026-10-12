import type { Config } from './config.js';
import type { DB } from './db.js';
import type { EventHub } from './events.js';

/** Everything a route handler needs. Passed in explicitly so tests can build isolated apps. */
export interface AppContext {
  db: DB;
  config: Config;
  hub: EventHub;
}
