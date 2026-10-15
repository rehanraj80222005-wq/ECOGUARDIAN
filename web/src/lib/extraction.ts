import { z } from "zod";

export const extractionSchema = z.object({
  supplier: z.string().max(300).nullable(),
  billingPeriod: z.string().max(300).nullable(),
  items: z.array(
    z.object({
      activity: z.enum([
        "electricity",
        "natural_gas",
        "diesel",
        "petrol",
        "other",
      ]),
      quantity: z.number().finite().nonnegative().nullable(),
      unit: z.string().max(80).nullable(),
      evidence: z.string().max(1000),
    })
  ).max(30),
  warnings: z.array(z.string().max(1000)).max(20),
});

export type Extraction = z.infer<typeof extractionSchema>;