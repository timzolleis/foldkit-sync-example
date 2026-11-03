import { Equivalence, Schema } from "effect"

export const GroceryItemName = Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(80)).pipe(
  Schema.brand("GroceryItemName"),
)
export type GroceryItemName = typeof GroceryItemName.Type

export const GroceryItemNameEquivalence = Equivalence.mapInput(Equivalence.String, (name: string) => name.toLowerCase())
