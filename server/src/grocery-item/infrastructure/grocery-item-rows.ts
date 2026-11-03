import { Context, type DateTime, Effect, Layer, PubSub, Ref } from "effect"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import type { GroceryItemName } from "../domain/grocery-item-name.ts"
import { GroceryItemSeq } from "../view/grocery-item-views.ts"

export type GroceryItemRowStatus =
  | { readonly _tag: "Unchecked" }
  | { readonly _tag: "Checked"; readonly checkedAt: DateTime.Utc }
  | { readonly _tag: "Removed"; readonly removedAt: DateTime.Utc }

export type GroceryItemRow = {
  readonly id: GroceryItemId
  readonly name: GroceryItemName
  readonly status: GroceryItemRowStatus
  readonly addedAt: DateTime.Utc
  readonly seq: GroceryItemSeq
}

export type GroceryItemRowsState = {
  readonly rowsById: ReadonlyMap<GroceryItemId, GroceryItemRow>
  readonly lastSeq: GroceryItemSeq
}

export class GroceryItemRows extends Context.Service<
  GroceryItemRows,
  {
    readonly state: Ref.Ref<GroceryItemRowsState>
    readonly writtenSeqs: PubSub.PubSub<GroceryItemSeq>
  }
>()("GroceryItemRows") {
  static readonly layer = Layer.effect(
    GroceryItemRows,
    Effect.gen(function* () {
      const state = yield* Ref.make<GroceryItemRowsState>({ rowsById: new Map(), lastSeq: GroceryItemSeq.make(0) })
      const writtenSeqs = yield* PubSub.unbounded<GroceryItemSeq>()
      return GroceryItemRows.of({ state, writtenSeqs })
    }),
  )
}
