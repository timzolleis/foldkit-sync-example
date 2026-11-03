import { Option, Result } from "effect"
import { describe, expect, it } from "vitest"
import { nameMustBeFreeRule } from "../src/grocery-item/domain/grocery-item-rule.ts"
import { generateGroceryItemId } from "../src/grocery-item/domain/grocery-item-id.ts"
import { makeCheckedGroceryItem, makeUncheckedGroceryItem, name } from "./fixtures.ts"

const failureTag = (result: Result.Result<unknown, { readonly _tag: string }>) =>
  Result.isFailure(result) ? result.failure._tag : "ok"

describe("nameMustBeFreeRule", () => {
  it("lets an item be added when no listed item has the name", () => {
    expect(
      failureTag(
        nameMustBeFreeRule({ groceryItemId: generateGroceryItemId(), name: name("Oat milk"), itemWithSameName: Option.none() }),
      ),
    ).toBe("ok")
  })

  it("refuses an add when another listed item has the name", () => {
    const milk = makeUncheckedGroceryItem("Milk")
    expect(
      failureTag(
        nameMustBeFreeRule({ groceryItemId: generateGroceryItemId(), name: name("milk"), itemWithSameName: Option.some(milk) }),
      ),
    ).toBe("GroceryItemNameTakenError")
  })

  it("refuses a rename to the name of a checked-off item", () => {
    const milk = makeCheckedGroceryItem("Milk")
    const eggs = makeUncheckedGroceryItem("Eggs")
    expect(
      failureTag(nameMustBeFreeRule({ groceryItemId: eggs.groceryItemId, name: name("MILK"), itemWithSameName: Option.some(milk) })),
    ).toBe("GroceryItemNameTakenError")
  })

  it("lets an item be renamed to its own name in another case", () => {
    const milk = makeUncheckedGroceryItem("Milk")
    expect(
      failureTag(nameMustBeFreeRule({ groceryItemId: milk.groceryItemId, name: name("milk"), itemWithSameName: Option.some(milk) })),
    ).toBe("ok")
  })
})
