/**
 * A city is capitalised words, with the lowercase particles and elided prefixes some names carry
 * between them, such as "Coeur d'Alene" and "Lake of the Woods".
 */
export const CITY_PATTERN =
  "\\p{Lu}[\\p{L}.'-]*(?:[ ](?:(?:de|la|le|du|des|del|of|the|van|von|d'|l')(?:[ ](?:de|la|le|of|the))*[ ]?)?\\p{Lu}[\\p{L}.'-]*){0,2}";
