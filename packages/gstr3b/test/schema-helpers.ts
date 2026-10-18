import type { z } from "zod";
import { Gstr3bReturnSchema, type Gstr3bReturn } from "../src/index.js";
import { emptyReturn } from "../src/boxes.js";
import { codeOf } from "../src/primitives.js";
import { FILER, PERIOD } from "./helpers.js";

export { Gstr3bReturnSchema };

export function emptyFor(): Gstr3bReturn {
  return emptyReturn(FILER, PERIOD);
}

export function codeOfIssue(i: z.core.$ZodIssue | undefined): string | undefined {
  return i === undefined ? undefined : codeOf(i);
}
