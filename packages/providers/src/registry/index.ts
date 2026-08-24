import type { ProviderDefinition } from "../types.ts";
import { amazon } from "./amazon.ts";
import { apple } from "./apple.ts";
import { github } from "./github.ts";
import { google } from "./google.ts";
import { microsoft } from "./microsoft.ts";
import { rest } from "./rest.ts";

export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  github,
  google,
  microsoft,
  apple,
  amazon,
  ...rest,
];

export function providerById(id: string): ProviderDefinition | undefined {
  return BUILTIN_PROVIDERS.find((item) => item.id === id);
}
