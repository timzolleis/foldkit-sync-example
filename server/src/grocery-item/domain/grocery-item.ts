import { type DateTime, type Option, Result, Schema } from "effect"
import { checkRules } from "../../lib/check-rules.ts"
import type { GroceryItemNameTakenError } from "./grocery-item-error.ts"
import {
  GroceryItemAddedEvent,
  GroceryItemCheckedEvent,
  GroceryItemRemovedEvent,
  GroceryItemRenamedEvent,
  GroceryItemUncheckedEvent,
} from "./grocery-item-event.ts"
import { GroceryItemId } from "./grocery-item-id.ts"
import { GroceryItemName } from "./grocery-item-name.ts"
import { addGroceryItemRules, renameGroceryItemRules } from "./grocery-item-rule.ts"

const groceryItemFields = { groceryItemId: GroceryItemId, name: GroceryItemName, addedAt: Schema.DateTimeUtc }

export const UncheckedGroceryItem = Schema.TaggedStruct("UncheckedGroceryItem", { ...groceryItemFields })
export type UncheckedGroceryItem = typeof UncheckedGroceryItem.Type

export const CheckedGroceryItem = Schema.TaggedStruct("CheckedGroceryItem", {
  ...groceryItemFields,
  checkedAt: Schema.DateTimeUtc,
})
export type CheckedGroceryItem = typeof CheckedGroceryItem.Type

export type ListedGroceryItem = UncheckedGroceryItem | CheckedGroceryItem

export type AddGroceryItemInput = {
  readonly groceryItemId: GroceryItemId
  readonly name: GroceryItemName
  readonly itemWithSameName: Option.Option<ListedGroceryItem>
  readonly now: DateTime.Utc
}

export type RenameGroceryItemInput = {
  readonly item: ListedGroceryItem
  readonly name: GroceryItemName
  readonly itemWithSameName: Option.Option<ListedGroceryItem>
  readonly now: DateTime.Utc
}

export type CheckGroceryItemInput = { readonly item: UncheckedGroceryItem; readonly now: DateTime.Utc }
export type UncheckGroceryItemInput = { readonly item: CheckedGroceryItem; readonly now: DateTime.Utc }
export type RemoveGroceryItemInput = { readonly item: ListedGroceryItem; readonly now: DateTime.Utc }

export const addGroceryItem = (
  input: AddGroceryItemInput,
): Result.Result<GroceryItemAddedEvent, GroceryItemNameTakenError> =>
  Result.gen(function* () {
    yield* checkRules(addGroceryItemRules, input)
    return GroceryItemAddedEvent.make({ groceryItemId: input.groceryItemId, name: input.name, occurredOn: input.now })
  })

export const renameGroceryItem = (
  input: RenameGroceryItemInput,
): Result.Result<GroceryItemRenamedEvent, GroceryItemNameTakenError> =>
  Result.gen(function* () {
    yield* checkRules(renameGroceryItemRules, input)
    return GroceryItemRenamedEvent.make({
      groceryItemId: input.item.groceryItemId,
      name: input.name,
      previousName: input.item.name,
      occurredOn: input.now,
    })
  })

export const checkGroceryItem = (input: CheckGroceryItemInput): Result.Result<GroceryItemCheckedEvent, never> =>
  Result.succeed(GroceryItemCheckedEvent.make({ groceryItemId: input.item.groceryItemId, occurredOn: input.now }))

export const uncheckGroceryItem = (input: UncheckGroceryItemInput): Result.Result<GroceryItemUncheckedEvent, never> =>
  Result.succeed(GroceryItemUncheckedEvent.make({ groceryItemId: input.item.groceryItemId, occurredOn: input.now }))

export const removeGroceryItem = (input: RemoveGroceryItemInput): Result.Result<GroceryItemRemovedEvent, never> =>
  Result.succeed(GroceryItemRemovedEvent.make({ groceryItemId: input.item.groceryItemId, occurredOn: input.now }))
