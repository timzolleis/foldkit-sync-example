import { Context, type Effect, Schema, type Stream } from "effect"
import type { GroceryItemNotFoundError } from "../domain/grocery-item-error.ts"
import { GroceryItemId } from "../domain/grocery-item-id.ts"
import { GroceryItemName } from "../domain/grocery-item-name.ts"

export const GroceryItemSeq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("GroceryItemSeq"))
export type GroceryItemSeq = typeof GroceryItemSeq.Type

export const GroceryItemStatusView = Schema.TaggedUnion({
  Unchecked: {},
  Checked: { checkedAt: Schema.DateTimeUtc },
  Removed: { removedAt: Schema.DateTimeUtc },
})
export type GroceryItemStatusView = typeof GroceryItemStatusView.Type

export const GroceryItemView = Schema.Struct({
  groceryItemId: GroceryItemId,
  name: GroceryItemName,
  status: GroceryItemStatusView,
  addedAt: Schema.DateTimeUtc,
  seq: GroceryItemSeq,
})
export type GroceryItemView = typeof GroceryItemView.Type

export const GroceryItemsView = Schema.Struct({
  items: Schema.Array(GroceryItemView),
  lastSeq: GroceryItemSeq,
})
export type GroceryItemsView = typeof GroceryItemsView.Type

export class GroceryItemViews extends Context.Service<
  GroceryItemViews,
  {
    listGroceryItems(input: { readonly afterSeq: GroceryItemSeq }): Effect.Effect<GroceryItemsView>
    getGroceryItemById(input: {
      readonly groceryItemId: GroceryItemId
    }): Effect.Effect<GroceryItemView, GroceryItemNotFoundError>
    streamGroceryItems(input: { readonly afterSeq: GroceryItemSeq }): Stream.Stream<GroceryItemsView>
  }
>()("GroceryItemViews") {}
