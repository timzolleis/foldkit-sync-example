import { Context, DateTime, Effect, Layer } from "effect"
import { uncheckGroceryItem } from "../domain/grocery-item.ts"
import type {
  GroceryItemAlreadyUncheckedError,
  GroceryItemAlreadyRemovedError,
  GroceryItemChangedConcurrentlyError,
  GroceryItemNotFoundError,
} from "../domain/grocery-item-error.ts"
import type { GroceryItemId } from "../domain/grocery-item-id.ts"
import { GroceryItemRepository } from "../domain/grocery-item-repository.ts"

export type UncheckGroceryItemCommand = { readonly groceryItemId: GroceryItemId }

export class UncheckGroceryItemService extends Context.Service<
  UncheckGroceryItemService,
  {
    uncheckGroceryItem(
      command: UncheckGroceryItemCommand,
    ): Effect.Effect<
      void,
      | GroceryItemNotFoundError
      | GroceryItemAlreadyUncheckedError
      | GroceryItemAlreadyRemovedError
      | GroceryItemChangedConcurrentlyError
    >
  }
>()("UncheckGroceryItemService") {
  static readonly layer = Layer.effect(
    UncheckGroceryItemService,
    Effect.gen(function* () {
      const groceryItemRepository = yield* GroceryItemRepository
      return UncheckGroceryItemService.of({
        uncheckGroceryItem: Effect.fn("UncheckGroceryItemService.uncheckGroceryItem")(function* ({ groceryItemId }) {
          const now = yield* DateTime.now
          const item = yield* groceryItemRepository.findCheckedGroceryItemById({ groceryItemId })
          const event = yield* Effect.fromResult(uncheckGroceryItem({ item, now }))
          yield* groceryItemRepository.publishGroceryItemEvent(event)
        }),
      })
    }),
  )
}
