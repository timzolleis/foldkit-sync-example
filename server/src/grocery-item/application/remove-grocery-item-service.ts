import { Context, DateTime, Effect, Layer } from "effect"
import { removeGroceryItem } from "../domain/grocery-item.ts"
import type {
  GroceryItemAlreadyRemovedError,
  GroceryItemChangedConcurrentlyError,
  GroceryItemNotFoundError,
} from "../domain/grocery-item-error.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import { GroceryItemRepository } from "../domain/grocery-item-repository.ts"

export type RemoveGroceryItemCommand = { readonly groceryItemId: GroceryItemId }

export class RemoveGroceryItemService extends Context.Service<
  RemoveGroceryItemService,
  {
    removeGroceryItem(
      command: RemoveGroceryItemCommand,
    ): Effect.Effect<
      void,
      GroceryItemNotFoundError | GroceryItemAlreadyRemovedError | GroceryItemChangedConcurrentlyError
    >
  }
>()("RemoveGroceryItemService") {
  static readonly layer = Layer.effect(
    RemoveGroceryItemService,
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      return RemoveGroceryItemService.of({
        removeGroceryItem: Effect.fn("RemoveGroceryItemService.removeGroceryItem")(function* ({ groceryItemId }) {
          const now = yield* DateTime.now
          const item = yield* groceryItemRepository.findListedGroceryItemById({ groceryItemId })
          const event = yield* Effect.fromResult(removeGroceryItem({ item, now }))
          yield* groceryItemRepository.publishGroceryItemEvent(event)
        }),
      })
    }),
  )
}
