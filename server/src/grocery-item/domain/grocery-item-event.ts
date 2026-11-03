import { Schema } from "effect"
import { GroceryItemId } from "./grocery-item-id.ts"
import { GroceryItemName } from "./grocery-item-name.ts"

const groceryItemEventFields = { groceryItemId: GroceryItemId, occurredOn: Schema.DateTimeUtc }

export const GroceryItemAddedEvent = Schema.TaggedStruct("GroceryItemAddedEvent", {
  ...groceryItemEventFields,
  name: GroceryItemName,
})
export type GroceryItemAddedEvent = typeof GroceryItemAddedEvent.Type

export const GroceryItemRenamedEvent = Schema.TaggedStruct("GroceryItemRenamedEvent", {
  ...groceryItemEventFields,
  name: GroceryItemName,
  previousName: GroceryItemName,
})
export type GroceryItemRenamedEvent = typeof GroceryItemRenamedEvent.Type

export const GroceryItemCheckedEvent = Schema.TaggedStruct("GroceryItemCheckedEvent", { ...groceryItemEventFields })
export type GroceryItemCheckedEvent = typeof GroceryItemCheckedEvent.Type

export const GroceryItemUncheckedEvent = Schema.TaggedStruct("GroceryItemUncheckedEvent", { ...groceryItemEventFields })
export type GroceryItemUncheckedEvent = typeof GroceryItemUncheckedEvent.Type

export const GroceryItemRemovedEvent = Schema.TaggedStruct("GroceryItemRemovedEvent", { ...groceryItemEventFields })
export type GroceryItemRemovedEvent = typeof GroceryItemRemovedEvent.Type

export const GroceryItemEvent = Schema.Union([
  GroceryItemAddedEvent,
  GroceryItemRenamedEvent,
  GroceryItemCheckedEvent,
  GroceryItemUncheckedEvent,
  GroceryItemRemovedEvent,
])
export type GroceryItemEvent = typeof GroceryItemEvent.Type
