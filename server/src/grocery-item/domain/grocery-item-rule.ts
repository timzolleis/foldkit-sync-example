import { Option, Result } from "effect"
import type { AddGroceryItemInput, ListedGroceryItem, RenameGroceryItemInput } from "./grocery-item.ts"
import { GroceryItemNameTakenError } from "./grocery-item-error.ts"
import type { GroceryItemId } from "./grocery-item-id.ts"
import type { GroceryItemName } from "./grocery-item-name.ts"

export const nameMustBeFreeRule = (input: {
  readonly groceryItemId: GroceryItemId
  readonly name: GroceryItemName
  readonly itemWithSameName: Option.Option<ListedGroceryItem>
}): Result.Result<void, GroceryItemNameTakenError> =>
  Option.match(input.itemWithSameName, {
    onNone: () => Result.succeed(undefined),
    onSome: (itemWithSameName) =>
      itemWithSameName.groceryItemId === input.groceryItemId
        ? Result.succeed(undefined)
        : Result.fail(new GroceryItemNameTakenError({ name: input.name })),
  })

export type AddGroceryItemRule = (input: AddGroceryItemInput) => Result.Result<void, GroceryItemNameTakenError>
export const addGroceryItemRules: ReadonlyArray<AddGroceryItemRule> = [nameMustBeFreeRule]

export type RenameGroceryItemRule = (input: RenameGroceryItemInput) => Result.Result<void, GroceryItemNameTakenError>
export const renameGroceryItemRules: ReadonlyArray<RenameGroceryItemRule> = [
  (input) =>
    nameMustBeFreeRule({ groceryItemId: input.item.groceryItemId, name: input.name, itemWithSameName: input.itemWithSameName }),
]
