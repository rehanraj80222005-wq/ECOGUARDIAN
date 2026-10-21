import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/require-user", () => ({
  requireUser: requireUserMock,
}));

import { POST } from "@/app/api/calculate/route";

function activity(overrides: Record<string, unknown> = {}) {
  return {
    activity: "electricity",
    quantity: 1800,
    unit: "kWh",
    evidence: "Demo bill: electricity consumption 1800 kWh.",
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Electricity calculation API", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue({ ok: true });
  });

  it("converts 1800 kWh into 900 kg and 0.9 tonnes", async () => {
    const response = await POST(
      request({
        reviewed: true,
        items: [activity()],
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const data = await response.json();

    expect(data.demonstration).toBe(true);
    expect(data.factor.id).toBe("demo-electricity-v1");
    expect(data.factor.kgCO2ePerKwh).toBe(0.5);
    expect(data.rows).toEqual([
      {
        activity: "electricity",
        quantity: 1800,
        unit: "kWh",
        kgCO2e: 900,
        tonnesCO2e: 0.9,
      },
    ]);
    expect(data.totalKgCO2e).toBe(900);
    expect(data.totalTonnesCO2e).toBe(0.9);
  });

  it("adds multiple activities correctly", async () => {
    const response = await POST(
      request({
        reviewed: true,
        items: [
          activity({ quantity: 1800 }),
          activity({ quantity: 1200 }),
        ],
      })
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.rows).toHaveLength(2);
    expect(data.totalKgCO2e).toBe(1500);
    expect(data.totalTonnesCO2e).toBe(1.5);
  });

  it("accepts decimal quantities and normalizes kWh spelling", async () => {
    const response = await POST(
      request({
        reviewed: true,
        items: [
          activity({
            quantity: 12.5,
            unit: " KWH ",
          }),
        ],
      })
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.rows[0].unit).toBe("kWh");
    expect(data.totalKgCO2e).toBeCloseTo(6.25);
    expect(data.totalTonnesCO2e).toBeCloseTo(0.00625, 8);
  });

  it("accepts zero consumption", async () => {
    const response = await POST(
      request({
        reviewed: true,
        items: [activity({ quantity: 0 })],
      })
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.totalKgCO2e).toBe(0);
    expect(data.totalTonnesCO2e).toBe(0);
  });

  it("returns the authentication rejection before reading the body", async () => {
    const denied = Response.json(
      { error: "Sign-in required." },
      { status: 401 }
    );

    requireUserMock.mockResolvedValue({
      ok: false,
      response: denied,
    });

    const incoming = new Request("http://localhost/api/calculate", {
      method: "POST",
      body: "invalid JSON",
    });

    const readBody = vi.spyOn(incoming, "json");
    const response = await POST(incoming);

    expect(response).toBe(denied);
    expect(response.status).toBe(401);
    expect(readBody).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const incoming = new Request("http://localhost/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid",
    });

    const response = await POST(incoming);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.any(String),
    });
  });

  it.each([
    {
      name: "an unreviewed draft",
      body: { reviewed: false, items: [activity()] },
    },
    {
      name: "missing review confirmation",
      body: { items: [activity()] },
    },
    {
      name: "an empty activity list",
      body: { reviewed: true, items: [] },
    },
    {
      name: "more than 30 activities",
      body: {
        reviewed: true,
        items: Array.from({ length: 31 }, () => activity()),
      },
    },
    {
      name: "a missing quantity",
      body: {
        reviewed: true,
        items: [activity({ quantity: null })],
      },
    },
    {
      name: "a negative quantity",
      body: {
        reviewed: true,
        items: [activity({ quantity: -1 })],
      },
    },
    {
      name: "a quantity supplied as text",
      body: {
        reviewed: true,
        items: [activity({ quantity: "1800" })],
      },
    },
    {
      name: "fuel activity",
      body: {
        reviewed: true,
        items: [activity({ activity: "diesel", unit: "litres" })],
      },
    },
    {
      name: "MWh without conversion",
      body: {
        reviewed: true,
        items: [activity({ unit: "MWh" })],
      },
    },
    {
      name: "a missing unit",
      body: {
        reviewed: true,
        items: [activity({ unit: null })],
      },
    },
  ])("rejects $name", async ({ body }) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.any(String),
    });
  });

  it("rejects totals that overflow even when individual quantities are finite", async () => {
    const response = await POST(
      request({
        reviewed: true,
        items: Array.from({ length: 4 }, () =>
          activity({ quantity: 1e308 })
        ),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The combined quantity is too large.",
    });
  });
});