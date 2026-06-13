import { openDb } from "./db/index.js";
import { Store } from "./db/store.js";

/** Open the spear store backed by the default (or given) database file. */
export function openStore(file?: string): Store {
  return new Store(openDb(file));
}
