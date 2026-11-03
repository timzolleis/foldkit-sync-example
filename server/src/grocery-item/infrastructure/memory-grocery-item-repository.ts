import { Array as Arr, Effect, Layer, Match, Option, PubSub, Ref, Result } from "effect"
import { matchTag, type MemberWithTag } from "../../lib/match-tag.ts"
import { CheckedGroceryItem, type ListedGroceryItem, UncheckedGroceryItem } from "../domain/grocery-item.ts"
import {
  GroceryItemAlreadyCheckedError,
  GroceryItemAlreadyExistsError,
  GroceryItemAlreadyRemovedError,
  GroceryItemAlreadyUncheckedError,
  GroceryItemChangedConcurrentlyError,
  GroceryItemNameTakenError,
  GroceryItemNotFoundError,
} from "../domain/grocery-item-error.ts"
import type { GroceryItemEvent } from "../domain/grocery-item-event.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import { type GroceryItemName, GroceryItemNameEquivalence } from "../domain/grocery-item-name.ts"
import {
  type FindGroceryItemByIdInput,
  type GroceryItemEventWriteErrors,
  GroceryItemRepository,
} from "../domain/grocery-item-repository.ts"
import { GroceryItemSeq } from "../view/grocery-item-views.ts"
import { type GroceryItemRow, GroceryItemRows, type GroceryItemRowsState } from "./grocery-item-rows.ts"

const listedGroceryItemFromRow = (row: GroceryItemRow): Option.Option<ListedGroceryItem> =>
  Match.valueTags(row.status, {
    Unchecked: () =>
      Option.some<ListedGroceryItem>(UncheckedGroceryItem.make({ groceryItemId: row.id, name: row.name, addedAt: row.addedAt })),
    Checked: ({ checkedAt }) =>
      Option.some<ListedGroceryItem>(
        CheckedGroceryItem.make({ groceryItemId: row.id, name: row.name, addedAt: row.addedAt, checkedAt }),
      ),
    Removed: () => Option.none(),
  })

const listedRowWithSameName = (input: {
  readonly state: GroceryItemRowsState
  readonly name: GroceryItemName
}): Option.Option<GroceryItemRow> =>
  Arr.findFirst(
    input.state.rowsById.values(),
    (row) => row.status._tag !== "Removed" && GroceryItemNameEquivalence(row.name, input.name),
  )

const isNameTakenByAnotherItem = (input: {
  readonly state: GroceryItemRowsState
  readonly name: GroceryItemName
  readonly groceryItemId: GroceryItemId
}): boolean =>
  Option.match(listedRowWithSameName(input), {
    onNone: () => false,
    onSome: (row) => row.id !== input.groceryItemId,
  })

export const MemoryGroceryItemRepository = Layer.effect(
  GroceryItemRepository,
  Effect.gen(function* () {
    const { state, writtenSeqs } = yield* GroceryItemRows

    const findRow = Effect.fn("MemoryGroceryItemRepository.findRow")(function* ({ groceryItemId }: FindGroceryItemByIdInput) {
      const { rowsById } = yield* Ref.get(state)
      const row = rowsById.get(groceryItemId)
      if (row === undefined) return yield* new GroceryItemNotFoundError({ groceryItemId })
      return row
    })

    const findListedGroceryItemById = Effect.fn("MemoryGroceryItemRepository.findListedGroceryItemById")(function* (
      input: FindGroceryItemByIdInput,
    ) {
      const row = yield* findRow(input)
      return yield* Option.match(listedGroceryItemFromRow(row), {
        onNone: () => Effect.fail(new GroceryItemAlreadyRemovedError({ groceryItemId: row.id })),
        onSome: (item) => Effect.succeed(item),
      })
    })

    const findUncheckedGroceryItemById = Effect.fn("MemoryGroceryItemRepository.findUncheckedGroceryItemById")(
      function* (input: FindGroceryItemByIdInput) {
        const row = yield* findRow(input)
        return yield* Match.valueTags(row.status, {
          Unchecked: () =>
            Effect.succeed(UncheckedGroceryItem.make({ groceryItemId: row.id, name: row.name, addedAt: row.addedAt })),
          Checked: () => Effect.fail(new GroceryItemAlreadyCheckedError({ groceryItemId: row.id })),
          Removed: () => Effect.fail(new GroceryItemAlreadyRemovedError({ groceryItemId: row.id })),
        })
      },
    )

    const findCheckedGroceryItemById = Effect.fn("MemoryGroceryItemRepository.findCheckedGroceryItemById")(function* (
      input: FindGroceryItemByIdInput,
    ) {
      const row = yield* findRow(input)
      return yield* Match.valueTags(row.status, {
        Checked: ({ checkedAt }) =>
          Effect.succeed(
            CheckedGroceryItem.make({ groceryItemId: row.id, name: row.name, addedAt: row.addedAt, checkedAt }),
          ),
        Unchecked: () => Effect.fail(new GroceryItemAlreadyUncheckedError({ groceryItemId: row.id })),
        Removed: () => Effect.fail(new GroceryItemAlreadyRemovedError({ groceryItemId: row.id })),
      })
    })

    const findListedGroceryItemByName = Effect.fn("MemoryGroceryItemRepository.findListedGroceryItemByName")(
      function* ({ name }: { readonly name: GroceryItemName }) {
        const currentState = yield* Ref.get(state)
        return Option.flatMap(listedRowWithSameName({ state: currentState, name }), listedGroceryItemFromRow)
      },
    )

    const writeRow = <E>(rowFromState: (currentState: GroceryItemRowsState) => Result.Result<Omit<GroceryItemRow, "seq">, E>) =>
      Ref.modify(state, (currentState): readonly [Result.Result<GroceryItemSeq, E>, GroceryItemRowsState] =>
        Result.match(rowFromState(currentState), {
          onFailure: (error) => [Result.fail(error), currentState],
          onSuccess: (row) => {
            const seq = GroceryItemSeq.make(currentState.lastSeq + 1)
            const rowsById = new Map(currentState.rowsById).set(row.id, { ...row, seq })
            return [Result.succeed(seq), { rowsById, lastSeq: seq }]
          },
        }),
      ).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.flatMap((seq) => PubSub.publish(writtenSeqs, seq)),
        Effect.asVoid,
      )

    const writeGroceryItemEvent = matchTag<GroceryItemEvent>()<{
      readonly [Tag in GroceryItemEvent["_tag"]]: Effect.Effect<void, GroceryItemEventWriteErrors[Tag]>
    }>({
      GroceryItemAddedEvent: (event) =>
        writeRow((currentState) => {
          if (currentState.rowsById.has(event.groceryItemId)) {
            return Result.fail<GroceryItemAlreadyExistsError | GroceryItemNameTakenError>(
              new GroceryItemAlreadyExistsError({ groceryItemId: event.groceryItemId }),
            )
          }
          if (isNameTakenByAnotherItem({ state: currentState, name: event.name, groceryItemId: event.groceryItemId })) {
            return Result.fail(new GroceryItemNameTakenError({ name: event.name }))
          }
          return Result.succeed({
            id: event.groceryItemId,
            name: event.name,
            status: { _tag: "Unchecked" } as const,
            addedAt: event.occurredOn,
          })
        }),
      GroceryItemRenamedEvent: (event) =>
        writeRow((currentState) => {
          const row = currentState.rowsById.get(event.groceryItemId)
          if (row === undefined || row.status._tag === "Removed" || row.name !== event.previousName) {
            return Result.fail<GroceryItemChangedConcurrentlyError | GroceryItemNameTakenError>(
              new GroceryItemChangedConcurrentlyError({ groceryItemId: event.groceryItemId }),
            )
          }
          if (isNameTakenByAnotherItem({ state: currentState, name: event.name, groceryItemId: event.groceryItemId })) {
            return Result.fail(new GroceryItemNameTakenError({ name: event.name }))
          }
          return Result.succeed({ ...row, name: event.name })
        }),
      GroceryItemCheckedEvent: (event) =>
        writeRow((currentState) => {
          const row = currentState.rowsById.get(event.groceryItemId)
          if (row === undefined || row.status._tag !== "Unchecked") {
            return Result.fail(new GroceryItemChangedConcurrentlyError({ groceryItemId: event.groceryItemId }))
          }
          return Result.succeed({ ...row, status: { _tag: "Checked", checkedAt: event.occurredOn } as const })
        }),
      GroceryItemUncheckedEvent: (event) =>
        writeRow((currentState) => {
          const row = currentState.rowsById.get(event.groceryItemId)
          if (row === undefined || row.status._tag !== "Checked") {
            return Result.fail(new GroceryItemChangedConcurrentlyError({ groceryItemId: event.groceryItemId }))
          }
          return Result.succeed({ ...row, status: { _tag: "Unchecked" } as const })
        }),
      GroceryItemRemovedEvent: (event) =>
        writeRow((currentState) => {
          const row = currentState.rowsById.get(event.groceryItemId)
          if (row === undefined || row.status._tag === "Removed") {
            return Result.fail(new GroceryItemChangedConcurrentlyError({ groceryItemId: event.groceryItemId }))
          }
          return Result.succeed({ ...row, status: { _tag: "Removed", removedAt: event.occurredOn } as const })
        }),
    })

    const publishGroceryItemEvent = Effect.fn("MemoryGroceryItemRepository.publishGroceryItemEvent")(function* <
      Tag extends GroceryItemEvent["_tag"],
    >(event: MemberWithTag<GroceryItemEvent, Tag>) {
      yield* writeGroceryItemEvent(event)
    })

    return GroceryItemRepository.of({
      findListedGroceryItemById,
      findUncheckedGroceryItemById,
      findCheckedGroceryItemById,
      findListedGroceryItemByName,
      publishGroceryItemEvent,
    })
  }),
)
