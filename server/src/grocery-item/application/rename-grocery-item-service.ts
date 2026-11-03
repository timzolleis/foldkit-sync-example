import { Context, DateTime, Effect, Layer } from "effect"
import { renameGroceryItem } from "../domain/grocery-item.ts"
import type {
  GroceryItemAlreadyRemovedError,
  GroceryItemChangedConcurrentlyError,
  GroceryItemNameTakenError,
  GroceryItemNotFoundError,
} from "../domain/grocery-item-error.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import type { GroceryItemName } from "../domain/grocery-item-name.ts"
import { GroceryItemRepository } from "../domain/grocery-item-repository.ts"

export type RenameGroceryItemCommand = { readonly groceryItemId: GroceryItemId; readonly name: GroceryItemName }

export class RenameGroceryItemService extends Context.Service<
  RenameGroceryItemService,
  {
    renameGroceryItem(
      command: RenameGroceryItemCommand,
    ): Effect.Effect<
      void,
      | GroceryItemNotFoundError
      | GroceryItemAlreadyRemovedError
      | GroceryItemNameTakenError
      | GroceryItemChangedConcurrentlyError
    >
  }
>()("RenameGroceryItemService") {
  static readonly layer = Layer.effect(
    RenameGroceryItemService,
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      return RenameGroceryItemService.of({
        renameGroceryItem: Effect.fn("RenameGroceryItemService.renameGroceryItem")(function* ({ groceryItemId, name }) {
          const now = yield* DateTime.now
          const item = yield* groceryItemRepository.findListedGroceryItemById({ groceryItemId })
          const itemWithSameName = yield* groceryItemRepository.findListedGroceryItemByName({ name })
          const event = yield* Effect.fromResult(renameGroceryItem({ item, name, itemWithSameName, now }))
          yield* groceryItemRepository.publishGroceryItemEvent(event)
        }),
      })
    }),
  )
}
