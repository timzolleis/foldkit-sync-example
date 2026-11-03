import { Option } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { modifyFields } from "foldkit/struct"
import { generateGroceryItemId } from "grocery-server/grocery-item/domain/grocery-item-id.ts"
import { GroceryItemName } from "grocery-server/grocery-item/domain/grocery-item-name.ts"
import { describe, expect, test } from "vitest"
import { GroceryListSyncStatus } from "./grocery-store.ts"
import {
  AddGroceryItem,
  CheckGroceryItem,
  type GroceryItemRow,
  Message,
  type Model,
  RenameGroceryItem,
  UncheckGroceryItem,
  update,
} from "./main.ts"

const milk: GroceryItemRow = {
  groceryItemId: generateGroceryItemId(),
  name: GroceryItemName.make("Milk"),
  checked: false,
  isSaving: false,
}
const eggs: GroceryItemRow = { ...milk, groceryItemId: generateGroceryItemId(), name: GroceryItemName.make("Eggs"), checked: true }

const listModel: Model = {
  groceryItems: [milk, eggs],
  syncStatus: GroceryListSyncStatus.Live(),
  newItemName: "",
  renameDraft: Option.none(),
  undoneWrite: Option.none(),
}

describe("update", () => {
  test("sends nothing for a blank name", () => {
    story(
      update,
      given(modifyFields(listModel, { newItemName: () => "   " })),
      message(Message.SubmittedNewItem()),
      Command.expectNone(),
    )
  })

  test("adds a trimmed name and clears the field", () => {
    story(
      update,
      given(modifyFields(listModel, { newItemName: () => "  Oat milk " })),
      message(Message.SubmittedNewItem()),
      Command.expectExact(AddGroceryItem({ name: GroceryItemName.make("Oat milk") })),
      Command.resolve(AddGroceryItem, Message.ConfirmedGroceryItemWrite()),
      model((next) => expect(next.newItemName).toBe("")),
    )
  })

  test("checks off an unchecked item and unchecks a checked one", () => {
    story(
      update,
      given(listModel),
      message(Message.ClickedCheckbox({ groceryItemId: milk.groceryItemId })),
      Command.expectExact(CheckGroceryItem({ groceryItemId: milk.groceryItemId })),
      Command.resolve(CheckGroceryItem, Message.ConfirmedGroceryItemWrite()),
      message(Message.ClickedCheckbox({ groceryItemId: eggs.groceryItemId })),
      Command.expectExact(UncheckGroceryItem({ groceryItemId: eggs.groceryItemId })),
      Command.resolve(UncheckGroceryItem, Message.ConfirmedGroceryItemWrite()),
    )
  })

  test("renames only when the name changed", () => {
    story(
      update,
      given(listModel),
      message(Message.ClickedGroceryItemName({ groceryItemId: milk.groceryItemId })),
      message(Message.SubmittedRename()),
      Command.expectNone(),
      message(Message.ClickedGroceryItemName({ groceryItemId: milk.groceryItemId })),
      message(Message.UpdatedDraftName({ value: "Oat milk" })),
      message(Message.SubmittedRename()),
      Command.expectExact(RenameGroceryItem({ groceryItemId: milk.groceryItemId, name: GroceryItemName.make("Oat milk") })),
      Command.resolve(RenameGroceryItem, Message.ConfirmedGroceryItemWrite()),
      model((next) => expect(Option.isNone(next.renameDraft)).toBe(true)),
    )
  })

  test("shows why a write was undone until the next write", () => {
    story(
      update,
      given(listModel),
      message(Message.UndidGroceryItemWrite({ reason: "An item with this name is already on the list." })),
      model((next) => expect(next.undoneWrite).toEqual(Option.some("An item with this name is already on the list."))),
      message(Message.ClickedCheckbox({ groceryItemId: milk.groceryItemId })),
      Command.resolve(CheckGroceryItem, Message.ConfirmedGroceryItemWrite()),
      model((next) => expect(Option.isNone(next.undoneWrite)).toBe(true)),
    )
  })
})
