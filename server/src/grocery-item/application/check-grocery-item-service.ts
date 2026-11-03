import { Context, DateTime, Effect, Layer } from "effect"
import { checkGroceryItem } from "../domain/grocery-item.ts"
import type {
  GroceryItemAlreadyCheckedError,
  GroceryItemAlreadyRemovedError,
  GroceryItemChangedConcurrentlyError,
  GroceryItemNotFoundError,
} from "../domain/grocery-item-error.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import { GroceryItemRepository } from "../domain/grocery-item-repository.ts"

export type CheckGroceryItemCommand = { readonly groceryItemId: GroceryItemId }

export class CheckGroceryItemService extends Context.Service<
  CheckGroceryItemService,
  {
    checkGroceryItem(
      command: CheckGroceryItemCommand,
    ): Effect.Effect<
      void,
      | GroceryItemNotFoundError
      | GroceryItemAlreadyCheckedError
      | GroceryItemAlreadyRemovedError
      | GroceryItemChangedConcurrentlyError
    >
  }
>()("CheckGroceryItemService") {
  static readonly layer = Layer.effect(
    CheckGroceryItemService,
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      return CheckGroceryItemService.of({
        checkGroceryItem: Effect.fn("CheckGroceryItemService.checkGroceryItem")(function* ({ groceryItemId }) {
          const now = yield* DateTime.now
          const item = yield* groceryItemRepository.findUncheckedGroceryItemById({ groceryItemId })
          const event = yield* Effect.fromResult(checkGroceryItem({ item, now }))
          yield* groceryItemRepository.publishGroceryItemEvent(event)
        }),
      })
    }),
  )
}
