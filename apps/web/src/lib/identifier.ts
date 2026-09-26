/**
 * Identifierare: PIN, serienummer och MaskinIDs registernummer.
 * Alltid versaler, utan mellanslag och bindestreck vid jämförelse.
 */

/** Normaliserar det användaren skrev inför en uppslagning: versaler, inga mellanslag. */
export function normalizeIdentifier(input: string): string {
  return input.toUpperCase().replace(/\s+/g, "").trim();
}

/** Jämförelsenyckel där även bindestreck ignoreras. */
export function identifierKey(input: string): string {
  return normalizeIdentifier(input).replace(/-/g, "");
}

export type IdentifierKind = "registernummer" | "pin" | "serienummer";

/** Gissar vilken sorts identifierare användaren skrev – används för prefix i visningen. */
export function detectIdentifierKind(input: string): IdentifierKind {
  const v = normalizeIdentifier(input);
  if (/^MID-?\d{4}-?\d{7}$/.test(v)) return "registernummer";
  if (/^[A-Z0-9]{14,17}$/.test(v)) return "pin";
  return "serienummer";
}

/** Validerar inmatning innan sökning. Returnerar felmeddelande eller null. */
export function validateLookupQuery(input: string): string | null {
  const v = normalizeIdentifier(input);
  if (v.length === 0) return "Skriv serienummer, PIN eller registernummer.";
  if (v.length < 5) return "Numret är för kort. Kontrollera numret på maskinens typskylt.";
  if (v.length > 32) return "Numret är för långt. Kontrollera numret på maskinens typskylt.";
  if (!/^[A-Z0-9-]+$/.test(v)) return "Numret får bara innehålla bokstäver, siffror och bindestreck.";
  return null;
}
