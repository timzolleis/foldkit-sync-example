import { Context, DateTime, Effect, Layer, Match, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { GroceryItemId } from "grocery-server/grocery-item/domain/grocery-item-id.ts"
import { GroceryItemName } from "grocery-server/grocery-item/domain/grocery-item-name.ts"
import { GroceryApi } from "grocery-server/grocery-item/http/grocery-item-api.ts"
import { GroceryItemSeq, type GroceryItemView } from "grocery-server/grocery-item/view/grocery-item-views.ts"
import * as SyncedList from "./lib/synced-list.ts"

export const GroceryItemRecord = Schema.Struct({
  groceryItemId: Schema.String,
  name: Schema.String,
  status: Schema.TaggedUnion({ Unchecked: {}, Checked: { checkedAt: Schema.String } }),
  addedAt: Schema.String,
})
export type GroceryItemRecord = typeof GroceryItemRecord.Type

const groceryItemRecordOf = (view: GroceryItemView): Option.Option<GroceryItemRecord> => {
  const record = (status: GroceryItemRecord["status"]) =>
    Option.some({ groceryItemId: view.groceryItemId, name: view.name, status, addedAt: DateTime.formatIso(view.addedAt) })
  return Match.valueTags(view.status, {
    Unchecked: () => record({ _tag: "Unchecked" }),
    Checked: ({ checkedAt }) => record({ _tag: "Checked", checkedAt: DateTime.formatIso(checkedAt) }),
    Removed: () => Option.none(),
  })
}

const GroceryItemName_ = Schema.Struct({ groceryItemId: GroceryItemId, name: GroceryItemName })
const GroceryItemRef = Schema.Struct({ groceryItemId: GroceryItemId })

type GroceryItemIntents = {
  readonly addGroceryItem: typeof GroceryItemName_.Type
  readonly renameGroceryItem: typeof GroceryItemName_.Type
  readonly checkGroceryItem: typeof GroceryItemRef.Type
  readonly uncheckGroceryItem: typeof GroceryItemRef.Type
  readonly removeGroceryItem: typeof GroceryItemRef.Type
}

const nowIso = () => DateTime.formatIso(DateTime.nowUnsafe())

export class GroceryStore extends Context.Service<
  GroceryStore,
  SyncedList.SyncedList<GroceryItemRecord, GroceryItemIntents>
>()("GroceryStore") {
  static readonly layer = Layer.effect(
    GroceryStore,
    Effect.gen(function* () {
      const { groceryItems } = yield* HttpApiClient.make(GroceryApi, {
        baseUrl: `${globalThis.location?.origin ?? ""}/api`,
      })
      return yield* SyncedList.make<GroceryItemRecord, GroceryItemView, GroceryItemIntents>({
        name: "grocery-items",
        row: GroceryItemRecord,
        key: (groceryItem) => groceryItem.groceryItemId,
        viewKey: (view) => view.groceryItemId,
        rowOf: groceryItemRecordOf,
        live: (afterSeq) => groceryItems.streamGroceryItems({ query: { afterSeq: GroceryItemSeq.make(afterSeq) } }),
        intents: {
          addGroceryItem: {
            args: GroceryItemName_,
            optimistic: (rows, { groceryItemId, name }) =>
              rows.insert({ groceryItemId, name, status: { _tag: "Unchecked" }, addedAt: nowIso() }),
            send: ({ groceryItemId, name }) => groceryItems.addGroceryItem({ payload: { groceryItemId, name } }),
          },
          renameGroceryItem: {
            args: GroceryItemName_,
            optimistic: (rows, { groceryItemId, name }) =>
              rows.update(groceryItemId, (draft) => {
                draft.name = name
              }),
            send: ({ groceryItemId, name }) =>
              groceryItems.renameGroceryItem({ params: { groceryItemId }, payload: { name } }),
          },
          checkGroceryItem: {
            args: GroceryItemRef,
            optimistic: (rows, { groceryItemId }) =>
              rows.update(groceryItemId, (draft) => {
                draft.status = { _tag: "Checked", checkedAt: nowIso() }
              }),
            send: ({ groceryItemId }) => groceryItems.checkGroceryItem({ params: { groceryItemId } }),
          },
          uncheckGroceryItem: {
            args: GroceryItemRef,
            optimistic: (rows, { groceryItemId }) =>
              rows.update(groceryItemId, (draft) => {
                draft.status = { _tag: "Unchecked" }
              }),
            send: ({ groceryItemId }) => groceryItems.uncheckGroceryItem({ params: { groceryItemId } }),
          },
          removeGroceryItem: {
            args: GroceryItemRef,
            optimistic: (rows, { groceryItemId }) => rows.delete(groceryItemId),
            send: ({ groceryItemId }) => groceryItems.removeGroceryItem({ params: { groceryItemId } }),
          },
        },
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
