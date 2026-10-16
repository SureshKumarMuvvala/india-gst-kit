import { z } from "zod";

// Number leaves are JSON numbers on the wire but strings in memory (spec §2). They are tracked by
// identity so that the serialiser and the lossless parser can tell them apart from string leaves.
const NUMBER_LEAVES = new WeakSet<object>();

export function markNumber<T extends z.ZodType>(schema: T): T {
  NUMBER_LEAVES.add(schema);
  return schema;
}

/** Strips `.optional()` / `.nullable()` wrappers. */
export function unwrapSchema(schema: z.ZodType): z.ZodType {
  let cur = schema;
  while (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) {
    cur = cur.unwrap() as z.ZodType;
  }
  return cur;
}

export function isNumberLeaf(schema: z.ZodType): boolean {
  return NUMBER_LEAVES.has(unwrapSchema(schema));
}

export function objectShape(schema: z.ZodType): Readonly<Record<string, z.ZodType>> | undefined {
  const u = unwrapSchema(schema);
  return u instanceof z.ZodObject ? u.shape : undefined;
}

export function arrayElement(schema: z.ZodType): z.ZodType | undefined {
  const u = unwrapSchema(schema);
  return u instanceof z.ZodArray ? (u.element as z.ZodType) : undefined;
}
