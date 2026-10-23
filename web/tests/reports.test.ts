import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  insertSelect: vi.fn(),
  single: vi.fn(),
  lookupSelect: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/require-user", () => ({
  requireUser: mocks.requireUser,
}));

import { POST } from "@/app/api/reports/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SAVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATED_AT = "2026-10-23T12:00:00Z";

function payload() {
  return {
    id: SAVE_ID,
    reviewed: true,
    originalName: "demo-report.pdf",
    originalSizeBytes: 2844,
    originalSha256: "a".repeat(64),
    originalPages: [1],
    report: {
      figures: [
        {
          organization: "Demo organization",
          reportingPeriod: "2025",
          boundary: "Company operations",
          scope: "Scope 1",
          basis: "not applicable",
          label: "Scope 1 total",
          reportedValue: "142.5",
          unit: "tCO2e",
          excerptPage: 1,
          evidence: "Scope 1 total: 142.5 tCO2e",
        },
      ],
      warnings: [] as string[],
    },
  };
}

function storedReport() {
  const input = payload();

  return {
    id: input.id,
    created_at: CREATED_AT,
    original_name: input.originalName,
    original_size_bytes: input.originalSizeBytes,
    original_sha256: input.originalSha256,
    original_pages: input.originalPages,
    reviewed: input.reviewed,
    report: input.report,
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function duplicateSave() {
  mocks.single.mockResolvedValue({
    data: null,
    error: { code: "23505" },
  });
}

describe("GHG report save retries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: { id: USER_ID },
      supabase: { from: mocks.from },
    });

    mocks.from.mockReturnValue({
      insert: mocks.insert,
      select: mocks.lookupSelect,
    });

    mocks.insert.mockReturnValue({
      select: mocks.insertSelect,
    });

    mocks.insertSelect.mockReturnValue({
      single: mocks.single,
    });

    const lookup = {
      eq: mocks.eq,
      maybeSingle: mocks.maybeSingle,
    };

    mocks.lookupSelect.mockReturnValue(lookup);
    mocks.eq.mockReturnValue(lookup);

    mocks.single.mockResolvedValue({
      data: { id: SAVE_ID, created_at: CREATED_AT },
      error: null,
    });

    mocks.maybeSingle.mockResolvedValue({
      data: storedReport(),
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a new snapshot with status 201", async () => {
    const response = await POST(request(payload()));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      savedReport: {
        id: SAVE_ID,
        created_at: CREATED_AT,
      },
    });
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it("returns the existing snapshot for an identical retry", async () => {
    duplicateSave();

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      savedReport: {
        id: SAVE_ID,
        created_at: CREATED_AT,
      },
      alreadySaved: true,
    });

    expect(mocks.eq).toHaveBeenCalledWith("id", SAVE_ID);
    expect(mocks.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("accepts identical JSON with different object-key ordering", async () => {
    duplicateSave();

    const stored = storedReport();
    const reorderedFigure = Object.fromEntries(
      Object.entries(stored.report.figures[0]).reverse()
    );

    mocks.maybeSingle.mockResolvedValue({
      data: {
        ...stored,
        report: {
          warnings: [],
          figures: [reorderedFigure],
        },
      },
      error: null,
    });

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect((await response.json()).alreadySaved).toBe(true);
  });

  it.each([
    "reported value",
    "evidence",
    "warnings",
    "filename",
    "fingerprint",
    "file size",
    "pages",
  ])("rejects changed %s under the same save ID", async (field) => {
    duplicateSave();

    const changed = payload();

    switch (field) {
      case "reported value":
        changed.report.figures[0].reportedValue = "999";
        break;
      case "evidence":
        changed.report.figures[0].evidence = "Different quotation";
        break;
          case "warnings":
        changed.report.warnings = ["A new warning"];
        break;
      case "filename":
        changed.originalName = "different.pdf";
        break;
      case "fingerprint":
        changed.originalSha256 = "b".repeat(64);
        break;
      case "file size":
        changed.originalSizeBytes = 3000;
        break;
      case "pages":
        changed.originalPages = [2];
        break;
    }

    const response = await POST(request(changed));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain(
      "different report content"
    );
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("does not return another account's snapshot when lookup finds nothing", async () => {
    duplicateSave();

    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const response = await POST(request(payload()));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.savedReport).toBeUndefined();
    expect(body.error).not.toContain("another account");
    expect(mocks.eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("returns 503 when the existing save cannot be checked", async () => {
    duplicateSave();

    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "08006" },
    });

    const response = await POST(request(payload()));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain(
      "previous save could not be checked"
    );
  });

  it("preserves authentication rejection without accessing the database", async () => {
    const denied = Response.json(
      { error: "Sign-in required." },
      { status: 401 }
    );

    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: denied,
    });

    const response = await POST(request(payload()));

    expect(response).toBe(denied);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});