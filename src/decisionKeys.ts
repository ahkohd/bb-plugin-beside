import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const KEY_SLOTS = ["jev", "custom"] as const;

export type KeySlot = (typeof KEY_SLOTS)[number];

export interface DecisionKeyStore {
  get(slot: KeySlot): string;
  set(slot: KeySlot, value: string | null): void;
}

const storedKeysSchema = z.partialRecord(z.enum(KEY_SLOTS), z.string());

type StoredKeys = z.infer<typeof storedKeysSchema>;

const OWNER_ONLY = 0o600;

function readKeysFile(path: string): StoredKeys {
  try {
    const parsed = storedKeysSchema.safeParse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeKeysFile(path: string, keys: StoredKeys): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(keys), { mode: OWNER_ONLY });
  renameSync(temporary, path);
}

function keyStoreFrom(
  read: () => StoredKeys,
  write: (keys: StoredKeys) => void,
): DecisionKeyStore {
  return {
    get: (slot) => read()[slot]?.trim() ?? "",
    set: (slot, value) => {
      const keys = { ...read() };
      const trimmed = value?.trim() ?? "";
      if (trimmed === "") delete keys[slot];
      else keys[slot] = trimmed;
      write(keys);
    },
  };
}

export function memoryKeyStore(): DecisionKeyStore {
  let keys: StoredKeys = {};
  return keyStoreFrom(
    () => keys,
    (next) => {
      keys = next;
    },
  );
}

export function keyStoreBesideDatabase(
  databasePath: string | undefined,
): DecisionKeyStore {
  if (!databasePath || databasePath === ":memory:") return memoryKeyStore();
  const path = join(dirname(databasePath), "decision-keys.json");
  return keyStoreFrom(
    () => readKeysFile(path),
    (keys) => writeKeysFile(path, keys),
  );
}
