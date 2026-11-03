import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import { GroceryItemAddedEvent, GroceryItemCheckedEvent } from "../src/grocery-item/domain/grocery-item-event.ts"
import { generateGroceryItemId } from "../src/grocery-item/domain/grocery-item-id.ts"
import { GroceryItemRepository } from "../src/grocery-item/domain/grocery-item-repository.ts"
import { GroceryItemSeq, GroceryItemViews } from "../src/grocery-item/view/grocery-item-views.ts"
import { MemoryGroceryItemLayer, name, tuesdayEvening, tuesdayMorning } from "./fixtures.ts"

const addedEvent = (text: string) =>
  GroceryItemAddedEvent.make({ groceryItemId: generateGroceryItemId(), name: name(text), occurredOn: tuesdayMorning })

describe("MemoryGroceryItemViews", () => {
  it.effect("lists only items changed after afterSeq, each at its latest seq", () =>
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      const groceryItemViews = yield* GroceryItemViews
      const milk = addedEvent("Milk")
      yield* groceryItemRepository.publishGroceryItemEvent(milk)
      yield* groceryItemRepository.publishGroceryItemEvent(addedEvent("Eggs"))
      yield* groceryItemRepository.publishGroceryItemEvent(
        GroceryItemCheckedEvent.make({ groceryItemId: milk.groceryItemId, occurredOn: tuesdayEvening }),
      )
      const groceryItems = yield* groceryItemViews.listGroceryItems({ afterSeq: GroceryItemSeq.make(2) })
      expect(groceryItems.items.map((item) => [item.name, item.seq])).toEqual([["Milk", 3]])
      expect(groceryItems.lastSeq).toBe(3)
    }).pipe(Effect.provide(MemoryGroceryItemLayer)),
  )

  it.effect("streams what is listed now, then each later write", () =>
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      const groceryItemViews = yield* GroceryItemViews
      yield* groceryItemRepository.publishGroceryItemEvent(addedEvent("Milk"))
      const batches = yield* groceryItemViews
        .streamGroceryItems({ afterSeq: GroceryItemSeq.make(0) })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow
      yield* groceryItemRepository.publishGroceryItemEvent(addedEvent("Eggs"))
      const collected = yield* Fiber.join(batches)
      expect(collected.map((batch) => batch.items.map((item) => item.name))).toEqual([["Milk"], ["Eggs"]])
    }).pipe(Effect.provide(MemoryGroceryItemLayer)),
  )
})
