import { z } from "zod";

export const reportExtractionSchema = z.object({
  figures: z.array(
    z.object({
      organization: z.string().max(300).nullable(),
      reportingPeriod: z.string().max(300).nullable(),
      boundary: z.string().max(600).nullable(),

      scope: z.enum([
        "Scope 1",
        "Scope 2",
        "Scope 3",
      ]),

      basis: z.enum([
        "location-based",
        "market-based",
        "not stated",
        "not applicable",
      ]),

      label: z.string().max(300),
      reportedValue: z.string().max(100).nullable(),
      unit: z.string().max(100).nullable(),

      // Position within the selected PDF, not the original report.
      excerptPage: z.number().int().min(1).max(3),
      evidence: z.string().max(1000),
    })
  ).max(20),

  warnings: z.array(z.string().max(1000)).max(20),
});

export type ReportExtraction = z.infer<
  typeof reportExtractionSchema
>;