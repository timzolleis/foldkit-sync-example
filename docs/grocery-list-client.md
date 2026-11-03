---
name: grocery-list-client
description: The Foldkit app shoppers use to keep the grocery list on their device, changing it online or offline.
type: spec
state: resolved
---

# Grocery list client

The Foldkit app for the grocery item story ([grocery-item.md](grocery-item.md)): one page, the list, synced live with the server in `server/`. It ships every use case of that story.

Host mapping: Foldkit 0.170 on Effect 4.1, Vite, Tailwind. TanStack DB 1.0 RC holds the rows; `@tanstack/offline-transactions` 1.2 holds the writes. The client imports the server's schemas and `GroceryApi` from the `grocery-server` workspace, so both sides decode with the same schemas, and the client calls the server through `HttpApiClient`.
Out of scope: routing, sign-in, several lists, the design beyond a usable list.

## Use cases

| Use case | Rules | Where on the page |
|---|---|---|
| A shopper adds an item to the list. | 1, 2 | the field at the top, Enter |
| A shopper renames an item. | 1, 2, 3 | click its name, Enter |
| A shopper checks off an item. | 3, 4 | its checkbox |
| A shopper unchecks an item. | 3, 4 | its checkbox |
| A shopper removes an item. | 5 | its × button |

Rules cite the grocery item story. The server decides every rule; the client only keeps a blank name from being sent (rule 1) and tells the shopper why a write was undone.

## Flow

```text
click ──▶ Message ──▶ update ──▶ Command ──▶ offline action
                                              ├─ onMutate: the row changes in the collection at once
                                              └─ outbox (IndexedDB) ──▶ mutationFn ──▶ GroceryApi endpoint
                                                                          └─ waits for the answer's seq in the feed
server ──SSE──▶ collection sync (begin, write, commit) ──▶ Subscription ──▶ ChangedGroceryItems ──▶ Model ──▶ view
```

The collection is the one copy of the list on the device. The Model holds what the view draws: a fresh copy after each change, so Foldkit DevTools show every change as a Message.

## Model (`src/main.ts`)

```ts
GroceryItemRow = Schema.Struct({ groceryItemId: GroceryItemId, name: GroceryItemName, checked: Schema.Boolean, isSaving: Schema.Boolean })
GroceryListSyncStatus = defineTaggedUnion({ Connecting: {}, Live: {}, Offline: {} })
RenameDraft = Schema.Struct({ groceryItemId: GroceryItemId, draftName: Schema.String })

Model = Schema.Struct({
  groceryItems: Schema.Array(GroceryItemRow),   // listed only: unchecked first, then checked, each by addedAt
  syncStatus: GroceryListSyncStatus,
  newItemName: Schema.String,
  renameDraft: Schema.Option(RenameDraft),
  undoneWrite: Schema.Option(Schema.String),    // why the last write was undone, until the next write or dismiss
})
```

`isSaving` is the row's `$hasPendingWrites`: the change is on the device, not yet confirmed by the server.
`undoneWrite`, not `error`: the shopper sees "Milk is already on the list, so it wasn't added", from the server's `message`.

## Messages and Commands (`src/main.ts`)

```ts
// the shopper
UpdatedNewItemName { value }      SubmittedNewItem {}
ClickedGroceryItemName { groceryItemId }   UpdatedDraftName { value }   SubmittedRename {}   CancelledRename {}
ClickedCheckbox { groceryItemId }          ClickedRemove { groceryItemId }
DismissedUndoneWrite {}
// subscriptions
ChangedGroceryItems { groceryItems }       ChangedSyncStatus { syncStatus }
// commands
ConfirmedGroceryItemWrite {}               UndidGroceryItemWrite { reason }

AddGroceryItem({ groceryItemId, name })    RenameGroceryItem({ groceryItemId, name })
CheckGroceryItem({ groceryItemId })        UncheckGroceryItem({ groceryItemId })    RemoveGroceryItem({ groceryItemId })
// each: GroceryStore.<action>(args), then await transaction.isPersisted
//   → ConfirmedGroceryItemWrite | UndidGroceryItemWrite { reason: the HTTP error's message }
```

Cases (Story tests, no DOM)
  SubmittedNewItem with "  " (rule 1)                     → no Command, nothing sent
  SubmittedNewItem "Milk"                                 → AddGroceryItem with a fresh id, newItemName cleared
  ClickedCheckbox on an unchecked item                    → CheckGroceryItem; on a checked one → UncheckGroceryItem
  UndidGroceryItemWrite "An item with this name is …"     → undoneWrite shows it

`ClickedCheckbox` picks check or uncheck from the row the shopper sees, so a tap means what it showed. Two shoppers tapping the same item both end up with it checked (rule 4).
Offline, `isPersisted` waits until the outbox sends: the Command stays open, and the row stays `isSaving`.

## GroceryStore (`src/grocery-store.ts`)
Owns: the collection, the outbox, and one offline action per use case. App-wide, so a Foldkit `resources` Layer, built once at start.

```ts
class GroceryStore extends Context.Service<GroceryStore, {
  groceryItems: Collection<GroceryItemView, GroceryItemId>
  syncStatus: SubscriptionRef<GroceryListSyncStatus>
  addGroceryItem(args: { groceryItemId; name }): Transaction
  renameGroceryItem(args: { groceryItemId; name }): Transaction
  checkGroceryItem(args: { groceryItemId }): Transaction
  uncheckGroceryItem(args: { groceryItemId }): Transaction
  removeGroceryItem(args: { groceryItemId }): Transaction
}>
```

```text
GroceryStore.layer
├─ HttpApiClient.make(GroceryApi, { baseUrl: "/api" })
├─ createCollection({ id: "grocery-items", getKey: groceryItemId, sync })
├─ startOfflineExecutor({ collections, mutationFns: one per use case }) ; waitForInit
└─ executor.createOfflineAction({ mutationFnName, onMutate }) × 5
```

Sync, in the collection's `sync`:

```text
start       read the kept snapshot { items, lastSeq } from localStorage → write them, markReady
follow      client.groceryItems.streamGroceryItems({ afterSeq: lastSeq }), decoded by the client
            each batch: begin; Removed → delete, kept → update, else insert; commit; lastSeq = batch.lastSeq; keep the snapshot
            the first batch with nothing kept → markReady
            the stream ends or fails → Offline, retry with backoff from the newest lastSeq
seq waiters awaitGroceryItemSeq(seq) resolves once lastSeq ≥ seq
```

A kept snapshot is what makes the list open offline after a reload; the outbox alone keeps only the writes.

Writes, one `mutationFn` per use case. Its name is the intent; the mutation's key is the item:

```text
addGroceryItem      onMutate: insert { groceryItemId, name, status: Unchecked, addedAt: now, seq: 0 }
                    mutationFn: client.groceryItems.addGroceryItem({ payload: { groceryItemId, name } })
renameGroceryItem   onMutate: update name                      mutationFn: renameGroceryItem
checkGroceryItem    onMutate: update status Checked            mutationFn: checkGroceryItem
uncheckGroceryItem  onMutate: update status Unchecked          mutationFn: uncheckGroceryItem
removeGroceryItem   onMutate: delete                           mutationFn: removeGroceryItem

every mutationFn    answer → awaitGroceryItemSeq(answer.seq), so the optimistic row hands over to the synced one in place
                    an HTTP error the API declares (404, 409, 400) → NonRetriableError with its message: the outbox drops it, the row rolls back
                    a network error → thrown as is: the outbox retries with backoff
```

Every endpoint is safe to send twice (grocery item spec, GroceryItemController), so a retry after a lost answer changes nothing, and no idempotency key goes to the server.
Rejected: the collection's generic `onUpdate`: it gives a diff of fields, and the client would guess the intent from it.
Rejected: one action that sends the whole row: the server takes intents, not rows.

The collection holds `GroceryItemRecord`, a JSON-safe copy of `GroceryItemView` (ISO strings for instants, no `Removed`): the outbox writes mutations to IndexedDB as JSON, and in Effect 4 a `DateTimeUtc`'s encoded side is still a `DateTime`. `groceryItemRecordFromView` names every field.

```text
a connection from seq 0        its first batch is the whole list: begin({ snapshot: true }) replaces every synced row
a batch with a lower lastSeq   the server forgot the list: lastSeq = 0, reconnect, so the whole list replaces it
25 seconds without a batch     the connection is dead (the server's heartbeat is every 10): reconnect
the browser's offline event    drop the connection at once: Offline shows, and it reconnects every 2 seconds
```

Cases (e2e: two browser contexts, `client/e2e/two-devices.mjs`)
  an add, a check-off, a rename and a removal on one device show on the other
  add "  milk " while "Milk" is listed           → the row is gone, the banner says why
  offline: add Bread, check Free-range eggs      → both rows show saving; the other device sees neither
  reload with the server unreachable             → the kept list and both saving rows come back
  back online                                    → both writes reach the other device

## Subscriptions (`src/main.ts`)

```text
groceryItems   GroceryStore.groceryItems.subscribeChanges, with its current rows first
               → ChangedGroceryItems { groceryItems: listed rows, ordered }
syncStatus     GroceryStore.syncStatus.changes → ChangedSyncStatus
```

Both run for the app's lifetime: their dependencies are constant.

## View (`src/main.ts`)

```text
header      "Groceries", and a dot: Connecting grey, Live green, Offline amber with "Offline: changes are sent when you're back"
new item    input + Add button; Add dimmed (aria-disabled) while the name is blank
list        each row: checkbox, name (or the rename input), × ; a saving row is dimmed
undone      a banner with undoneWrite and a dismiss button
```

Not `disabled`: a browser won't submit a form on Enter while its default button is disabled, and the button turns enabled only on the next frame, so a paste and Enter would be dropped. `update` keeps a blank name from being sent either way (rule 1).
A reload with the device offline needs a service worker to load the page at all; out of scope. The kept list covers a reload while the server is unreachable.

## Files (`+` new)

```diff
+ package.json                 workspaces: server, client
+ client/
+ ├─ package.json              foldkit, @foldkit/ui, @tanstack/db, @tanstack/offline-transactions, effect, grocery-server
+ ├─ vite.config.ts            foldkit plugin, tailwind, proxy /api → localhost:3001
+ ├─ index.html
+ ├─ src/entry.ts              Runtime.makeApplication({ Model, init, update, view, subscriptions, resources: GroceryStore.layer })
+ ├─ src/main.ts               Model, Messages, update, Commands, subscriptions, view
+ ├─ src/grocery-store.ts      GroceryStore
+ ├─ src/main.story.test.ts    the update Cases
+ └─ e2e/two-devices.mjs       the sync Cases, against both dev servers
```

## Open

None. Decided: a localStorage snapshot of `{ items, lastSeq }` for offline reads; rename by clicking the name.

## Built

Code: `client/src/`. Run: `npm run dev:server` and `npm run dev:client` (http://localhost:5180). Tests: `npm test -w client` (update), `npm run e2e` (sync, both dev servers running).
