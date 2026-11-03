import { Schema } from "effect"
import { createPrefixedId, prefixedId } from "../../lib/prefixed-id.ts"

export const GroceryItemId = prefixedId("gri").pipe(Schema.brand("GroceryItemId"))
export type GroceryItemId = typeof GroceryItemId.Type

export const generateGroceryItemId = (): GroceryItemId => GroceryItemId.make(createPrefixedId("gri"))
