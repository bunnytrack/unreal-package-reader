/**
 * Bitmap font structures, for `Font`.
 *
 * A font is a list of textures, each carrying the character rectangles cut out
 * of it - so one font can span several texture pages.
 */

import {
  readObjectRef,
  readStructArray,
  type ObjectRef,
  type ReadContext,
} from "./context.ts";

/** One character's rectangle within its font texture. */
export interface FontCharacter {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function readFontCharacter({ cursor }: ReadContext): FontCharacter {
  return {
    x: cursor.uint32(),
    y: cursor.uint32(),
    width: cursor.uint32(),
    height: cursor.uint32(),
  };
}

/** A texture page plus the characters laid out on it. */
export interface FontTexture {
  texture: ObjectRef;
  characters: FontCharacter[];
}

export function readFontTexture(ctx: ReadContext): FontTexture {
  return {
    texture: readObjectRef(ctx),
    characters: readStructArray(ctx, readFontCharacter),
  };
}

/**
 * One entry of a font's `TMap<TCHAR, TCHAR> CharRemap`, which maps a character
 * code to the glyph slot that draws it. A `TMap` serialises as a count
 * followed by key/value pairs.
 *
 * `TCHAR` is two bytes: UT is a Unicode build (`_UNICODE` makes `TCHAR` a
 * `UNICHAR`, `unsigned short` - `Core/Inc/UnVcWin32.h` in the UT 436 source
 * release). That is a property of the build that wrote the file, not of the
 * file, but the remap only exists from v69, which is the Unicode-built UT
 * codebase. Settled by UT's `LadderFonts.utx`, whose TrueType-imported fonts
 * each carry 1,183 pairs - `(0,0) (1,1) ... (0xA69D,0x049D)` - at four bytes
 * a pair, landing exactly on the object's end. `ut_packages.pas:5738-5742`
 * reads them as single bytes, which only works for the empty maps every stock
 * bitmap font has.
 */
export interface FontRemap {
  key: number;
  value: number;
}

export function readFontRemap({ cursor }: ReadContext): FontRemap {
  return {
    key: cursor.uint16(),
    value: cursor.uint16(),
  };
}
