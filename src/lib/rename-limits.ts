/**
 * The longest name a rename accepts. Long enough for a real product name,
 * short enough for a chart legend.
 *
 * Its own module because both sides need it: the rename form (a client
 * component) sets it as the field's `maxLength`, and `app-renames.ts`, which
 * imports `node:sqlite`, enforces it on the server.
 */
export const MAX_NAME_LENGTH = 60;
