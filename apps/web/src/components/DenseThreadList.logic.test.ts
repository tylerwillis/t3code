import { describe, expect, it } from "vite-plus/test";

import {
  denseThreadLastActivityAt,
  matchesDenseThreadFilter,
  orderDenseThreads,
  type DenseThreadOrderInput,
} from "./DenseThreadList.logic";

function thread(id: string, overrides: Partial<DenseThreadOrderInput> = {}): DenseThreadOrderInput {
  return {
    id,
    environmentId: "env-a",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    latestUserMessageAt: null,
    latestRun: null,
    pinnedAt: null,
    pinOrderKey: null,
    ...overrides,
  };
}

function run(completedAt: string | null, startedAt: string | null = null) {
  return { requestedAt: startedAt, startedAt, completedAt };
}

describe("denseThreadLastActivityAt", () => {
  it("uses the agent's reply when it is newer than the user's message", () => {
    expect(
      denseThreadLastActivityAt(
        thread("t", {
          latestUserMessageAt: "2026-11-03T10:00:00.000Z",
          latestRun: run("2026-11-03T10:05:00.000Z", "2026-11-03T10:00:01.000Z"),
        }),
      ),
    ).toBe("2026-11-03T10:05:00.000Z");
  });

  it("uses the user's message when it is newer than the last reply", () => {
    expect(
      denseThreadLastActivityAt(
        thread("t", {
          latestUserMessageAt: "2026-11-03T11:00:00.000Z",
          latestRun: run("2026-11-03T10:05:00.000Z"),
        }),
      ),
    ).toBe("2026-11-03T11:00:00.000Z");
  });

  it("ignores updatedAt, which moves on metadata changes like renames", () => {
    expect(
      denseThreadLastActivityAt(
        thread("t", {
          updatedAt: "2026-11-04T00:00:00.000Z",
          latestUserMessageAt: "2026-11-02T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-11-02T00:00:00.000Z");
  });

  it("falls back to createdAt for an empty thread", () => {
    expect(denseThreadLastActivityAt(thread("t"))).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("orderDenseThreads", () => {
  it("puts pinned threads first in pin order, then the rest by last activity", () => {
    const { pinned, rest } = orderDenseThreads([
      thread("old", { latestUserMessageAt: "2026-11-01T01:00:00.000Z" }),
      thread("pin-b", { pinnedAt: "2026-11-02T00:00:00.000Z", pinOrderKey: "b" }),
      thread("new", { latestRun: run("2026-11-03T09:00:00.000Z") }),
      thread("pin-a", { pinnedAt: "2026-11-02T00:00:00.000Z", pinOrderKey: "a" }),
      thread("mid", { latestUserMessageAt: "2026-11-02T12:00:00.000Z" }),
    ]);
    expect(pinned.map((t) => t.id)).toEqual(["pin-a", "pin-b"]);
    expect(rest.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  it("orders ties deterministically", () => {
    const { rest } = orderDenseThreads([thread("b"), thread("a")]);
    expect(rest.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("matchesDenseThreadFilter", () => {
  it("matches every term across fields, case-insensitively", () => {
    expect(matchesDenseThreadFilter("auth API", ["Fix auth bug", "api-server", null])).toBe(true);
    expect(matchesDenseThreadFilter("auth web", ["Fix auth bug", "api-server"])).toBe(false);
    expect(matchesDenseThreadFilter("   ", ["anything"])).toBe(true);
  });
});
