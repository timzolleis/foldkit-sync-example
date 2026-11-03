import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { GroceryItemId } from "../domain/grocery-item-id.ts"
import { GroceryItemName } from "../domain/grocery-item-name.ts"
import { GroceryItemSeq, GroceryItemsView, GroceryItemView } from "../view/grocery-item-views.ts"
import {
  GroceryItemAlreadyExistsHttpError,
  GroceryItemAlreadyRemovedHttpError,
  GroceryItemChangedConcurrentlyHttpError,
  GroceryItemNameTakenHttpError,
  GroceryItemNotFoundHttpError,
} from "./grocery-item-http-errors.ts"

const GroceryItemPathParams = Schema.Struct({ groceryItemId: GroceryItemId })

export class GroceryItemApi extends HttpApiGroup.make("groceryItems").add(
  HttpApiEndpoint.post("addGroceryItem", "/grocery-items", {
    payload: Schema.Struct({ groceryItemId: GroceryItemId, name: GroceryItemName }),
    success: GroceryItemView.pipe(HttpApiSchema.status(201)),
    error: [GroceryItemNameTakenHttpError, GroceryItemAlreadyExistsHttpError, GroceryItemNotFoundHttpError],
  }),
  HttpApiEndpoint.put("renameGroceryItem", "/grocery-items/:groceryItemId/name", {
    params: GroceryItemPathParams,
    payload: Schema.Struct({ name: GroceryItemName }),
    success: GroceryItemView,
    error: [
      GroceryItemNotFoundHttpError,
      GroceryItemAlreadyRemovedHttpError,
      GroceryItemNameTakenHttpError,
      GroceryItemChangedConcurrentlyHttpError,
    ],
  }),
  HttpApiEndpoint.post("checkGroceryItem", "/grocery-items/:groceryItemId/check", {
    params: GroceryItemPathParams,
    success: GroceryItemView,
    error: [GroceryItemNotFoundHttpError, GroceryItemAlreadyRemovedHttpError, GroceryItemChangedConcurrentlyHttpError],
  }),
  HttpApiEndpoint.post("uncheckGroceryItem", "/grocery-items/:groceryItemId/uncheck", {
    params: GroceryItemPathParams,
    success: GroceryItemView,
    error: [GroceryItemNotFoundHttpError, GroceryItemAlreadyRemovedHttpError, GroceryItemChangedConcurrentlyHttpError],
  }),
  HttpApiEndpoint.delete("removeGroceryItem", "/grocery-items/:groceryItemId", {
    params: GroceryItemPathParams,
    success: GroceryItemView,
    error: [GroceryItemNotFoundHttpError, GroceryItemChangedConcurrentlyHttpError],
  }),
  HttpApiEndpoint.get("listGroceryItems", "/grocery-items", {
    query: { afterSeq: GroceryItemSeq },
    success: GroceryItemsView,
  }),
  HttpApiEndpoint.get("streamGroceryItems", "/grocery-items/live", {
    query: { afterSeq: GroceryItemSeq },
    success: HttpApiSchema.StreamSse({ data: GroceryItemsView }),
  }),
) {}

export class GroceryApi extends HttpApi.make("GroceryApi").add(GroceryItemApi) {}
