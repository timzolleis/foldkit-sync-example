import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { AddGroceryItemService } from "../application/add-grocery-item-service.ts"
import { CheckGroceryItemService } from "../application/check-grocery-item-service.ts"
import { RemoveGroceryItemService } from "../application/remove-grocery-item-service.ts"
import { RenameGroceryItemService } from "../application/rename-grocery-item-service.ts"
import { UncheckGroceryItemService } from "../application/uncheck-grocery-item-service.ts"
import { GroceryItemViews } from "../view/grocery-item-views.ts"
import { GroceryApi } from "./grocery-item-api.ts"
import { groceryItemHttpErrorFromGroceryItemError } from "./grocery-item-http-errors.ts"

export const GroceryItemController = HttpApiBuilder.group(
  GroceryApi,
  "groceryItems",
  Effect.fn(function* (handlers) {
    const addGroceryItemService = yield* AddGroceryItemService
    const renameGroceryItemService = yield* RenameGroceryItemService
    const checkGroceryItemService = yield* CheckGroceryItemService
    const uncheckGroceryItemService = yield* UncheckGroceryItemService
    const removeGroceryItemService = yield* RemoveGroceryItemService
    const groceryItemViews = yield* GroceryItemViews

    return handlers.handleAll({
      addGroceryItem: ({ payload }) =>
        addGroceryItemService.addGroceryItem({ groceryItemId: payload.groceryItemId, name: payload.name }).pipe(
          Effect.andThen(groceryItemViews.getGroceryItemById({ groceryItemId: payload.groceryItemId })),
          Effect.catchTag("GroceryItemAlreadyExistsError", (alreadyExists) =>
            groceryItemViews
              .getGroceryItemById({ groceryItemId: payload.groceryItemId })
              .pipe(
                Effect.filterOrFail(
                  (existingItem) => existingItem.name === payload.name,
                  () => alreadyExists,
                ),
              ),
          ),
          Effect.mapError(groceryItemHttpErrorFromGroceryItemError),
        ),
      renameGroceryItem: ({ params, payload }) =>
        renameGroceryItemService.renameGroceryItem({ groceryItemId: params.groceryItemId, name: payload.name }).pipe(
          Effect.andThen(groceryItemViews.getGroceryItemById({ groceryItemId: params.groceryItemId })),
          Effect.mapError(groceryItemHttpErrorFromGroceryItemError),
        ),
      checkGroceryItem: ({ params }) =>
        checkGroceryItemService.checkGroceryItem({ groceryItemId: params.groceryItemId }).pipe(
          Effect.catchTag("GroceryItemAlreadyCheckedError", () => Effect.void),
          Effect.andThen(groceryItemViews.getGroceryItemById({ groceryItemId: params.groceryItemId })),
          Effect.mapError(groceryItemHttpErrorFromGroceryItemError),
        ),
      uncheckGroceryItem: ({ params }) =>
        uncheckGroceryItemService.uncheckGroceryItem({ groceryItemId: params.groceryItemId }).pipe(
          Effect.catchTag("GroceryItemAlreadyUncheckedError", () => Effect.void),
          Effect.andThen(groceryItemViews.getGroceryItemById({ groceryItemId: params.groceryItemId })),
          Effect.mapError(groceryItemHttpErrorFromGroceryItemError),
        ),
      removeGroceryItem: ({ params }) =>
        removeGroceryItemService.removeGroceryItem({ groceryItemId: params.groceryItemId }).pipe(
          Effect.catchTag("GroceryItemAlreadyRemovedError", () => Effect.void),
          Effect.andThen(groceryItemViews.getGroceryItemById({ groceryItemId: params.groceryItemId })),
          Effect.mapError(groceryItemHttpErrorFromGroceryItemError),
        ),
      listGroceryItems: ({ query }) => groceryItemViews.listGroceryItems({ afterSeq: query.afterSeq }),
      streamGroceryItems: ({ query }) => Effect.succeed(groceryItemViews.streamGroceryItems({ afterSeq: query.afterSeq })),
    })
  }),
)
