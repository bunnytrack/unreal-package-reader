/**
 * What a native class reader needs: a struct reader's `ReadContext`, whose
 * `object` resolves to real table entries, plus the package's name resolver.
 * The object-reference helpers are the struct layer's, re-exported for the
 * native readers that use them.
 */

import type { ReadContext } from "../structs/context.ts";
import type { TableResolver } from "../package/objects.ts";

export {
  readObjectRef,
  readObjectRefs,
  type ObjectRef,
} from "../structs/context.ts";

export type NativeContext = ReadContext & TableResolver;
