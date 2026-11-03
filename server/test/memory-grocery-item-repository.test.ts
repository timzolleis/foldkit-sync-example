import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  GroceryItemAddedEvent,
  GroceryItemRemovedEvent,
  GroceryItemRenamedEvent,
} from "../src/grocery-item/domain/grocery-item-event.ts"
import { generateGroceryItemId } from "../src/grocery-item/domain/grocery-item-id.ts"
import { GroceryItemRepository } from "../src/grocery-item/domain/grocery-item-repository.ts"
import { MemoryGroceryItemLayer, name, outcome, tuesdayEvening, tuesdayMorning } from "./fixtures.ts"

const addedEvent = (text: string) =>
  GroceryItemAddedEvent.make({ groceryItemId: generateGroceryItemId(), name: name(text), occurredOn: tuesdayMorning })

describe("MemoryGroceryItemRepository", () => {
  it.effect("refuses the second of two adds of the same name that both passed the rule", () =>
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      yield* groceryItemRepository.publishGroceryItemEvent(addedEvent("Milk"))
      expect(yield* outcome(groceryItemRepository.publishGroceryItemEvent(addedEvent("milk")))).toBe(
        "GroceryItemNameTakenError",
      )
    }).pipe(Effect.provide(MemoryGroceryItemLayer)),
  )

  it.effect("refuses a rename after another device renamed the item", () =>
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      const added = addedEvent("Milk")
      yield* groceryItemRepository.publishGroceryItemEvent(added)
      const renamedOn = (text: string) =>
        GroceryItemRenamedEvent.make({
          groceryItemId: added.groceryItemId,
          name: name(text),
          previousName: name("Milk"),
          occurredOn: tuesdayEvening,
        })
      yield* groceryItemRepository.publishGroceryItemEvent(renamedOn("Oat milk"))
      expect(yield* outcome(groceryItemRepository.publishGroceryItemEvent(renamedOn("Soy milk")))).toBe(
        "GroceryItemChangedConcurrentlyError",
      )
    }).pipe(Effect.provide(MemoryGroceryItemLayer)),
  )

  it.effect("finds no listed item by a name only a removed item had", () =>
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      const added = addedEvent("Milk")
      yield* groceryItemRepository.publishGroceryItemEvent(added)
      yield* groceryItemRepository.publishGroceryItemEvent(
        GroceryItemRemovedEvent.make({ groceryItemId: added.groceryItemId, occurredOn: tuesdayEvening }),
      )
      expect(Option.isNone(yield* groceryItemRepository.findListedGroceryItemByName({ name: name("Milk") }))).toBe(true)
      expect(yield* outcome(groceryItemRepository.publishGroceryItemEvent(addedEvent("Milk")))).toBe("ok")
    }).pipe(Effect.provide(MemoryGroceryItemLayer)),
  )
})
