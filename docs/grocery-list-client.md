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
SyncedListStatus (src/lib/synced-list.ts): Connecting | Live | Offline
RenameDraft = Schema.Struct({ groceryItemId: GroceryItemId, draftName: Schema.String })

Model = Schema.Struct({
  groceryItems: Schema.Array(GroceryItemRow),   // listed only: unchecked first, then checked, each by addedAt
  syncStatus: SyncedListStatus,
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

## SyncedList (`src/lib/synced-list.ts`)
A synced, offline-capable list of one resource, over a server that answers "the list after a seq". Knows nothing of groceries.

```ts
SyncedList.make<Row, View, Intents>({
  name,                         // collection id, localStorage key, IndexedDB outbox, leader lock
  row, key,                     // the JSON-safe row schema and its key
  viewKey, rowOf,               // a server view → its key, and its row (none: removed)
  live: (afterSeq) => Stream<{ items: View[], lastSeq }>,
  intents: { [intent]: { args: Schema, optimistic(rows, args), send(args) → { seq } } },
}) → { rows: Collection<Row>, status: SubscriptionRef<Connecting | Live | Offline>, send: { [intent](args) → Transaction } }
```

The server contract:

```text
GET  live?afterSeq=N    SSE of { items, lastSeq }: the items written after N, then again after each write, and every 10 s
every write             answers the written item with its seq; safe to send twice
```

Sync:

```text
start                          the kept { rows, lastSeq } from localStorage → write them, markReady
follow                         live(lastSeq); each batch: begin; removed → delete, kept → update, else insert; commit; keep the snapshot
a connection from seq 0        its first batch is the whole list: begin({ snapshot: true }) replaces every synced row
a batch with a lower lastSeq   the server forgot the list: lastSeq = 0, reconnect, so the whole list replaces it
25 seconds without a batch     the connection is dead: reconnect
the browser's offline event    drop the connection at once: Offline, reconnect every 2 seconds
```

Writes: `send[intent](args)` is one offline transaction. It applies `optimistic` at once and stores `args`, encoded by the intent's schema, in the outbox. Replayed after a reload, its `mutationFn` decodes them and calls `send`:

```text
answer               wait until the live list reaches the answer's seq, so the optimistic row hands over to the synced one in place
a declared 4xx       NonRetriableError with its message: the outbox drops it, the row rolls back
a network error, 5xx thrown as is: the outbox retries with backoff
```

Every endpoint is safe to send twice (grocery item spec, GroceryItemController), so no idempotency key goes to the server.
Rejected: the collection's generic `onUpdate`: it gives a diff of fields, and the client would guess the intent from it.
Rejected: one action that sends the whole row: the server takes intents, not rows.

## GroceryStore (`src/grocery-store.ts`)
`SyncedList.make` for grocery items, as a Foldkit `resources` Layer, built once at start.

```text
row          GroceryItemRecord: a JSON-safe copy of GroceryItemView (ISO strings for instants, no Removed);
             in Effect 4 a DateTimeUtc's encoded side is still a DateTime, and the outbox stores JSON
live         client.groceryItems.streamGroceryItems({ afterSeq })
intents      addGroceryItem      optimistic: insert, Unchecked, addedAt now
             renameGroceryItem   optimistic: update name
             checkGroceryItem    optimistic: status Checked
             uncheckGroceryItem  optimistic: status Unchecked
             removeGroceryItem   optimistic: delete
             each sends its endpoint on GroceryApi
```

Cases (e2e: two browser contexts, `client/e2e/two-devices.mjs`)
  an add, a check-off, a rename and a removal on one device show on the other
  add "  milk " while "Milk" is listed           → the row is gone, the banner says why
  offline: add Bread, check Free-range eggs      → both rows show saving; the other device sees neither
  reload with the server unreachable             → the kept list and both saving rows come back
  back online                                    → both writes reach the other device
  a removal while the device is offline          → gone once it is back

## Subscriptions (`src/main.ts`)

```text
groceryItems   GroceryStore.rows.subscribeChanges({ includeInitialState: false }), then its current rows;
               without the option a subscription only hears deletes of rows it was sent, so a removal of a kept row is lost
               → ChangedGroceryItems { groceryItems: listed rows, ordered }
syncStatus     GroceryStore.status.changes → ChangedSyncStatus
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
+ ├─ src/lib/synced-list.ts    SyncedList
+ ├─ src/grocery-store.ts      GroceryStore: SyncedList.make for grocery items
+ ├─ src/main.story.test.ts    the update Cases
+ └─ e2e/two-devices.mjs       the sync Cases, against both dev servers
```

## Open

None. Decided: a localStorage snapshot of `{ items, lastSeq }` for offline reads; rename by clicking the name.

## Built

Code: `client/src/`. Run: `npm run dev:server` and `npm run dev:client` (http://localhost:5180). Tests: `npm test -w client` (update), `npm run e2e` (sync, both dev servers running).
