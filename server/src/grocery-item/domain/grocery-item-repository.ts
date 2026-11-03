import { Context, type Effect, type Option } from "effect"
import type { ExhaustiveRecord } from "../../lib/exhaustive-record.ts"
import type { MemberWithTag } from "../../lib/match-tag.ts"
import type { CheckedGroceryItem, ListedGroceryItem, UncheckedGroceryItem } from "./grocery-item.ts"
import type {
  GroceryItemAlreadyCheckedError,
  GroceryItemAlreadyExistsError,
  GroceryItemAlreadyRemovedError,
  GroceryItemAlreadyUncheckedError,
  GroceryItemChangedConcurrentlyError,
  GroceryItemNameTakenError,
  GroceryItemNotFoundError,
} from "./grocery-item-error.ts"
import type { GroceryItemEvent } from "./grocery-item-event.ts"
import type { GroceryItemId } from "./grocery-item-id.ts"
import type { GroceryItemName } from "./grocery-item-name.ts"

export type FindGroceryItemByIdInput = { readonly groceryItemId: GroceryItemId }

export type GroceryItemEventWriteErrors = ExhaustiveRecord<
  GroceryItemEvent["_tag"],
  {
    GroceryItemAddedEvent: GroceryItemAlreadyExistsError | GroceryItemNameTakenError
    GroceryItemRenamedEvent: GroceryItemChangedConcurrentlyError | GroceryItemNameTakenError
    GroceryItemCheckedEvent: GroceryItemChangedConcurrentlyError
    GroceryItemUncheckedEvent: GroceryItemChangedConcurrentlyError
    GroceryItemRemovedEvent: GroceryItemChangedConcurrentlyError
  }
>

export class GroceryItemRepository extends Context.Service<
  GroceryItemRepository,
  {
    findListedGroceryItemById(
      input: FindGroceryItemByIdInput,
    ): Effect.Effect<ListedGroceryItem, GroceryItemNotFoundError | GroceryItemAlreadyRemovedError>
    findUncheckedGroceryItemById(
      input: FindGroceryItemByIdInput,
    ): Effect.Effect<
      UncheckedGroceryItem,
      GroceryItemNotFoundError | GroceryItemAlreadyCheckedError | GroceryItemAlreadyRemovedError
    >
    findCheckedGroceryItemById(
      input: FindGroceryItemByIdInput,
    ): Effect.Effect<
      CheckedGroceryItem,
      GroceryItemNotFoundError | GroceryItemAlreadyUncheckedError | GroceryItemAlreadyRemovedError
    >
    findListedGroceryItemByName(input: { readonly name: GroceryItemName }): Effect.Effect<Option.Option<ListedGroceryItem>>
    publishGroceryItemEvent<Tag extends GroceryItemEvent["_tag"]>(
      event: MemberWithTag<GroceryItemEvent, Tag>,
    ): Effect.Effect<void, GroceryItemEventWriteErrors[Tag]>
  }
>()("GroceryItemRepository") {}
