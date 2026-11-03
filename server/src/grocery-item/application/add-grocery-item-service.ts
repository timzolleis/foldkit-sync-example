import { Context, DateTime, Effect, Layer } from "effect"
import { addGroceryItem } from "../domain/grocery-item.ts"
import type { GroceryItemAlreadyExistsError, GroceryItemNameTakenError } from "../domain/grocery-item-error.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import type { GroceryItemName } from "../domain/grocery-item-name.ts"
import { GroceryItemRepository } from "../domain/grocery-item-repository.ts"

export type AddGroceryItemCommand = { readonly groceryItemId: GroceryItemId; readonly name: GroceryItemName }

export class AddGroceryItemService extends Context.Service<
  AddGroceryItemService,
  {
    addGroceryItem(
      command: AddGroceryItemCommand,
    ): Effect.Effect<void, GroceryItemNameTakenError | GroceryItemAlreadyExistsError>
  }
>()("AddGroceryItemService") {
  static readonly layer = Layer.effect(
    AddGroceryItemService,
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      return AddGroceryItemService.of({
        addGroceryItem: Effect.fn("AddGroceryItemService.addGroceryItem")(function* ({ groceryItemId, name }) {
          const now = yield* DateTime.now
          const itemWithSameName = yield* groceryItemRepository.findListedGroceryItemByName({ name })
          const event = yield* Effect.fromResult(addGroceryItem({ groceryItemId, name, itemWithSameName, now }))
          yield* groceryItemRepository.publishGroceryItemEvent(event)
        }),
      })
    }),
  )
}
