import { Data } from "effect"
import type { GroceryItemId } from "./grocery-item-id.ts"
import type { GroceryItemName } from "./grocery-item-name.ts"

export class GroceryItemNotFoundError extends Data.TaggedError("GroceryItemNotFoundError")<{
  readonly groceryItemId: GroceryItemId
}> {}

export class GroceryItemAlreadyCheckedError extends Data.TaggedError("GroceryItemAlreadyCheckedError")<{
  readonly groceryItemId: GroceryItemId
}> {}

export class GroceryItemAlreadyUncheckedError extends Data.TaggedError("GroceryItemAlreadyUncheckedError")<{
  readonly groceryItemId: GroceryItemId
}> {}

export class GroceryItemAlreadyRemovedError extends Data.TaggedError("GroceryItemAlreadyRemovedError")<{
  readonly groceryItemId: GroceryItemId
}> {}

export class GroceryItemNameTakenError extends Data.TaggedError("GroceryItemNameTakenError")<{
  readonly name: GroceryItemName
}> {}

export class GroceryItemAlreadyExistsError extends Data.TaggedError("GroceryItemAlreadyExistsError")<{
  readonly groceryItemId: GroceryItemId
}> {}

export class GroceryItemChangedConcurrentlyError extends Data.TaggedError("GroceryItemChangedConcurrentlyError")<{
  readonly groceryItemId: GroceryItemId
}> {}

export type GroceryItemError =
  | GroceryItemNotFoundError
  | GroceryItemAlreadyCheckedError
  | GroceryItemAlreadyUncheckedError
  | GroceryItemAlreadyRemovedError
  | GroceryItemNameTakenError
  | GroceryItemAlreadyExistsError
  | GroceryItemChangedConcurrentlyError
