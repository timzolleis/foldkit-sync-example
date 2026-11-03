import { Schema } from "effect"
import { matchTag } from "../../lib/match-tag.ts"
import { messageWithDefault } from "../../lib/message-with-default.ts"
import type {
  GroceryItemAlreadyCheckedError,
  GroceryItemAlreadyUncheckedError,
  GroceryItemError,
} from "../domain/grocery-item-error.ts"

export class GroceryItemNotFoundHttpError extends Schema.TaggedError<GroceryItemNotFoundHttpError>()(
  "GroceryItemNotFoundHttpError",
  { message: messageWithDefault("This item isn't on the list.") },
  { httpApiStatus: 404 },
) {}

export class GroceryItemAlreadyRemovedHttpError extends Schema.TaggedError<GroceryItemAlreadyRemovedHttpError>()(
  "GroceryItemAlreadyRemovedHttpError",
  { message: messageWithDefault("This item was removed from the list.") },
  { httpApiStatus: 409 },
) {}

export class GroceryItemNameTakenHttpError extends Schema.TaggedError<GroceryItemNameTakenHttpError>()(
  "GroceryItemNameTakenHttpError",
  { message: messageWithDefault("An item with this name is already on the list.") },
  { httpApiStatus: 409 },
) {}

export class GroceryItemAlreadyExistsHttpError extends Schema.TaggedError<GroceryItemAlreadyExistsHttpError>()(
  "GroceryItemAlreadyExistsHttpError",
  { message: messageWithDefault("Another item already has this id.") },
  { httpApiStatus: 409 },
) {}

export class GroceryItemChangedConcurrentlyHttpError extends Schema.TaggedError<GroceryItemChangedConcurrentlyHttpError>()(
  "GroceryItemChangedConcurrentlyHttpError",
  { message: messageWithDefault("This item changed on another device. Try again.") },
  { httpApiStatus: 409 },
) {}

// Check and uncheck are retry-safe: the controller catches AlreadyChecked and AlreadyUnchecked, so they never reach HTTP.
type GroceryItemErrorReachingHttp = Exclude<
  GroceryItemError,
  GroceryItemAlreadyCheckedError | GroceryItemAlreadyUncheckedError
>

export const groceryItemHttpErrorFromGroceryItemError = matchTag<GroceryItemErrorReachingHttp>()({
  GroceryItemNotFoundError: () => new GroceryItemNotFoundHttpError(),
  GroceryItemAlreadyRemovedError: () => new GroceryItemAlreadyRemovedHttpError(),
  GroceryItemNameTakenError: () => new GroceryItemNameTakenHttpError(),
  GroceryItemAlreadyExistsError: () => new GroceryItemAlreadyExistsHttpError(),
  GroceryItemChangedConcurrentlyError: () => new GroceryItemChangedConcurrentlyHttpError(),
})
