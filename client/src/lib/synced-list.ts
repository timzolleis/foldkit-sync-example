import { createCollection, type Collection, type Transaction } from "@tanstack/db"
import {
  BroadcastChannelLeader,
  IndexedDBAdapter,
  NonRetriableError,
  startOfflineExecutor,
  WebLocksLeader,
} from "@tanstack/offline-transactions"
import { Effect, Fiber, Option, Schedule, Schema, Stream, SubscriptionRef } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

export const SyncedListStatus = defineTaggedUnion({ Connecting: {}, Live: {}, Offline: {} })
export type SyncedListStatus = typeof SyncedListStatus.Type

export interface SyncedListBatch<View> {
  readonly items: ReadonlyArray<View>
  readonly lastSeq: number
}

export interface HttpApiCallError {
  readonly _tag: string
  readonly message: string
  readonly reason?: { readonly _tag: string; readonly response?: { readonly status: number } }
}

export interface SyncedIntent<Row extends object, Args> {
  readonly args: Schema.Codec<Args, any>
  readonly optimistic: (rows: Collection<Row, string>, args: Args) => void
  readonly send: (args: Args) => Effect.Effect<{ readonly seq: number }, HttpApiCallError>
}

export interface SyncedList<Row extends object, Args extends Record<string, unknown>> {
  readonly rows: Collection<Row, string>
  readonly status: SubscriptionRef.SubscriptionRef<SyncedListStatus>
  readonly send: { readonly [Intent in keyof Args]: (args: Args[Intent]) => Transaction }
}

export interface SyncedListOptions<Row extends object, View, Args extends Record<string, unknown>> {
  readonly name: string
  readonly row: Schema.Codec<Row, any>
  readonly key: (row: Row) => string
  readonly viewKey: (view: View) => string
  readonly rowOf: (view: View) => Option.Option<Row>
  readonly live: (afterSeq: number) => Effect.Effect<Stream.Stream<SyncedListBatch<View>, unknown>, unknown>
  readonly intents: { readonly [Intent in keyof Args]: SyncedIntent<Row, Args[Intent]> }
}

type OfflineMutationFn = Parameters<typeof startOfflineExecutor>[0]["mutationFns"][string]

const RECONNECT_EVERY = "2 seconds"
const SILENT_FOR_AT_MOST = "25 seconds"

const wentOffline = Effect.callback<never, "went offline">((resume) => {
  const onOffline = () => resume(Effect.fail("went offline"))
  globalThis.addEventListener?.("offline", onOffline)
  return Effect.sync(() => globalThis.removeEventListener?.("offline", onOffline))
})

const isUnanswered = (error: HttpApiCallError): boolean =>
  error._tag === "HttpClientError" &&
  (error.reason?._tag !== "StatusCodeError" || (error.reason.response?.status ?? 500) >= 500)

const promiseOfSend = <A>(send: Effect.Effect<A, HttpApiCallError>): Promise<A> =>
  Effect.runPromise(
    send.pipe(
      Effect.mapError((error) => (isUnanswered(error) ? new Error(error.message) : new NonRetriableError(error.message))),
    ),
  )

const leaderFor = (name: string) =>
  globalThis.navigator?.locks === undefined ? new BroadcastChannelLeader(name) : new WebLocksLeader(name)

export const make = <Row extends object, View, Args extends Record<string, unknown>>(
  options: SyncedListOptions<Row, View, Args>,
) =>
  Effect.gen(function* () {
    const status = yield* SubscriptionRef.make<SyncedListStatus>(SyncedListStatus.Connecting())
    const KeptRows = Schema.fromJsonString(Schema.Struct({ rows: Schema.Array(options.row), lastSeq: Schema.Number }))
    const decodeKeptRows = Schema.decodeUnknownOption(KeptRows)
    const encodeKeptRows = Schema.encodeSync(KeptRows)
    const keptRowsKey = `synced-list:${options.name}`

    const syncedRows = new Map<string, Row>()
    let lastSeq = 0
    const seqWaiters = new Set<{ readonly seq: number; readonly resolve: () => void }>()

    const awaitSeq = (seq: number) =>
      seq <= lastSeq ? Promise.resolve() : new Promise<void>((resolve) => seqWaiters.add({ seq, resolve }))

    const resolveSeqWaiters = () => {
      for (const waiter of seqWaiters) {
        if (waiter.seq <= lastSeq) {
          seqWaiters.delete(waiter)
          waiter.resolve()
        }
      }
    }

    const keepRows = () =>
      globalThis.localStorage?.setItem(keptRowsKey, encodeKeptRows({ rows: [...syncedRows.values()], lastSeq }))

    const rows = createCollection<Row, string>({
      id: options.name,
      getKey: options.key,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          Option.map(decodeKeptRows(globalThis.localStorage?.getItem(keptRowsKey) ?? ""), (kept) => {
            begin()
            for (const row of kept.rows) {
              syncedRows.set(options.key(row), row)
              write({ type: "insert", value: row })
            }
            commit()
            lastSeq = kept.lastSeq
            markReady()
          })

          const applyBatch = (batch: SyncedListBatch<View>, isWholeList: boolean) => {
            begin({ snapshot: isWholeList })
            if (isWholeList) syncedRows.clear()
            for (const view of batch.items) {
              const key = options.viewKey(view)
              const isKept = syncedRows.has(key) && !isWholeList
              Option.match(options.rowOf(view), {
                onSome: (row) => {
                  write({ type: isKept ? "update" : "insert", value: row })
                  syncedRows.set(key, row)
                },
                onNone: () => {
                  if (isKept) write({ type: "delete", key })
                  syncedRows.delete(key)
                },
              })
            }
            commit()
            lastSeq = batch.lastSeq
            markReady()
            keepRows()
            resolveSeqWaiters()
          }

          const followList = Effect.suspend(() => {
            const afterSeq = lastSeq
            let isFirstBatch = true
            return options.live(afterSeq).pipe(
              Effect.flatMap((batches) =>
                Stream.runForEach(Stream.timeout(batches, SILENT_FOR_AT_MOST), (batch) => {
                  const isWholeList = isFirstBatch && afterSeq === 0
                  isFirstBatch = false
                  return batch.lastSeq < lastSeq
                    ? Effect.sync(() => {
                        lastSeq = 0
                      }).pipe(Effect.andThen(Effect.fail("the server forgot the list")))
                    : SubscriptionRef.set(status, SyncedListStatus.Live()).pipe(
                        Effect.andThen(Effect.sync(() => applyBatch(batch, isWholeList))),
                      )
                }),
              ),
            )
          }).pipe(
            Effect.andThen(Effect.fail("ended")),
            Effect.raceFirst(wentOffline),
            Effect.tapError(() => SubscriptionRef.set(status, SyncedListStatus.Offline())),
            Effect.retry(Schedule.spaced(RECONNECT_EVERY)),
          )

          const follower = Effect.runFork(followList)
          return () => {
            Effect.runFork(Fiber.interrupt(follower))
          }
        },
      },
    })

    const intentNames = Object.keys(options.intents) as Array<keyof Args & string>

    const mutationFnOf =
      <Intent extends keyof Args>(intent: SyncedIntent<Row, Args[Intent]>): OfflineMutationFn =>
      async ({ transaction }) => {
        const args = Option.getOrThrowWith(
          Schema.decodeUnknownOption(intent.args)(transaction.metadata?.["args"]),
          () => new NonRetriableError("The stored change no longer reads as this intent."),
        )
        const sent = await promiseOfSend(intent.send(args))
        await awaitSeq(sent.seq)
      }

    const executor = startOfflineExecutor({
      collections: { [options.name]: rows },
      mutationFns: Object.fromEntries(intentNames.map((name) => [name, mutationFnOf(options.intents[name])])),
      storage: new IndexedDBAdapter(`synced-list:${options.name}`),
      leaderElection: leaderFor(`synced-list:${options.name}`),
    })
    yield* Effect.promise(() => executor.waitForInit())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        executor.dispose()
        await rows.cleanup()
      }),
    )

    const sendOf =
      <Intent extends keyof Args & string>(name: Intent, intent: SyncedIntent<Row, Args[Intent]>) =>
      (args: Args[Intent]): Transaction =>
        executor
          .createOfflineTransaction({
            mutationFnName: name,
            autoCommit: true,
            metadata: { args: Schema.encodeSync(intent.args)(args) },
          })
          .mutate(() => intent.optimistic(rows, args))

    const send = Object.fromEntries(
      intentNames.map((name) => [name, sendOf(name, options.intents[name])]),
    ) as unknown as SyncedList<Row, Args>["send"]

    return { rows, status, send } satisfies SyncedList<Row, Args>
  })
