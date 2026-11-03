import { Array as Arr, Effect, Layer, Option, Order, pipe, PubSub, Ref, Stream } from "effect"
import { GroceryItemNotFoundError } from "../domain/grocery-item-error.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import {
  type GroceryItemSeq,
  type GroceryItemsView,
  type GroceryItemView,
  GroceryItemViews,
} from "../view/grocery-item-views.ts"
import { type GroceryItemRow, GroceryItemRows, type GroceryItemRowsState } from "./grocery-item-rows.ts"

const HEARTBEAT_EVERY = "10 seconds"

const groceryItemViewFromRow = (row: GroceryItemRow): GroceryItemView => ({
  groceryItemId: row.id,
  name: row.name,
  status: row.status,
  addedAt: row.addedAt,
  seq: row.seq,
})

const groceryItemsViewFromState = (input: {
  readonly state: GroceryItemRowsState
  readonly afterSeq: GroceryItemSeq
}): GroceryItemsView => ({
  items: pipe(
    Arr.fromIterable(input.state.rowsById.values()),
    Arr.filter((row) => row.seq > input.afterSeq),
    Arr.sort(Order.mapInput(Order.Number, (row: GroceryItemRow) => row.seq)),
    Arr.map(groceryItemViewFromRow),
  ),
  lastSeq: input.state.lastSeq,
})

export const MemoryGroceryItemViews = Layer.effect(
  GroceryItemViews,
  Effect.gen(function* () {
    const { state, writtenSeqs } = yield* GroceryItemRows

    const listGroceryItems = Effect.fn("MemoryGroceryItemViews.listGroceryItems")(function* ({
      afterSeq,
    }: {
      readonly afterSeq: GroceryItemSeq
    }) {
      const currentState = yield* Ref.get(state)
      return groceryItemsViewFromState({ state: currentState, afterSeq })
    })

    const getGroceryItemById = Effect.fn("MemoryGroceryItemViews.getGroceryItemById")(function* ({
      groceryItemId,
    }: {
      readonly groceryItemId: GroceryItemId
    }) {
      const { rowsById } = yield* Ref.get(state)
      const row = rowsById.get(groceryItemId)
      if (row === undefined) return yield* new GroceryItemNotFoundError({ groceryItemId })
      return groceryItemViewFromRow(row)
    })

    const streamGroceryItems = ({ afterSeq }: { readonly afterSeq: GroceryItemSeq }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(writtenSeqs)
          const firstBatch = yield* listGroceryItems({ afterSeq })
          const seqsWrittenSince = Stream.fromSubscription(subscription).pipe(Stream.map(Option.some))
          const heartbeats = Stream.tick(HEARTBEAT_EVERY).pipe(Stream.map(() => Option.none<GroceryItemSeq>()))
          const laterBatches = Stream.merge(seqsWrittenSince, heartbeats).pipe(
            Stream.mapAccumEffect(
              () => firstBatch.lastSeq,
              (lastSeq, maybeWrittenSeq) =>
                Option.match(maybeWrittenSeq, {
                  onNone: () =>
                    Effect.map(listGroceryItems({ afterSeq: lastSeq }), (batch) => [batch.lastSeq, [batch]] as const),
                  onSome: (writtenSeq) =>
                    writtenSeq <= lastSeq
                      ? Effect.succeed([lastSeq, []] as const)
                      : Effect.map(listGroceryItems({ afterSeq: lastSeq }), (batch) =>
                          batch.items.length === 0 ? ([batch.lastSeq, []] as const) : ([batch.lastSeq, [batch]] as const),
                        ),
                }),
            ),
          )
          return Stream.concat(Stream.succeed(firstBatch), laterBatches)
        }),
      )

    return GroceryItemViews.of({ listGroceryItems, getGroceryItemById, streamGroceryItems })
  }),
)
