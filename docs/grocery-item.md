---
name: grocery-item
description: Shoppers add, rename, check off, uncheck and remove items on one shared grocery list, and every device sees each change live.
type: story + spec
state: resolved
---

# Grocery items

"We shop from one list, and whatever one of us changes shows up on the other's phone right away."

A grocery list holds items. Any shopper with the list adds, renames, checks off, unchecks and removes items. Every device keeps a copy of the list and sees each change as it happens. A change made offline is sent once the device is back online; one the list refuses by then is undone on that device.

## Use cases

| Use case | Rules |
|---|---|
| A shopper adds an item to the list. | 1, 2 |
| A shopper renames an item. | 1, 2, 3 |
| A shopper checks off an item. | 3, 4 |
| A shopper unchecks an item. | 3, 4 |
| A shopper removes an item. | 5 |

## Data

| Field | Type | Content |
|---|---|---|
| name | text, 1–80 characters | Oat milk |
| checked | yes / no, with when | checked Tue 3 Nov 2026, 17:42 |
| added | instant | Tue 3 Nov 2026, 09:10 |

## Rules

1. **A name is not blank.** Leading and trailing spaces are dropped; at most 80 characters.
2. **One item per name.** An item can't be added or renamed to the name of another item on the list, ignoring case: two shoppers who both remember milk should end up with one milk.
3. **A removed item stays removed.** It can't be renamed, checked off or unchecked: a device that still shows it learns of the removal instead.
4. **Checking off sets a state; it doesn't toggle.** Checking off an item that is already checked off changes nothing: two shoppers in the store tap the same item.
5. **Removing is final.** A removed item doesn't come back; adding it again makes a new item.

## Examples

| List before | Shopper does | Result |
|---|---|---|
| Milk | adds "Oat milk" | added |
| Milk | adds "  milk " | refused, "Milk" is on the list (rules 1, 2) |
| Milk | adds "" | refused, blank (rule 1) |
| Milk, Eggs | renames Eggs to "MILK" | refused (rule 2) |
| Milk | renames Milk to "milk" | renamed: it meets only itself (rule 2) |
| Milk, checked off by Anna at 17:42 | Ben checks off Milk at 17:43 | stays checked off at 17:42 (rule 4) |
| Milk, removed by Anna | Ben checks off Milk | refused, removed (rule 3) |
| Milk, removed | adds "Milk" | added, a new item (rules 2, 5) |

## Open

None.

---

# Spec

Ships every use case above and the list read devices sync from. The Foldkit client is the next spec; its contract is under [Sync contract](#sync-contract).

Host mapping: a new project. One shared list, no sign-in: no tenant, no access model, so no actor (effect-ddd access.md, No access model). Effect 4.1 `HttpApi` on Node. The backend is a mock: rows live in memory (`GroceryItemRows`, a `Ref`), lost on restart. Event delivery is in-process: `GroceryItemRows.writtenSeqs`, a `PubSub`, wakes the live list after a write.
Out of scope: the client, sign-in, several lists, persistence, purging removed items.

## Use cases

Story: above. This spec ships all five.

## Lifecycle

```text
  add   ┌───────────┐  check   ┌─────────┐
 ─────▶ │ Unchecked │ ───────▶ │ Checked │
        │           │ ◀─────── │         │
        └───────────┘ uncheck  └─────────┘
          │  rename ↺              │  rename ↺
          └──────── remove ────────┴──────▶ Removed
```

```ts
addGroceryItem({ groceryItemId, name, itemWithSameName, now }): Result<GroceryItemAddedEvent, GroceryItemNameTakenError>
renameGroceryItem({ item: ListedGroceryItem, name, itemWithSameName, now }): Result<GroceryItemRenamedEvent, GroceryItemNameTakenError>
checkGroceryItem({ item: UncheckedGroceryItem, now }): Result<GroceryItemCheckedEvent, never>
uncheckGroceryItem({ item: CheckedGroceryItem, now }): Result<GroceryItemUncheckedEvent, never>
removeGroceryItem({ item: ListedGroceryItem, now }): Result<GroceryItemRemovedEvent, never>
```

Cases
  add "  milk " while "Milk" is listed (rules 1, 2)   → GroceryItemNameTakenError { name: "milk" }
  add "Milk" after Milk was removed (rules 2, 5)      → GroceryItemAddedEvent
  rename Milk to "milk" (rule 2)                      → GroceryItemRenamedEvent, it meets itself
  rename Eggs to "MILK" (rule 2)                      → GroceryItemNameTakenError
  check an unchecked item (rule 4)                    → GroceryItemCheckedEvent

## Model (`domain/grocery-item-id.ts`, `domain/grocery-item-name.ts`, `domain/grocery-item.ts`)

```ts
GroceryItemId = prefixedId("gri").pipe(Schema.brand("GroceryItemId"))
GroceryItemName = Schema.Trimmed.check(Schema.isNonEmpty(), Schema.isMaxLength(80)).pipe(Schema.brand("GroceryItemName"))
GroceryItemNameEquivalence = Equivalence.mapInput(Equivalence.String, (name: string) => name.toLowerCase())

const groceryItemFields = { groceryItemId: GroceryItemId, name: GroceryItemName, addedAt: Schema.DateTimeUtc }
UncheckedGroceryItem = Schema.TaggedStruct("UncheckedGroceryItem", { ...groceryItemFields })
CheckedGroceryItem   = Schema.TaggedStruct("CheckedGroceryItem",   { ...groceryItemFields, checkedAt: Schema.DateTimeUtc })
type ListedGroceryItem = UncheckedGroceryItem | CheckedGroceryItem

type AddGroceryItemInput    = { groceryItemId: GroceryItemId; name: GroceryItemName; itemWithSameName: Option<ListedGroceryItem>; now: DateTime.Utc }
type RenameGroceryItemInput = { item: ListedGroceryItem; name: GroceryItemName; itemWithSameName: Option<ListedGroceryItem>; now: DateTime.Utc }

addGroceryItemRules    = [nameMustBeFreeRule]
renameGroceryItemRules = [nameMustBeFreeRule]
// nameMustBeFreeRule({ itemWithSameName, groceryItemId }): passes when none, or when it is the item being named
```

The client sends `groceryItemId`: the optimistic row and the server's row share their key from the start. Required, not optional: no client adds without one.
No `RemovedGroceryItem` schema: no transition takes a removed item; the finds report it as `GroceryItemAlreadyRemovedError`.
`Unchecked` / `Checked`, not `Open` / `Done`: the shopper checks an item off.
Rejected: one `GroceryItem` with `checked: boolean`: `uncheckGroceryItem` would accept an unchecked item at compile time.

## Events and errors (`domain/grocery-item-event.ts`, `domain/grocery-item-error.ts`)

```ts
const groceryItemEventFields = { groceryItemId: GroceryItemId, occurredOn: Schema.DateTimeUtc }
GroceryItemAddedEvent      { name }                       // addGroceryItem; occurredOn becomes addedAt
GroceryItemRenamedEvent    { name, previousName }         // renameGroceryItem; previousName guards the write
GroceryItemCheckedEvent    {}                             // checkGroceryItem; occurredOn becomes checkedAt
GroceryItemUncheckedEvent  {}                             // uncheckGroceryItem
GroceryItemRemovedEvent    {}                             // removeGroceryItem; occurredOn becomes removedAt

GroceryItemNotFoundError            { groceryItemId }      // every find, GroceryItemViews.getGroceryItemById
GroceryItemAlreadyCheckedError      { groceryItemId }      // findUncheckedGroceryItemById
GroceryItemAlreadyUncheckedError    { groceryItemId }      // findCheckedGroceryItemById
GroceryItemAlreadyRemovedError      { groceryItemId }      // every find (rule 3)
GroceryItemNameTakenError           { name }               // nameMustBeFreeRule; the write, on a race (rule 2)
GroceryItemAlreadyExistsError       { groceryItemId }      // add with a taken id
GroceryItemChangedConcurrentlyError { groceryItemId }      // a guarded write that matched no row
```

`Already…` on both check states: checking is not a one-way lifecycle, so neither is *still*.

## Rows (`infrastructure/grocery-item-rows.ts`)

```ts
GroceryItemRowStatus = { _tag: "Unchecked" } | { _tag: "Checked"; checkedAt } | { _tag: "Removed"; removedAt }
GroceryItemRow = { id, name, status: GroceryItemRowStatus, addedAt, seq: GroceryItemSeq }
GroceryItemRows = Context.Service<{
  state: Ref<{ rowsById: ReadonlyMap<GroceryItemId, GroceryItemRow>; lastSeq: GroceryItemSeq }>
  writtenSeqs: PubSub<GroceryItemSeq>   // each write's seq, after its Ref.modify
}>
```

The memory adapters of the repository and the views share it. Every write takes the next `seq` and sets it on its row in one `Ref.modify`, so a row's latest change has the highest number, and the list reads `seq > afterSeq`.
Removed rows stay, `status: "removed"`: the list tells devices of a removal by them (rule 5).
A write checks rule 2 again inside its `Ref.modify`, with `GroceryItemNameEquivalence`: two adds of "Milk" that both passed the rule can't both land.
Cost: a restart empties the list and resets `seq`; a device that synced before keeps rows the server no longer has. Fine for a mock.
Rejected: an events table the list reads: devices would fold domain events into rows themselves.

## Modules

```text
GroceryItemController                 grocery item endpoints and the list
├─ AddGroceryItemService              add one item
├─ RenameGroceryItemService           rename one listed item
├─ CheckGroceryItemService            check off one unchecked item
├─ UncheckGroceryItemService          uncheck one checked item
├─ RemoveGroceryItemService           remove one listed item
│  └─ GroceryItemRepository           narrowed finds, event → write
└─ GroceryItemViews                   items changed after a seq, one item
```

Files (`+` new):

```diff
+ lib/
+ ├─ prefixed-id.ts                  prefixedId, createPrefixedId
+ ├─ check-rules.ts                  checkRules
+ ├─ message-with-default.ts         messageWithDefault
+ ├─ match-tag.ts                    matchTag, MemberWithTag
+ ├─ exhaustive-record.ts            ExhaustiveRecord
+ grocery-item/
+ ├─ domain/
+ │  ├─ grocery-item-id.ts           GroceryItemId, generateGroceryItemId
+ │  ├─ grocery-item-name.ts         GroceryItemName, GroceryItemNameEquivalence
+ │  ├─ grocery-item.ts              states, transitions, inputs
+ │  ├─ grocery-item-rule.ts         nameMustBeFreeRule, rule lists
+ │  ├─ grocery-item-event.ts        events, GroceryItemEvent
+ │  ├─ grocery-item-error.ts        errors, GroceryItemError
+ │  └─ grocery-item-repository.ts   GroceryItemRepository, GroceryItemEventWriteErrors
+ ├─ application/
+ │  ├─ add-grocery-item-service.ts
+ │  ├─ rename-grocery-item-service.ts
+ │  ├─ check-grocery-item-service.ts
+ │  ├─ uncheck-grocery-item-service.ts
+ │  └─ remove-grocery-item-service.ts
+ ├─ view/
+ │  └─ grocery-item-views.ts        GroceryItemView, GroceryItemSeq, GroceryItemViews
+ ├─ infrastructure/
+ │  ├─ grocery-item-rows.ts         GroceryItemRows
+ │  ├─ memory-grocery-item-repository.ts
+ │  └─ memory-grocery-item-views.ts
+ └─ http/
+    ├─ grocery-item-api.ts          GroceryItemApi
+    ├─ grocery-item-http-errors.ts
+    └─ grocery-item-controller.ts   GroceryItemController
+ server.ts                          Node HTTP server, memory layers; a 1 second graceful shutdown, so open live lists don't hold a restart
```

### GroceryItemRepository (`domain/grocery-item-repository.ts`, `infrastructure/memory-grocery-item-repository.ts`)
Owns: loading the state a transition needs, and writing the event it returns.

```ts
findListedGroceryItemById({ groceryItemId }):   Effect<ListedGroceryItem,    GroceryItemNotFoundError | GroceryItemAlreadyRemovedError>
findUncheckedGroceryItemById({ groceryItemId }): Effect<UncheckedGroceryItem, GroceryItemNotFoundError | GroceryItemAlreadyCheckedError | GroceryItemAlreadyRemovedError>
findCheckedGroceryItemById({ groceryItemId }):   Effect<CheckedGroceryItem,   GroceryItemNotFoundError | GroceryItemAlreadyUncheckedError | GroceryItemAlreadyRemovedError>
findListedGroceryItemByName({ name }):           Effect<Option<ListedGroceryItem>>   // GroceryItemNameEquivalence, status not removed
publishGroceryItemEvent(event):                  Effect<void, GroceryItemEventWriteErrors[Tag]>

GroceryItemEventWriteErrors = ExhaustiveRecord<GroceryItemEvent["_tag"], {
  GroceryItemAddedEvent:     GroceryItemAlreadyExistsError | GroceryItemNameTakenError
  GroceryItemRenamedEvent:   GroceryItemChangedConcurrentlyError | GroceryItemNameTakenError
  GroceryItemCheckedEvent:   GroceryItemChangedConcurrentlyError
  GroceryItemUncheckedEvent: GroceryItemChangedConcurrentlyError
  GroceryItemRemovedEvent:   GroceryItemChangedConcurrentlyError
}>
```

```text
GroceryItemAddedEvent      add { status: "unchecked", name, addedAt: occurredOn, seq }
                           id taken → GroceryItemAlreadyExistsError; a listed item with the name → GroceryItemNameTakenError
GroceryItemRenamedEvent    set { name, seq }                                 guard: not removed, name = previousName
                           another listed item with the name → GroceryItemNameTakenError
GroceryItemCheckedEvent    set { status: "checked", checkedAt, seq }          guard: unchecked
GroceryItemUncheckedEvent  set { status: "unchecked", checkedAt: None, seq }  guard: checked
GroceryItemRemovedEvent    set { status: "removed", removedAt, seq }          guard: not removed
                           every set: guard fails → GroceryItemChangedConcurrentlyError
```

Each write is one `Ref.modify` over `state`: guard, rule 2 again, next seq, new row. Then it publishes the seq to `writtenSeqs`.

Cases (memory rows)
  find a removed item for check (rule 3)                 → GroceryItemAlreadyRemovedError
  find "MILK" while "Milk" is listed (rule 2)            → Some(Milk)
  find "Milk" while only a removed Milk exists (rule 5)  → None
  two adds of "Milk" past the rule at once (rule 2)      → the second write: GroceryItemNameTakenError
  rename Milk after another device renamed it            → GroceryItemChangedConcurrentlyError
  write any event                                        → the row's seq is the highest

### AddGroceryItemService.addGroceryItem (`application/add-grocery-item-service.ts`)
Owns: adding one item.

```text
AddGroceryItemService.addGroceryItem({ groceryItemId, name })
├─ GroceryItemRepository.findListedGroceryItemByName({ name })
│    : Effect<Option<ListedGroceryItem>>   → itemWithSameName
├─ addGroceryItem({ groceryItemId, name, itemWithSameName, now })
│    : Result<GroceryItemAddedEvent, GroceryItemNameTakenError>
└─ GroceryItemRepository.publishGroceryItemEvent(event)
     : Effect<void, GroceryItemAlreadyExistsError | GroceryItemNameTakenError>
```

Cases (memory rows, TestClock)
  add "Oat milk" to Milk (rule 1)              → listed, unchecked, addedAt now
  add "  milk " to Milk (rules 1, 2)            → GroceryItemNameTakenError
  add "Milk" after Milk was removed (rule 5)    → a new item
  add with a taken id                           → GroceryItemAlreadyExistsError

### RenameGroceryItemService.renameGroceryItem (`application/rename-grocery-item-service.ts`)
Owns: renaming one listed item.

```text
RenameGroceryItemService.renameGroceryItem({ groceryItemId, name })
├─ GroceryItemRepository.findListedGroceryItemById({ groceryItemId })
│    : Effect<ListedGroceryItem, GroceryItemNotFoundError | GroceryItemAlreadyRemovedError>
├─ GroceryItemRepository.findListedGroceryItemByName({ name })
│    : Effect<Option<ListedGroceryItem>>   → itemWithSameName
├─ renameGroceryItem({ item, name, itemWithSameName, now })
│    : Result<GroceryItemRenamedEvent, GroceryItemNameTakenError>
└─ GroceryItemRepository.publishGroceryItemEvent(event)
     : Effect<void, GroceryItemChangedConcurrentlyError | GroceryItemNameTakenError>
```

Cases (memory rows, TestClock)
  rename Eggs to "MILK" (rule 2)           → GroceryItemNameTakenError
  rename Milk to "milk" (rule 2)           → renamed
  rename a removed item (rule 3)           → GroceryItemAlreadyRemovedError
  renamed by another device in between     → GroceryItemChangedConcurrentlyError

### CheckGroceryItemService, UncheckGroceryItemService, RemoveGroceryItemService (`application/…-service.ts`)
Owns: one state change each.

```text
CheckGroceryItemService.checkGroceryItem({ groceryItemId })
├─ GroceryItemRepository.findUncheckedGroceryItemById({ groceryItemId })
│    : Effect<UncheckedGroceryItem, GroceryItemNotFoundError | GroceryItemAlreadyCheckedError | GroceryItemAlreadyRemovedError>
├─ checkGroceryItem({ item, now }) : Result<GroceryItemCheckedEvent, never>
└─ GroceryItemRepository.publishGroceryItemEvent(event)
     : Effect<void, GroceryItemChangedConcurrentlyError>

UncheckGroceryItemService.uncheckGroceryItem({ groceryItemId })   same shape, findCheckedGroceryItemById
RemoveGroceryItemService.removeGroceryItem({ groceryItemId })     same shape, findListedGroceryItemById
```

Cases (memory rows, TestClock)
  check Milk at 17:42 (rule 4)                       → checked, checkedAt 17:42
  check Milk checked at 17:42, at 17:43 (rule 4)      → GroceryItemAlreadyCheckedError, checkedAt stays 17:42
  check a removed item (rule 3)                       → GroceryItemAlreadyRemovedError
  remove a removed item (rule 5)                      → GroceryItemAlreadyRemovedError

### GroceryItemViews (`view/grocery-item-views.ts`, `infrastructure/memory-grocery-item-views.ts`)
Owns: what devices read: the items changed after a seq, and one item.

```ts
GroceryItemSeq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("GroceryItemSeq"))

GroceryItemStatusView = Schema.TaggedUnion({
  Unchecked: {},
  Checked:   { checkedAt: Schema.DateTimeUtc },
  Removed:   { removedAt: Schema.DateTimeUtc },
})
GroceryItemView = Schema.Struct({ groceryItemId, name, status: GroceryItemStatusView, addedAt, seq: GroceryItemSeq })
GroceryItemsView = Schema.Struct({ items: Schema.Array(GroceryItemView), lastSeq: GroceryItemSeq })

listGroceryItems({ afterSeq }):        Effect<GroceryItemsView>   // seq > afterSeq, ascending; lastSeq: the newest seq written
getGroceryItemById({ groceryItemId }): Effect<GroceryItemView, GroceryItemNotFoundError>
streamGroceryItems({ afterSeq }):      Stream<GroceryItemsView>   // listGroceryItems now, then again after each written seq past its lastSeq, and every 10 seconds
```

`streamGroceryItems` subscribes to `writtenSeqs` before its first read, so a write between the two is not missed. The first batch goes out even when empty: the client marks the collection ready on it. Later batches go out when they hold items, and every 10 seconds as a heartbeat, empty or not: a client that hears nothing for 25 seconds knows the connection is dead, as a phone's half-open connection or a dev proxy that outlives the server leaves it. A heartbeat's `lastSeq` lower than the client's tells it the server forgot the list (a restart of this mock).
It carries only the seq, never the row: a batch is a fresh read, so a skipped wake-up loses nothing.

The sync is the list with a filter, not an endpoint of its own: `afterSeq: 0` is the whole list, removed items included; a later `afterSeq` is what changed since. Each item appears once, as it is now: a device that missed five changes to Milk gets Milk as it is.
`Removed` is a status of the view, not a separate change type: a device deletes the row it holds when it reads one.
Commands answer with `getGroceryItemById`: its `seq` is what the client waits for in the list.

Cases (memory rows)
  list after 0 on Milk, Eggs (removed)     → Milk Unchecked, Eggs Removed
  list after the last seq                  → no items, lastSeq unchanged
  Milk checked, then renamed, after afterSeq → Milk once, with its latest seq
  stream after 0 on Milk, then add Eggs      → [Milk], then [Eggs]
  stream after the last seq                  → [] first

### GroceryItemController (`http/grocery-item-api.ts`, `http/grocery-item-controller.ts`)
Owns: the HTTP edge, retries included.

```ts
// commands: 200 GroceryItemView (201 for add)
POST   /grocery-items                      { groceryItemId, name }  addGroceryItem      NameTaken 409, AlreadyExists 409
PUT    /grocery-items/:groceryItemId/name  { name }                 renameGroceryItem   NotFound 404, AlreadyRemoved 409, NameTaken 409, ChangedConcurrently 409
POST   /grocery-items/:groceryItemId/check                          checkGroceryItem    NotFound 404, AlreadyRemoved 409, ChangedConcurrently 409
POST   /grocery-items/:groceryItemId/uncheck                        uncheckGroceryItem  NotFound 404, AlreadyRemoved 409, ChangedConcurrently 409
DELETE /grocery-items/:groceryItemId                                removeGroceryItem   NotFound 404, ChangedConcurrently 409
// views
GET    /grocery-items?afterSeq=                                     listGroceryItems    200 GroceryItemsView
GET    /grocery-items/live?afterSeq=                                streamGroceryItems  HttpApiSchema.StreamSse of GroceryItemsView
```

`/live` is the same list, held open: each SSE event is one `GroceryItemsView`.

Softened at the edge (rule 4, and the outbox's retries), answering the item as it is:

```text
checkGroceryItem   GroceryItemAlreadyCheckedError   → 200 getGroceryItemById
uncheckGroceryItem GroceryItemAlreadyUncheckedError → 200 getGroceryItemById
removeGroceryItem  GroceryItemAlreadyRemovedError   → 200 getGroceryItemById
addGroceryItem     GroceryItemAlreadyExistsError    → 201 getGroceryItemById, when its name is the one sent; else 409
```

A rename sent twice needs nothing: the second meets itself (rule 2) and its guard holds. So every command is safe to retry, and the outbox needs no idempotency key on the server.
Remove answers the removed item, not 204: the client waits for its `seq`.
A blank or long name fails the payload decode: 400, from `GroceryItemName`.

Cases (HTTP, memory rows)
  check twice (rule 4)                         → 200 both, the same item
  add the same id and name twice (a retry)     → the same item both times
  add an id again under another name           → 409 GroceryItemAlreadyExistsHttpError
  rename a removed item (rule 3)               → 409 GroceryItemAlreadyRemovedHttpError
  list after 0, then after its lastSeq         → every item, then none
  live after 0, another request adds an item   → an event with every item, then one with the add

## Sync contract

What the next spec's client relies on; the server above gives all of it.

```text
collection  TanStack DB, key groceryItemId, row GroceryItemView
sync        GET /grocery-items/live?afterSeq=lastSeq (EventSource); on each event:
            begin, write each item (Removed → delete, known → update, else insert), commit; markReady on the first; keep lastSeq
            on drop, reconnect with the newest lastSeq
writes      @tanstack/offline-transactions: one createOfflineAction per use case
            onMutate changes the row; its mutation calls the use case's endpoint,
            then waits until the list's lastSeq reaches the answer's seq, so the optimistic row hands over without a flicker
offline     the outbox (IndexedDB, leader tab) keeps the writes and sends them in order once online; a network error retries
refused     a 4xx throws NonRetriableError: the outbox drops it and its optimistic change rolls back; the list already holds the truth
```

Rejected: polling: a change would show up to an interval late, and every device would read every second while nothing changes.
Rejected: a WebSocket: the list only flows one way; writes are the endpoints above.
Rejected: the collection's generic `onUpdate`: it gives a diff of fields, and the client would guess the intent from it (`checked` flipped → check or uncheck?).

## Built

Code: `server/src/grocery-item/`, wired in `server/src/server.ts`. Run: `npm run dev:server` (port 3001).
Tests: `server/test/`: rule 2 (`grocery-item-rule.test.ts`), the guarded writes and the race on rule 2 (`memory-grocery-item-repository.test.ts`), the list after a seq and the live stream (`memory-grocery-item-views.test.ts`), the retries the edge answers (`grocery-item-controller.test.ts`). Rules 1, 3, 4, 5 are held by the types (`GroceryItemName`, the narrowing finds) and the two-device run in `client/e2e/`.
