import { Array as Arr, Effect, Option, Order, pipe, Queue, Schema, Stream, SubscriptionRef } from "effect"
import type { Transaction } from "@tanstack/db"
import { Command, Runtime, Subscription, type Update } from "foldkit"
import { type Document, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { generateGroceryItemId, GroceryItemId } from "grocery-server/grocery-item/domain/grocery-item-id.ts"
import { GroceryItemName } from "grocery-server/grocery-item/domain/grocery-item-name.ts"
import { type GroceryItemRecord, GroceryListSyncStatus, GroceryStore } from "./grocery-store.ts"

// MODEL

export const GroceryItemRow = Schema.Struct({
  groceryItemId: GroceryItemId,
  name: GroceryItemName,
  checked: Schema.Boolean,
  isSaving: Schema.Boolean,
})
export type GroceryItemRow = typeof GroceryItemRow.Type

export const RenameDraft = Schema.Struct({ groceryItemId: GroceryItemId, draftName: Schema.String })
export type RenameDraft = typeof RenameDraft.Type

export const Model = Schema.Struct({
  groceryItems: Schema.Array(GroceryItemRow),
  syncStatus: GroceryListSyncStatus,
  newItemName: Schema.String,
  renameDraft: Schema.Option(RenameDraft),
  undoneWrite: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedNewItemName: { value: Schema.String },
  SubmittedNewItem: {},
  ClickedGroceryItemName: { groceryItemId: GroceryItemId },
  UpdatedDraftName: { value: Schema.String },
  SubmittedRename: {},
  CancelledRename: {},
  ClickedCheckbox: { groceryItemId: GroceryItemId },
  ClickedRemove: { groceryItemId: GroceryItemId },
  DismissedUndoneWrite: {},
  ChangedGroceryItems: { groceryItems: Schema.Array(GroceryItemRow) },
  ChangedSyncStatus: { syncStatus: GroceryListSyncStatus },
  ConfirmedGroceryItemWrite: {},
  UndidGroceryItemWrite: { reason: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

const settledGroceryItemWrite = (transaction: Transaction) =>
  Effect.tryPromise(() => transaction.when("settled")).pipe(
    Effect.as(Message.ConfirmedGroceryItemWrite()),
    Effect.catch((failure) =>
      Effect.succeed(
        Message.UndidGroceryItemWrite({
          reason: failure.cause instanceof Error ? failure.cause.message : "The list refused this change.",
        }),
      ),
    ),
  )

const groceryItemWriteMessages = [Message.ConfirmedGroceryItemWrite, Message.UndidGroceryItemWrite] as const

export const AddGroceryItem = Command.define("AddGroceryItem", {
  args: { name: GroceryItemName },
  messages: groceryItemWriteMessages,
  execute: ({ name }) =>
    Effect.gen(function* () {
      const groceryStore = yield* GroceryStore
      return yield* settledGroceryItemWrite(groceryStore.addGroceryItem({ groceryItemId: generateGroceryItemId(), name }))
    }),
})

export const RenameGroceryItem = Command.define("RenameGroceryItem", {
  args: { groceryItemId: GroceryItemId, name: GroceryItemName },
  messages: groceryItemWriteMessages,
  execute: ({ groceryItemId, name }) =>
    Effect.gen(function* () {
      const groceryStore = yield* GroceryStore
      return yield* settledGroceryItemWrite(groceryStore.renameGroceryItem({ groceryItemId, name }))
    }),
})

export const CheckGroceryItem = Command.define("CheckGroceryItem", {
  args: { groceryItemId: GroceryItemId },
  messages: groceryItemWriteMessages,
  execute: ({ groceryItemId }) =>
    Effect.gen(function* () {
      const groceryStore = yield* GroceryStore
      return yield* settledGroceryItemWrite(groceryStore.checkGroceryItem({ groceryItemId }))
    }),
})

export const UncheckGroceryItem = Command.define("UncheckGroceryItem", {
  args: { groceryItemId: GroceryItemId },
  messages: groceryItemWriteMessages,
  execute: ({ groceryItemId }) =>
    Effect.gen(function* () {
      const groceryStore = yield* GroceryStore
      return yield* settledGroceryItemWrite(groceryStore.uncheckGroceryItem({ groceryItemId }))
    }),
})

export const RemoveGroceryItem = Command.define("RemoveGroceryItem", {
  args: { groceryItemId: GroceryItemId },
  messages: groceryItemWriteMessages,
  execute: ({ groceryItemId }) =>
    Effect.gen(function* () {
      const groceryStore = yield* GroceryStore
      return yield* settledGroceryItemWrite(groceryStore.removeGroceryItem({ groceryItemId }))
    }),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, GroceryStore>

const decodeGroceryItemName = Schema.decodeUnknownOption(GroceryItemName)

const groceryItemById = (model: Model, groceryItemId: GroceryItemId): Option.Option<GroceryItemRow> =>
  Arr.findFirst(model.groceryItems, (groceryItem) => groceryItem.groceryItemId === groceryItemId)

const renameFromDraft = (model: Model, renameDraft: RenameDraft): UpdateReturn => {
  const closedModel = modifyFields(model, { renameDraft: () => Option.none() })
  return Option.match(decodeGroceryItemName(renameDraft.draftName), {
    onNone: () => ({ model: closedModel }),
    onSome: (name) =>
      Option.match(groceryItemById(model, renameDraft.groceryItemId), {
        onNone: () => ({ model: closedModel }),
        onSome: (groceryItem) =>
          groceryItem.name === name
            ? { model: closedModel }
            : {
                model: modifyFields(closedModel, { undoneWrite: () => Option.none() }),
                commands: [RenameGroceryItem({ groceryItemId: renameDraft.groceryItemId, name })],
              },
      }),
  })
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    UpdatedNewItemName: ({ value }) => ({ model: modifyFields(model, { newItemName: () => value }) }),
    SubmittedNewItem: () =>
      Option.match(decodeGroceryItemName(model.newItemName), {
        onNone: () => ({ model }),
        onSome: (name) => ({
          model: modifyFields(model, { newItemName: () => "", undoneWrite: () => Option.none() }),
          commands: [AddGroceryItem({ name })],
        }),
      }),
    ClickedGroceryItemName: ({ groceryItemId }) =>
      Option.match(groceryItemById(model, groceryItemId), {
        onNone: () => ({ model }),
        onSome: (groceryItem) => ({
          model: modifyFields(model, {
            renameDraft: () => Option.some({ groceryItemId, draftName: groceryItem.name }),
          }),
        }),
      }),
    UpdatedDraftName: ({ value }) => ({
      model: modifyFields(model, {
        renameDraft: (renameDraft) => Option.map(renameDraft, (draft) => ({ ...draft, draftName: value })),
      }),
    }),
    SubmittedRename: () =>
      Option.match(model.renameDraft, {
        onNone: () => ({ model }),
        onSome: (renameDraft) => renameFromDraft(model, renameDraft),
      }),
    CancelledRename: () => ({ model: modifyFields(model, { renameDraft: () => Option.none() }) }),
    ClickedCheckbox: ({ groceryItemId }) =>
      Option.match(groceryItemById(model, groceryItemId), {
        onNone: () => ({ model }),
        onSome: (groceryItem) => ({
          model: modifyFields(model, { undoneWrite: () => Option.none() }),
          commands: [
            groceryItem.checked ? UncheckGroceryItem({ groceryItemId }) : CheckGroceryItem({ groceryItemId }),
          ],
        }),
      }),
    ClickedRemove: ({ groceryItemId }) => ({
      model: modifyFields(model, { undoneWrite: () => Option.none() }),
      commands: [RemoveGroceryItem({ groceryItemId })],
    }),
    DismissedUndoneWrite: () => ({ model: modifyFields(model, { undoneWrite: () => Option.none() }) }),
    ChangedGroceryItems: ({ groceryItems }) => ({ model: modifyFields(model, { groceryItems: () => groceryItems }) }),
    ChangedSyncStatus: ({ syncStatus }) => ({ model: modifyFields(model, { syncStatus: () => syncStatus }) }),
    ConfirmedGroceryItemWrite: () => ({ model }),
    UndidGroceryItemWrite: ({ reason }) => ({ model: modifyFields(model, { undoneWrite: () => Option.some(reason) }) }),
  })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    groceryItems: [],
    syncStatus: GroceryListSyncStatus.Connecting(),
    newItemName: "",
    renameDraft: Option.none(),
    undoneWrite: Option.none(),
  },
})

// SUBSCRIPTION

const groceryItemRowOrder = Order.combine(
  Order.mapInput(Order.Boolean, (groceryItem: GroceryItemRecord) => groceryItem.status._tag === "Checked"),
  Order.mapInput(Order.String, (groceryItem: GroceryItemRecord) => groceryItem.addedAt),
)

const groceryItemRowsFromStore = (groceryStore: GroceryStore["Service"]): ReadonlyArray<GroceryItemRow> =>
  pipe(
    groceryStore.groceryItems.toArray,
    Arr.sort(groceryItemRowOrder),
    Arr.map((groceryItem) => ({
      groceryItemId: GroceryItemId.make(groceryItem.groceryItemId),
      name: GroceryItemName.make(groceryItem.name),
      checked: groceryItem.status._tag === "Checked",
      isSaving: groceryItem.$hasPendingWrites,
    })),
  )

const changedGroceryItemsFromStore = (groceryStore: GroceryStore["Service"]) =>
  Stream.callback<Message>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const offerGroceryItems = () =>
          Queue.offerUnsafe(queue, Message.ChangedGroceryItems({ groceryItems: groceryItemRowsFromStore(groceryStore) }))
        const subscription = groceryStore.groceryItems.subscribeChanges(offerGroceryItems)
        offerGroceryItems()
        return subscription
      }),
      (subscription) => Effect.sync(() => subscription.unsubscribe()),
    ).pipe(Effect.andThen(Effect.never)),
  )

export const subscriptions = Subscription.make<Model, Message, GroceryStore>()((entry) => ({
  groceryItems: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () => Stream.unwrap(Effect.map(GroceryStore, changedGroceryItemsFromStore)),
    },
  ),
  syncStatus: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.unwrap(
          Effect.map(GroceryStore, (groceryStore) =>
            SubscriptionRef.changes(groceryStore.syncStatus).pipe(
              Stream.map((syncStatus) => Message.ChangedSyncStatus({ syncStatus })),
            ),
          ),
        ),
    },
  ),
}))

// VIEW

const syncStatusView = (syncStatus: GroceryListSyncStatus, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex items-center gap-2 text-sm text-stone-500"), h.Role("status")],
    GroceryListSyncStatus.match(syncStatus, {
      Connecting: () => [h.span([h.Class("size-2 shrink-0 rounded-full bg-stone-300")], []), "Connecting…"],
      Live: () => [h.span([h.Class("size-2 shrink-0 rounded-full bg-emerald-500")], []), "Live"],
      Offline: () => [
        h.span([h.Class("size-2 shrink-0 rounded-full bg-amber-500")], []),
        "Offline: changes are sent when you're back",
      ],
    }),
  )

const newItemView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Class("flex gap-2"), h.OnSubmit(Message.SubmittedNewItem())],
    [
      h.input([
        h.Class(
          "min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500",
        ),
        h.Placeholder("Add an item"),
        h.AriaLabel("New item"),
        h.Value(model.newItemName),
        h.OnInput((value) => Message.UpdatedNewItemName({ value })),
      ]),
      h.button(
        [
          h.Type("submit"),
          h.AriaDisabled(Option.isNone(decodeGroceryItemName(model.newItemName))),
          h.Class("rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white aria-disabled:opacity-40"),
        ],
        ["Add"],
      ),
    ],
  )

const renameView = (renameDraft: RenameDraft, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Class("flex-1"), h.OnSubmit(Message.SubmittedRename())],
    [
      h.input([
        h.Class("w-full rounded border border-stone-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"),
        h.AriaLabel("Item name"),
        h.Autofocus(true),
        h.Value(renameDraft.draftName),
        h.OnInput((value) => Message.UpdatedDraftName({ value })),
        h.OnBlur(Message.SubmittedRename()),
        h.OnKeyDownPreventDefault((key) => (key === "Escape" ? Option.some(Message.CancelledRename()) : Option.none())),
      ]),
    ],
  )

const groceryItemView = (groceryItem: GroceryItemRow, renameDraft: Option.Option<RenameDraft>, h: HtmlBuilder<Message>): Html =>
  h.keyed("li")(
    groceryItem.groceryItemId,
    [h.Class(`flex items-center gap-3 rounded-lg px-3 py-2 ${groceryItem.isSaving ? "opacity-60" : ""}`)],
    [
      h.input([
        h.Type("checkbox"),
        h.Class("size-5 accent-emerald-600"),
        h.AriaLabel(`Check off ${groceryItem.name}`),
        h.Checked(groceryItem.checked),
        h.OnChange(() => Message.ClickedCheckbox({ groceryItemId: groceryItem.groceryItemId })),
      ]),
      Option.match(
        Option.filter(renameDraft, (draft) => draft.groceryItemId === groceryItem.groceryItemId),
        {
          onNone: () =>
            h.button(
              [
                h.Class(`flex-1 text-left ${groceryItem.checked ? "text-stone-400 line-through" : "text-stone-900"}`),
                h.OnClick(Message.ClickedGroceryItemName({ groceryItemId: groceryItem.groceryItemId })),
              ],
              [groceryItem.name],
            ),
          onSome: (draft) => renameView(draft, h),
        },
      ),
      h.button(
        [
          h.Class("rounded px-2 text-lg text-stone-400 hover:bg-red-50 hover:text-red-600"),
          h.AriaLabel(`Remove ${groceryItem.name}`),
          h.OnClick(Message.ClickedRemove({ groceryItemId: groceryItem.groceryItemId })),
        ],
        ["×"],
      ),
    ],
  )

const undoneWriteView = (undoneWrite: Option.Option<string>, h: HtmlBuilder<Message>): Html =>
  Option.match(undoneWrite, {
    onNone: () => h.empty,
    onSome: (reason) =>
      h.div(
        [h.Class("flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"), h.Role("alert")],
        [
          h.span([], [`Undone: ${reason}`]),
          h.button([h.Class("font-medium"), h.OnClick(Message.DismissedUndoneWrite())], ["Dismiss"]),
        ],
      ),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Groceries",
  body: h.main(
    [h.Class("mx-auto flex max-w-md flex-col gap-4 p-6")],
    [
      h.header(
        [h.Class("flex flex-wrap items-center justify-between gap-x-4 gap-y-1")],
        [h.h1([h.Class("text-2xl font-semibold")], ["Groceries"]), syncStatusView(model.syncStatus, h)],
      ),
      newItemView(model, h),
      undoneWriteView(model.undoneWrite, h),
      Arr.match(model.groceryItems, {
        onEmpty: () => h.p([h.Class("text-stone-400")], ["Nothing to buy."]),
        onNonEmpty: (groceryItems) =>
          h.ul(
            [h.Class("flex flex-col")],
            groceryItems.map((groceryItem) => groceryItemView(groceryItem, model.renameDraft, h)),
          ),
      }),
    ],
  ),
})
