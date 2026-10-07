import { createRedactor } from "@kickrocks/recipes";
import type { ProfileFields } from "@kickrocks/shared";

/**
 * Hides the person's values in text the model reads or the server stores. The recipe runner's
 * redactor knows the plain, percent-encoded and slug spellings; a form submitted by GET puts a
 * space in the address as a plus sign, so that spelling is covered here too.
 */
export function createMask(fields: ProfileFields): (text: string) => string {
  const plain = createRedactor(fields);
  const withPlus = createRedactor(
    Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [name, value?.replaceAll(" ", "+")]),
    ) as ProfileFields,
  );
  return (text) => withPlus(plain(text));
}
