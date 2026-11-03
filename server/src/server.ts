import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { createServer } from "node:http"
import { AddGroceryItemService } from "./grocery-item/application/add-grocery-item-service.ts"
import { CheckGroceryItemService } from "./grocery-item/application/check-grocery-item-service.ts"
import { RemoveGroceryItemService } from "./grocery-item/application/remove-grocery-item-service.ts"
import { RenameGroceryItemService } from "./grocery-item/application/rename-grocery-item-service.ts"
import { UncheckGroceryItemService } from "./grocery-item/application/uncheck-grocery-item-service.ts"
import { GroceryApi } from "./grocery-item/http/grocery-item-api.ts"
import { GroceryItemController } from "./grocery-item/http/grocery-item-controller.ts"
import { GroceryItemRows } from "./grocery-item/infrastructure/grocery-item-rows.ts"
import { MemoryGroceryItemRepository } from "./grocery-item/infrastructure/memory-grocery-item-repository.ts"
import { MemoryGroceryItemViews } from "./grocery-item/infrastructure/memory-grocery-item-views.ts"

export const GroceryItemLayer = GroceryItemController.pipe(
  Layer.provide([
    AddGroceryItemService.layer,
    RenameGroceryItemService.layer,
    CheckGroceryItemService.layer,
    UncheckGroceryItemService.layer,
    RemoveGroceryItemService.layer,
  ]),
  Layer.provide([MemoryGroceryItemRepository, MemoryGroceryItemViews]),
  Layer.provide(GroceryItemRows.layer),
)

export const GroceryApiLayer = HttpApiBuilder.layer(GroceryApi).pipe(Layer.provide(GroceryItemLayer))

const ServerLayer = Layer.unwrap(
  Effect.map(Config.Port("PORT").pipe(Config.withDefault(3001)), (port) =>
    GroceryApiLayer.pipe(HttpRouter.serve, Layer.provide(NodeHttpServer.layer(createServer, { port, gracefulShutdownTimeout: "1 second" }))),
  ),
)

if (import.meta.main) Layer.launch(ServerLayer).pipe(NodeRuntime.runMain)
