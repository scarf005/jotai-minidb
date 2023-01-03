import { atom, createStore } from "jotai/vanilla";
import { it, expect, vi, beforeEach, describe } from "vitest";
import "fake-indexeddb/auto";

import { entries } from "idb-keyval";
import { MiniDb } from "./jotai-minidb";

class BCMock {
  static instances: BCMock[] = [];
  static reset() {
    this.instances = [];
  }

  constructor(protected name: string) {
    BCMock.instances.push(this);
  }
  onmessage = (event: MessageEvent) => {};
  postMessage = (data: any) => {
    for (const instance of BCMock.instances) {
      if (instance !== this && instance.name === this.name) {
        instance.onmessage(new MessageEvent("data", { data }));
      }
    }
  };
}

vi.stubGlobal("BroadcastChannel", BCMock);

async function setup() {
  const db = new MiniDb();
  const db2 = new MiniDb();
  const store = createStore();
  await store.get(db.suspendBeforeInit);
  await store.get(db2.suspendBeforeInit);
  return { db, db2, store };
}

beforeEach(() => {
  BCMock.reset();
});

it("Initialize with empty list", async () => {
  const { db, store } = await setup();
  expect(store.get(db.keys)).toEqual([]);
  expect(store.get(db.values)).toEqual([]);
  expect(store.get(db.entries)).toEqual([]);
});

it("Set", async () => {
  const { db, db2, store } = await setup();

  await store.set(db.item("test-id"), "new value");
  expect(store.get(db.keys)).toEqual(["test-id"]);
  expect(store.get(db.values)).toEqual(["new value"]);
  expect(store.get(db.entries)).toEqual([["test-id", "new value"]]);

  expect(store.get(db2.entries)).toEqual([["test-id", "new value"]]);
  expect(await entries(db["idbStorage"])).toEqual([["test-id", "new value"]]);
});

it("Delete", async () => {
  const { db, db2, store } = await setup();
  expect(store.get(db.entries)).toEqual([["test-id", "new value"]]);
  expect(store.get(db2.entries)).toEqual([["test-id", "new value"]]);
  expect(await entries(db["idbStorage"])).toEqual([["test-id", "new value"]]);

  await store.set(db.delete, "test-id");
  expect(store.get(db.entries)).toEqual([]);
  expect(store.get(db2.entries)).toEqual([]);
  expect(await entries(db["idbStorage"])).toEqual([]);
});

describe("With custom db name", () => {
  async function setupMany() {
    const db1 = new MiniDb({ name: "a" });
    const db2 = new MiniDb({ name: "b" });
    const store = createStore();
    await store.get(db1.suspendBeforeInit);
    await store.get(db2.suspendBeforeInit);
    return { db1, db2, store };
  }

  it("Set", async () => {
    const { db1, db2, store } = await setupMany();

    await store.set(db1.item("123"), "new value");
    expect(store.get(db1.entries)).toEqual([["123", "new value"]]);
    expect(store.get(db2.entries)).toEqual([]);
  });

  it("Delete", async () => {
    const { db1, db2, store } = await setupMany();
    expect(store.get(db1.entries)).toEqual([["123", "new value"]]);
    expect(store.get(db2.entries)).toEqual([]);

    await store.set(db2.item("123"), "db2 value");
    expect(store.get(db1.entries)).toEqual([["123", "new value"]]);
    expect(store.get(db2.entries)).toEqual([["123", "db2 value"]]);

    await store.set(db1.delete, "123");
    expect(store.get(db1.entries)).toEqual([]);
    expect(store.get(db2.entries)).toEqual([["123", "db2 value"]]);
  });
});

describe("Migrations", () => {
  it("Migrates to a new version", async () => {
    const store = createStore();
    const db1 = new MiniDb({ name: "mydb" });
    await store.get(db1.suspendBeforeInit);
    await store.set(db1.item("123"), { name: "hello" });

    const migratedDb = new MiniDb({
      name: "mydb",
      version: 2,
      migrations: {
        1: (item) => {
          item.value = "other prop";
          return item;
        },
        2: async (item) => {
          item.name += await Promise.resolve(" migrated");
          return item;
        },
      },
    });
    await store.get(migratedDb.suspendBeforeInit);

    expect(store.get(migratedDb.entries)).toEqual([
      ["123", { name: "hello migrated", value: "other prop" }],
    ]);
  });

  it("Do not migrate already migrated", async () => {
    const store = createStore();
    const db1 = new MiniDb({ name: "mydb2" });
    await store.get(db1.suspendBeforeInit);
    await store.set(db1.item("123"), { name: "" });

    // Bump version
    const bumpVersionDb = new MiniDb({
      name: "mydb2",
      version: 1,
      migrations: {
        1: (item) => item,
      },
    });
    await store.get(bumpVersionDb.suspendBeforeInit);

    // Migrate
    const migratedDb = new MiniDb({
      name: "mydb2",
      version: 2,
      migrations: {
        1: (item) => {
          item.name += "migrated to 1";
          return item;
        },
        2: (item) => {
          item.name += "migrated to 2";
          return item;
        },
      },
    });
    await store.get(migratedDb.suspendBeforeInit);

    expect(store.get(migratedDb.entries)).toEqual([
      ["123", { name: "migrated to 2" }],
    ]);
  });
});
