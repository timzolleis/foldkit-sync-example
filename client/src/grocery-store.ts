import { createCollection, type Collection, type PendingMutation, type Transaction } from "@tanstack/db"
import { NonRetriableError, startOfflineExecutor } from "@tanstack/offline-transactions"
import { Context, DateTime, Effect, Fiber, Layer, Match, Option, Schedule, Schema, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import type { GroceryItemId } from "grocery-server/grocery-item/domain/grocery-item-id.ts"
import type { GroceryItemName } from "grocery-server/grocery-item/domain/grocery-item-name.ts"
import { GroceryApi } from "grocery-server/grocery-item/http/grocery-item-api.ts"
import {
  GroceryItemSeq,
  type GroceryItemsView,
  type GroceryItemView,
} from "grocery-server/grocery-item/view/grocery-item-views.ts"
import { defineTaggedUnion } from "foldkit/schema"

export const GroceryItemRecord = Schema.Struct({
  groceryItemId: Schema.String,
  name: Schema.String,
  status: Schema.TaggedUnion({ Unchecked: {}, Checked: { checkedAt: Schema.String } }),
  addedAt: Schema.String,
  seq: Schema.Number,
})
export type GroceryItemRecord = typeof GroceryItemRecord.Type

const KeptGroceryItems = Schema.Struct({ items: Schema.Array(GroceryItemRecord), lastSeq: GroceryItemSeq })

const groceryItemRecordFromView = (view: GroceryItemView, status: GroceryItemRecord["status"]): GroceryItemRecord => ({
  groceryItemId: view.groceryItemId,
  name: view.name,
  status,
  addedAt: DateTime.formatIso(view.addedAt),
  seq: view.seq,
})

export const GroceryListSyncStatus = defineTaggedUnion({ Connecting: {}, Live: {}, Offline: {} })
export type GroceryListSyncStatus = typeof GroceryListSyncStatus.Type

const KEPT_GROCERY_ITEMS_KEY = "grocery-items:kept"
const RECONNECT_EVERY = "2 seconds"
const SILENT_FOR_AT_MOST = "25 seconds"

const wentOffline = Effect.callback<never, "went offline">((resume) => {
  const onOffline = () => resume(Effect.fail("went offline"))
  globalThis.addEventListener?.("offline", onOffline)
  return Effect.sync(() => globalThis.removeEventListener?.("offline", onOffline))
})

const decodeKeptGroceryItems = Schema.decodeUnknownOption(Schema.fromJsonString(KeptGroceryItems))
const encodeKeptGroceryItems = Schema.encodeSync(Schema.fromJsonString(KeptGroceryItems))

type GroceryApiError = {
  readonly _tag: string
  readonly message: string
  readonly reason?: { readonly _tag: string; readonly response?: { readonly status: number } }
}

const isRetriableGroceryApiError = (error: GroceryApiError): boolean =>
  error._tag === "HttpClientError" &&
  (error.reason?._tag !== "StatusCodeError" || (error.reason.response?.status ?? 500) >= 500)

const promiseFromGroceryApiCall = <A, E extends GroceryApiError>(call: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    call.pipe(
      Effect.mapError((error) =>
        isRetriableGroceryApiError(error) ? new Error(error.message) : new NonRetriableError(error.message),
      ),
    ),
  )

const groceryItemIdOfMutation = (mutation: PendingMutation | undefined): GroceryItemId =>
  (mutation?.key ?? "") as GroceryItemId

const nameOfMutation = (mutation: PendingMutation | undefined): GroceryItemName =>
  (mutation?.modified as GroceryItemRecord).name as GroceryItemName

export class GroceryStore extends Context.Service<
  GroceryStore,
  {
    readonly groceryItems: Collection<GroceryItemRecord, string>
    readonly syncStatus: SubscriptionRef.SubscriptionRef<GroceryListSyncStatus>
    addGroceryItem(args: { readonly groceryItemId: GroceryItemId; readonly name: GroceryItemName }): Transaction
    renameGroceryItem(args: { readonly groceryItemId: GroceryItemId; readonly name: GroceryItemName }): Transaction
    checkGroceryItem(args: { readonly groceryItemId: GroceryItemId }): Transaction
    uncheckGroceryItem(args: { readonly groceryItemId: GroceryItemId }): Transaction
    removeGroceryItem(args: { readonly groceryItemId: GroceryItemId }): Transaction
  }
>()("GroceryStore") {
  static readonly layer = Layer.effect(
    GroceryStore,
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(GroceryApi, { baseUrl: `${globalThis.location?.origin ?? ""}/api` })
      const syncStatus = yield* SubscriptionRef.make<GroceryListSyncStatus>(GroceryListSyncStatus.Connecting())

      const syncedItems = new Map<string, GroceryItemRecord>()
      let lastSeq = GroceryItemSeq.make(0)
      const seqWaiters = new Set<{ readonly seq: number; readonly resolve: () => void }>()

      const awaitGroceryItemSeq = (seq: number) =>
        seq <= lastSeq
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              seqWaiters.add({ seq, resolve })
            })

      const resolveSeqWaiters = () => {
        for (const waiter of seqWaiters) {
          if (waiter.seq <= lastSeq) {
            seqWaiters.delete(waiter)
            waiter.resolve()
          }
        }
      }

      const keepGroceryItems = () =>
        globalThis.localStorage?.setItem(
          KEPT_GROCERY_ITEMS_KEY,
          encodeKeptGroceryItems({ items: [...syncedItems.values()], lastSeq }),
        )

      const groceryItems = createCollection<GroceryItemRecord, string>({
        id: "grocery-items",
        getKey: (item) => item.groceryItemId,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            const keptGroceryItems = decodeKeptGroceryItems(globalThis.localStorage?.getItem(KEPT_GROCERY_ITEMS_KEY) ?? "")
            Option.map(keptGroceryItems, (snapshot) => {
              begin()
              for (const item of snapshot.items) {
                syncedItems.set(item.groceryItemId, item)
                write({ type: "insert", value: item })
              }
              commit()
              lastSeq = GroceryItemSeq.make(snapshot.lastSeq)
              markReady()
            })

            const applyGroceryItemsView = (groceryItemsView: GroceryItemsView, isWholeList: boolean) => {
              begin({ snapshot: isWholeList })
              if (isWholeList) syncedItems.clear()
              for (const item of groceryItemsView.items) {
                const isKept = syncedItems.has(item.groceryItemId)
                const keep = (record: GroceryItemRecord) => {
                  write({ type: isKept && !isWholeList ? "update" : "insert", value: record })
                  syncedItems.set(item.groceryItemId, record)
                }
                Match.valueTags(item.status, {
                  Unchecked: () => keep(groceryItemRecordFromView(item, { _tag: "Unchecked" })),
                  Checked: ({ checkedAt }) =>
                    keep(groceryItemRecordFromView(item, { _tag: "Checked", checkedAt: DateTime.formatIso(checkedAt) })),
                  Removed: () => {
                    if (isKept && !isWholeList) write({ type: "delete", key: item.groceryItemId })
                    syncedItems.delete(item.groceryItemId)
                  },
                })
              }
              commit()
              lastSeq = groceryItemsView.lastSeq
              markReady()
              keepGroceryItems()
              resolveSeqWaiters()
            }

            const followGroceryItems = Effect.suspend(() => {
              const afterSeq = lastSeq
              let isFirstBatch = true
              return client.groceryItems.streamGroceryItems({ query: { afterSeq } }).pipe(
                Effect.flatMap((groceryItemsViews) =>
                  Stream.runForEach(Stream.timeout(groceryItemsViews, SILENT_FOR_AT_MOST), (groceryItemsView) => {
                    const isWholeList = isFirstBatch && afterSeq === 0
                    isFirstBatch = false
                    return groceryItemsView.lastSeq < lastSeq
                      ? Effect.sync(() => {
                          lastSeq = GroceryItemSeq.make(0)
                        }).pipe(Effect.andThen(Effect.fail("the server forgot the list")))
                      : SubscriptionRef.set(syncStatus, GroceryListSyncStatus.Live()).pipe(
                          Effect.andThen(Effect.sync(() => applyGroceryItemsView(groceryItemsView, isWholeList))),
                        )
                  }),
                ),
              )
            }).pipe(
              Effect.andThen(Effect.fail("ended")),
              Effect.raceFirst(wentOffline),
              Effect.tapError(() => SubscriptionRef.set(syncStatus, GroceryListSyncStatus.Offline())),
              Effect.retry(Schedule.spaced(RECONNECT_EVERY)),
            )

            const follower = Effect.runFork(followGroceryItems)
            return () => {
              Effect.runFork(Fiber.interrupt(follower))
            }
          },
        },
      })

      const executor = startOfflineExecutor({
        collections: { groceryItems },
        mutationFns: {
          addGroceryItem: async ({ transaction }) => {
            const [mutation] = transaction.mutations
            const added = await promiseFromGroceryApiCall(
              client.groceryItems.addGroceryItem({
                payload: { groceryItemId: groceryItemIdOfMutation(mutation), name: nameOfMutation(mutation) },
              }),
            )
            await awaitGroceryItemSeq(added.seq)
          },
          renameGroceryItem: async ({ transaction }) => {
            const [mutation] = transaction.mutations
            const renamed = await promiseFromGroceryApiCall(
              client.groceryItems.renameGroceryItem({
                params: { groceryItemId: groceryItemIdOfMutation(mutation) },
                payload: { name: nameOfMutation(mutation) },
              }),
            )
            await awaitGroceryItemSeq(renamed.seq)
          },
          checkGroceryItem: async ({ transaction }) => {
            const checked = await promiseFromGroceryApiCall(
              client.groceryItems.checkGroceryItem({
                params: { groceryItemId: groceryItemIdOfMutation(transaction.mutations[0]) },
              }),
            )
            await awaitGroceryItemSeq(checked.seq)
          },
          uncheckGroceryItem: async ({ transaction }) => {
            const unchecked = await promiseFromGroceryApiCall(
              client.groceryItems.uncheckGroceryItem({
                params: { groceryItemId: groceryItemIdOfMutation(transaction.mutations[0]) },
              }),
            )
            await awaitGroceryItemSeq(unchecked.seq)
          },
          removeGroceryItem: async ({ transaction }) => {
            const removed = await promiseFromGroceryApiCall(
              client.groceryItems.removeGroceryItem({
                params: { groceryItemId: groceryItemIdOfMutation(transaction.mutations[0]) },
              }),
            )
            await awaitGroceryItemSeq(removed.seq)
          },
        },
      })
      yield* Effect.promise(() => executor.waitForInit())
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          executor.dispose()
          await groceryItems.cleanup()
        }),
      )

      const nowIso = () => DateTime.formatIso(DateTime.nowUnsafe())

      return GroceryStore.of({
        groceryItems,
        syncStatus,
        addGroceryItem: executor.createOfflineAction<{ groceryItemId: GroceryItemId; name: GroceryItemName }>({
          mutationFnName: "addGroceryItem",
          onMutate: ({ groceryItemId, name }) => {
            groceryItems.insert({ groceryItemId, name, status: { _tag: "Unchecked" }, addedAt: nowIso(), seq: 0 })
          },
        }),
        renameGroceryItem: executor.createOfflineAction<{ groceryItemId: GroceryItemId; name: GroceryItemName }>({
          mutationFnName: "renameGroceryItem",
          onMutate: ({ groceryItemId, name }) => {
            groceryItems.update(groceryItemId, (draft) => {
              draft.name = name
            })
          },
        }),
        checkGroceryItem: executor.createOfflineAction<{ groceryItemId: GroceryItemId }>({
          mutationFnName: "checkGroceryItem",
          onMutate: ({ groceryItemId }) => {
            groceryItems.update(groceryItemId, (draft) => {
              draft.status = { _tag: "Checked", checkedAt: nowIso() }
            })
          },
        }),
        uncheckGroceryItem: executor.createOfflineAction<{ groceryItemId: GroceryItemId }>({
          mutationFnName: "uncheckGroceryItem",
          onMutate: ({ groceryItemId }) => {
            groceryItems.update(groceryItemId, (draft) => {
              draft.status = { _tag: "Unchecked" }
            })
          },
        }),
        removeGroceryItem: executor.createOfflineAction<{ groceryItemId: GroceryItemId }>({
          mutationFnName: "removeGroceryItem",
          onMutate: ({ groceryItemId }) => {
            groceryItems.delete(groceryItemId)
          },
        }),
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
