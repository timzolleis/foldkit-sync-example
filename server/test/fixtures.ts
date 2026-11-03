import { DateTime, Effect, Exit, Layer, Option } from "effect"
import { CheckedGroceryItem, UncheckedGroceryItem } from "../src/grocery-item/domain/grocery-item.ts"
import { generateGroceryItemId } from "../src/grocery-item/domain/grocery-item-id.ts"
import { GroceryItemName } from "../src/grocery-item/domain/grocery-item-name.ts"
import { GroceryItemRows } from "../src/grocery-item/infrastructure/grocery-item-rows.ts"
import { MemoryGroceryItemRepository } from "../src/grocery-item/infrastructure/memory-grocery-item-repository.ts"
import { MemoryGroceryItemViews } from "../src/grocery-item/infrastructure/memory-grocery-item-views.ts"

export const tuesdayMorning = DateTime.makeUnsafe("2026-11-03T09:10:00Z")
export const tuesdayEvening = DateTime.makeUnsafe("2026-11-03T17:42:00Z")

export const name = (text: string) => GroceryItemName.make(text)

export const makeUncheckedGroceryItem = (text: string) =>
  UncheckedGroceryItem.make({ groceryItemId: generateGroceryItemId(), name: name(text), addedAt: tuesdayMorning })

export const makeCheckedGroceryItem = (text: string) =>
  CheckedGroceryItem.make({
    groceryItemId: generateGroceryItemId(),
    name: name(text),
    addedAt: tuesdayMorning,
    checkedAt: tuesdayEvening,
  })

export const none = Option.none()

export const MemoryGroceryItemLayer = Layer.mergeAll(MemoryGroceryItemRepository, MemoryGroceryItemViews).pipe(
  Layer.provideMerge(GroceryItemRows.layer),
)

export const outcome = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) =>
    Exit.match(exit, {
      onSuccess: () => "ok",
      onFailure: (cause) => (cause.reasons[0]?._tag === "Fail" ? (cause.reasons[0].error as E)._tag : "die"),
    }),
  )
