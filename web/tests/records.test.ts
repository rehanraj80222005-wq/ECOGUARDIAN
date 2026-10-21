import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { requireUserMock, rpcMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/require-user", () => ({
  requireUser: requireUserMock,
}));

import { POST } from "@/app/api/records/route";

const SOURCE_ID = "b4aebd0a-c18b-488d-a3f9-6ffa09f088e0";

function activity(overrides: Record<string, unknown> = {}) {
  return {
    activity: "electricity",
    quantity: 1800,
    unit: "kWh",
    evidence: "Demo bill: 1800 kWh.",
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    reviewed: true,
    sourceDocumentId: SOURCE_ID,
    billingStartDate: "2026-09-01",
    billingEndDate: "2026-09-30",
    draft: {
      supplier: "Demo supplier",
      billingPeriod: "September 2026",
      items: [activity()],
      warnings: [],
    },
    ...overrides,
  };
}

function withItems(items: ReturnType<typeof activity>[]) {
  const body = payload();

  return {
    ...body,
    draft: {
      ...body.draft,
      items,
    },
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Saving reviewed electricity activity", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    rpcMock.mockReset();

    requireUserMock.mockResolvedValue({
      ok: true,
      supabase: { rpc: rpcMock },
    });

    rpcMock.mockResolvedValue({
      data: { savedCount: 1 },
      error: null,
    });

    // Expected database failures should not clutter test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes reviewed data and billing dates to the dated-save function", async () => {
    const body = payload();
    const response = await POST(request(body));

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
      "save_dated_source_emissions",
      {
        p_source_id: SOURCE_ID,
        p_supplier: body.draft.supplier,
        p_billing_period: body.draft.billingPeriod,
        p_items: body.draft.items,
        p_billing_start_date: "2026-09-01",
        p_billing_end_date: "2026-09-30",
      }
    );

    expect(await response.json()).toEqual({ savedCount: 1 });
  });

  it("rejects an unauthenticated request before reading its body", async () => {
    const denied = Response.json(
      { error: "Sign-in required." },
      { status: 401 }
    );

    requireUserMock.mockResolvedValue({
      ok: false,
      response: denied,
    });

    const incoming = new Request("http://localhost/api/records", {
      method: "POST",
      body: "invalid JSON",
    });

    const readBody = vi.spyOn(incoming, "json");
    const response = await POST(incoming);

    expect(response).toBe(denied);
    expect(readBody).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without calling the database", async () => {
    const incoming = new Request("http://localhost/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid",
    });

    const response = await POST(incoming);

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an unreviewed draft",
      body: payload({ reviewed: false }),
    },
    {
      name: "an invalid source ID",
      body: payload({ sourceDocumentId: "not-a-uuid" }),
    },
    {
      name: "a missing billing start date",
      body: payload({ billingStartDate: undefined }),
    },
    {
      name: "an impossible calendar date",
      body: payload({ billingStartDate: "2026-02-30" }),
    },
    {
      name: "February 29 in a non-leap year",
      body: payload({ billingStartDate: "2026-02-29" }),
    },
    {
      name: "a date in the wrong format",
      body: payload({ billingStartDate: "01/09/2026" }),
    },
    {
      name: "an end date before the start date",
      body: payload({ billingEndDate: "2026-08-31" }),
    },
    {
      name: "an empty activity list",
      body: withItems([]),
    },
    {
      name: "more than 30 activities",
      body: withItems(
        Array.from({ length: 31 }, () => activity())
      ),
    },
    {
      name: "fuel activity",
      body: withItems([
        activity({ activity: "diesel", unit: "litres" }),
      ]),
    },
    {
      name: "MWh without conversion",
      body: withItems([activity({ unit: "MWh" })]),
    },
    {
      name: "a missing quantity",
      body: withItems([activity({ quantity: null })]),
    },
    {
      name: "a negative quantity",
      body: withItems([activity({ quantity: -1 })]),
    },
    {
      name: "a quantity above the saving limit",
      body: withItems([
        activity({ quantity: 1_000_000_000_001 }),
      ]),
    },
    {
      name: "a valid first row followed by an invalid row",
      body: withItems([
        activity(),
        activity({ quantity: null }),
      ]),
    },
  ])("rejects $name before saving anything", async ({ body }) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.any(String),
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts a one-day billing period on a valid leap day", async () => {
    const response = await POST(
      request(
        payload({
          billingStartDate: "2024-02-29",
          billingEndDate: "2024-02-29",
        })
      )
    );

    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1_000_000_000_000])(
    "accepts the quantity boundary %s",
    async (quantity) => {
      const response = await POST(
        request(withItems([activity({ quantity })]))
      );

      expect(response.status).toBe(201);
      expect(rpcMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    {
      name: "duplicate source",
      code: "23505",
      message: "Internal duplicate detail",
      status: 409,
      expected: "already has saved emissions",
    },
    {
      name: "source unavailable to the account",
      code: "42501",
      message: "Internal ownership detail",
      status: 403,
      expected: "unavailable in your account",
    },
    {
      name: "GHG report category guard",
      code: "22023",
      message:
        "A GHG report cannot receive saved electricity activity",
      status: 400,
      expected: "classified as a GHG report",
    },
    {
      name: "database validation failure",
      code: "22023",
      message: "Internal validation detail",
      status: 400,
      expected: "rejected the activity data or billing dates",
    },
    {
      name: "unexpected database error",
      code: "XX000",
      message: "Internal database detail",
      status: 500,
      expected: "Could not save records",
    },
  ])("handles $name without retrying", async ({
    code,
    message,
    status,
    expected,
  }) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code, message },
    });

    const response = await POST(request(payload()));
    const data = await response.json();

    expect(response.status).toBe(status);
    expect(data.error).toContain(expected);
    expect(data.error).not.toContain(message);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("asks the user to check saved records when the save cannot be confirmed", async () => {
    rpcMock.mockRejectedValue(new Error("Connection lost"));

    const response = await POST(request(payload()));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toContain("Refresh Saved records before retrying");
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});