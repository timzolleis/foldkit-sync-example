import { describe, expect, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { Etag, HttpPlatform } from "effect/http"
import { HttpApiTest } from "effect/http-api"
import { generateGroceryItemId } from "../src/grocery-item/domain/grocery-item-id.ts"
import { GroceryApi } from "../src/grocery-item/http/grocery-item-api.ts"
import { GroceryItemLayer } from "../src/server.ts"
import { name } from "./fixtures.ts"

const TestServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

const groceryClient = HttpApiTest.groups(GroceryApi, ["groceryItems"]).pipe(Effect.provide(GroceryItemLayer))

describe("GroceryItemController", () => {
  it.layer(TestServices)((it) => {
    it.effect("answers a retried add with the item it added", () =>
      Effect.gen(function* () {
        const client = yield* groceryClient
        const groceryItemId = generateGroceryItemId()
        const added = yield* client.groceryItems.addGroceryItem({ payload: { groceryItemId, name: name("Milk") } })
        const retried = yield* client.groceryItems.addGroceryItem({ payload: { groceryItemId, name: name("Milk") } })
        expect(retried).toEqual(added)
      }),
    )

    it.effect("refuses an add that reuses another item's id under a new name", () =>
      Effect.gen(function* () {
        const client = yield* groceryClient
        const groceryItemId = generateGroceryItemId()
        yield* client.groceryItems.addGroceryItem({ payload: { groceryItemId, name: name("Milk") } })
        const refused = yield* client.groceryItems
          .addGroceryItem({ payload: { groceryItemId, name: name("Eggs") } })
          .pipe(Effect.flip)
        expect(refused._tag).toBe("GroceryItemAlreadyExistsHttpError")
      }),
    )

    it.effect("answers a second check with the item as it was checked first", () =>
      Effect.gen(function* () {
        const client = yield* groceryClient
        const groceryItemId = generateGroceryItemId()
        yield* client.groceryItems.addGroceryItem({ payload: { groceryItemId, name: name("Milk") } })
        const checked = yield* client.groceryItems.checkGroceryItem({ params: { groceryItemId } })
        const checkedAgain = yield* client.groceryItems.checkGroceryItem({ params: { groceryItemId } })
        expect(checkedAgain).toEqual(checked)
      }),
    )
  })
})
