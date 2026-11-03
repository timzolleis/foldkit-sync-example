import { Runtime } from "foldkit"
import { GroceryStore } from "./grocery-store.ts"
import { init, Message, Model, subscriptions, update, view } from "./main.ts"

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  resources: GroceryStore.layer,
  container: document.getElementById("root"),
  devTools: { Message },
})

Runtime.run(application)
