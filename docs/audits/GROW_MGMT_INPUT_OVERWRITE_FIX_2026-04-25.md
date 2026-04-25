# Grow Management — User Inputs Being Overwritten (2026-04-25)

**Status:** Diagnosis complete; patches drafted but not applied.
**Page affected:** `https://greenreachgreens.com/LE-farm-admin.html#growing/grow-management` (also the standalone `/views/grow-management.html` and the Central mirror).
**Severity:** P0 — page is currently unusable for any non-dim input. Every save by any source wipes in-flight edits. Recent April work has aggravated, not caused, the underlying defect.
**Related docs:**
- `docs/audits/SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md` — required prerequisite for the bidirectional sync to work end-to-end.
- `docs/audits/GROW_MANAGEMENT_FULL_AUDIT_2026-04-24.md` — original audit.
- `docs/operations/GROUPS_PERSISTENCE_FIX_2026-04-24.md` — describes the intended bidirectional contract (§ "Bidirectional Sync").
- `docs/playbooks/10-farm-builder.md` — confirms 3D viewer is the operator's primary surface.

---

## TL;DR

The Grow Management page has a refresh-on-SSE loop that re-renders the form when any data change is announced by LE. The protection against destroying in-flight user input is **only** scoped to inputs carrying the `data-room-dim` attribute. Every other input on the page (zone count, room name, build plan sliders, group fields, anything added in future) is destroyed and re-created during refresh, losing whatever the user was typing.

Recent April work added more `emitDataChange()` calls on the server (rooms + zones + groups + target-ranges per save) and the GCS mirror made saves more reliable, both of which increased the rate at which the refresh loop fires. The defect has been latent for months; the recent reliability work made it observable as "the page does not allow user inputs."

The 3D viewer's drag-and-drop layout edits also currently fail to round-trip to LE because of the split-brain POST bug captured in the prior doc. So the bidirectional contract the docs describe is partially broken in two independent places.

This document covers the input-overwrite defect. The split-brain POST defect is covered in `SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md`; both should ship together.

---

## 1. Symptom

- Operator opens `/LE-farm-admin.html#growing/grow-management`.
- Begins typing in any field that is not a Length / Width / Height dim input.
- Within ~250 ms–1 s the field's value resets to the previous server-side value, or the input element is destroyed mid-keystroke and a fresh empty one takes its place.
- Behaviour is most reproducible when:
  - The 3D viewer is open in another tab (it emits SSE/DataFlowBus events on drag-save).
  - E.V.I.E. is performing background tool calls.
  - The page just finished its own save (the save's own SSE echo wipes the next field the operator moves to).

The user-visible description "the page does not allow for user inputs" is correct: the input element does not stay alive long enough to accept and save a value.

---

## 2. Root cause (layered)

### 2.1 The refresh-on-SSE loop, by design

`greenreach-central/public/views/grow-management.html` (mirrored at `public/views/grow-management.html`):

```
L2640-2654: wireLiveUpdates()
  es = new EventSource('/events');
  ['data-change','rooms-updated','groups-updated','zones-updated']
    .forEach(evt => es.addEventListener(evt, scheduleRefresh));

L2644-2647: scheduleRefresh()
  debounceTimer = setTimeout(refresh, 250);

L2575-2594: refresh()
  load().then(() => {
    var dimFocused = document.activeElement
      && document.activeElement.getAttribute('data-room-dim');
    var hasPendingDimEdits = Object.keys(_pendingRoomDimEdits).length > 0;
    if (!dimFocused && !hasPendingDimEdits) renderRoom();
    renderZones();
    renderEquipment();
    renderControllers();
    renderSelectionSummarySidebar();
    updateBreadcrumb();
  });
```

The guard at L2583-2587 is the only protection. It only suppresses `renderRoom()`, and only if the focused element has the `data-room-dim` attribute. `renderZones()`, `renderEquipment()`, `renderControllers()`, and `renderSelectionSummarySidebar()` always fire and always tear down their inputs.

### 2.2 Each save fan-outs to multiple SSE events

`server-foxtrot.js` `/api/setup/save-rooms` handler (L7894-7896, plus L7884 conditionally):

```
emitDataChange({ kind: 'target-ranges', ... });   // optional, when seeder fires
emitDataChange({ kind: 'rooms', ... });
emitDataChange({ kind: 'zones', ... });
emitDataChange({ kind: 'groups', ... });
```

So one POST fires 3-4 SSE events. The page debounces these into a single refresh in 250 ms, but the page is otherwise in a refresh state that long after every save. Other handlers (`L25269`, `L26064`, `L26955`, `L26978`, `L28899-L28910`, `L28958`, `L29044`, `L33526`) emit additional `data-change` events on every group write, room-map write, zone-bulk-assign, tray-seed, etc. The page has no way to know whether an SSE event is its own echo or someone else's edit.

### 2.3 Cross-tab and cross-iframe amplification

`public/js/data-flow-bus.js` documents the cross-tab contract: every save writes a versioned key to `localStorage`, and "popups (e.g. the 3D viewer, planting scheduler, AI crop recommendations)" subscribe via the `storage` event. So when the 3D viewer is open in another tab and the operator drags equipment:

```
greenreach-central/public/js/3d-farm-viewer-v2.js:790-816
  endDrag()
    → mutates state.groups[*].customization.placement
    → POST /data/groups.json
```

Even if the POST never reaches LE (per the split-brain bug), if anything in 3D viewer's loadData / SSE wireup emits a DataFlowBus event, every other open tab listening on `groups` refreshes — and grow-management is one of those listeners.

### 2.4 The split-brain write bug compounds it

Per `docs/audits/SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md`: 3D viewer POSTs `/data/groups.json` (line 803). On Central this is intercepted by `farmDataWriteMiddleware` and lands in Postgres `farm_data` only — never reaches LE's GCS-backed groups.json. The grow-management page then refreshes from LE (correctly proxied via GET) and sees the *old* groups, so the user's experience is "I touched the 3D view and Grow Mgmt didn't reflect it, then the page wiped my edits anyway."

### 2.5 Why this looks like a recent regression

The latent defect has been present since `wireLiveUpdates` was introduced. Three recent changes amplified its visibility:

1. **GCS mirror (`docs/operations/GROUPS_PERSISTENCE_FIX_2026-04-24.md`)** made saves durable across container recycles. Before, many saves vanished and didn't propagate; now every save propagates correctly, including its own SSE echo back to the page.
2. **Multi-emit in `/api/setup/save-rooms`** (the L7884–L7896 cluster) added `target-ranges`/`zones`/`groups` emits in addition to `rooms`. Each save fires 3-4 events instead of 1.
3. **3D viewer drag-and-drop edit mode** (recent feature) increased the rate of cross-tab writes that emit SSE.

None of these are wrong. They just lit up a defect that was there all along.

---

## 3. The fix

The minimum viable fix has three parts. Apply all three together; partial fixes will still leave some inputs vulnerable.

### 3.1 Broaden the input-protection guard

**File:** `greenreach-central/public/views/grow-management.html` (and mirror to `public/views/grow-management.html`).
**Function:** `refresh()` at L2575-2594.

**Before:**

```js
function refresh() {
  load().then(function () {
    var dimFocused = document.activeElement &&
      typeof document.activeElement.getAttribute === 'function' &&
      document.activeElement.getAttribute('data-room-dim');
    var hasPendingDimEdits = Object.keys(_pendingRoomDimEdits).length > 0;
    if (!dimFocused && !hasPendingDimEdits) renderRoom();
    renderZones();
    renderEquipment();
    renderControllers();
    renderSelectionSummarySidebar();
    updateBreadcrumb();
  });
}
```

**After:**

```js
function refresh() {
  load().then(function () {
    // GENERAL input-focus guard: if the user is mid-edit on ANY input,
    // textarea, or contenteditable inside the Grow Mgmt page, skip every
    // re-render that destroys DOM nodes. The user's input element must
    // survive until they blur or submit.
    var ae = document.activeElement;
    var page = document.getElementById('flow-room')
      || document.querySelector('[data-page="grow-management"]')
      || document.body;
    var userTyping = ae
      && page.contains(ae)
      && (ae.tagName === 'INPUT'
       || ae.tagName === 'TEXTAREA'
       || ae.tagName === 'SELECT'
       || ae.isContentEditable === true);

    var hasPendingDimEdits = Object.keys(_pendingRoomDimEdits).length > 0;

    // Only the chip / status / breadcrumb readers are safe to update while
    // the user is typing — they don't tear down inputs.
    renderSelectionSummarySidebar();
    updateBreadcrumb();

    if (userTyping || hasPendingDimEdits) {
      // Defer the destructive renders until the user yields focus.
      // Re-attempt once on blur via a one-shot listener.
      var deferred = function () {
        document.removeEventListener('focusout', deferred, true);
        // Re-check that nothing else grabbed focus in the same tick.
        setTimeout(function () {
          var ae2 = document.activeElement;
          var stillTyping = ae2 && page.contains(ae2)
            && (ae2.tagName === 'INPUT' || ae2.tagName === 'TEXTAREA'
             || ae2.tagName === 'SELECT' || ae2.isContentEditable === true);
          if (!stillTyping) {
            renderRoom();
            renderZones();
            renderEquipment();
            renderControllers();
          }
        }, 50);
      };
      document.addEventListener('focusout', deferred, true);
      return;
    }

    renderRoom();
    renderZones();
    renderEquipment();
    renderControllers();
  });
}
```

This generalises the existing dim-input protection to every input on the page and defers the destructive re-renders until the user actually yields focus.

### 3.2 Suppress the page's own save echo

**File:** same.
**Functions:** `persistRooms()` at L1734 and the SSE handler at L2640-2654.

Add an "echo token" so the page can ignore its own write coming back through SSE.

**Patch — at top of the IIFE (near the existing state vars around L1675):**

```js
var _selfEchoSuppressUntil = 0;  // ms timestamp; SSE before this is ignored as our own echo
```

**Patch — inside `persistRooms()`, immediately before the `return _fetch(...)`:**

```js
// Mark the next ~2s of SSE traffic as our own save's echo. Server emits
// rooms/zones/groups/target-ranges fan-out within ~1s; we don't want any
// of those to retrigger refresh() and wipe user input.
_selfEchoSuppressUntil = Date.now() + 2000;
```

**Patch — replace `scheduleRefresh()` body in `wireLiveUpdates()`:**

```js
function scheduleRefresh() {
  if (Date.now() < _selfEchoSuppressUntil) return;  // ignore our own echo
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function () { refresh(); }, 250);
}
```

Also apply the same `_selfEchoSuppressUntil` write in the zone-count save block at L2754–2772 (already documents the same hazard) and in any other in-page save site (`scheduleSaveRooms`, build-plan save, group save).

### 3.3 Collapse the server-side emit storm

**File:** `server-foxtrot.js`, `/api/setup/save-rooms` handler at L7894-7896.

**Before:**

```js
emitDataChange({ kind: 'rooms', updatedAt: nowIso, source: 'setup-save-rooms' });
emitDataChange({ kind: 'zones', updatedAt: nowIso, source: 'setup-save-rooms' });
emitDataChange({ kind: 'groups', updatedAt: nowIso, source: 'setup-save-rooms-reconcile' });
```

**After:**

```js
// Single composite event. The page (and 3D viewer) listen to multiple kinds
// but always call the same scheduleRefresh(); collapsing to one event
// removes the 3-4× refresh pile-up that was wiping in-flight user input
// (see docs/audits/GROW_MGMT_INPUT_OVERWRITE_FIX_2026-04-25.md).
emitDataChange({
  kind: 'data-change',
  updatedAt: nowIso,
  source: 'setup-save-rooms',
  affected: ['rooms', 'zones', 'groups']
});
```

Also remove the standalone `target-ranges` emit at L7884 and append `'target-ranges'` to the `affected` array when `seededZoneRangesCount > 0`.

Update the SSE listener in `grow-management.html` (and `3d-farm-viewer-v2.js:1202`) to inspect `affected[]` rather than dispatching one refresh per kind, so multi-kind saves still trigger a single refresh.

### 3.4 Hard dependency

Apply `docs/audits/SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md` first or in the same deploy. Without it, the 3D viewer drag-and-drop save still doesn't reach LE, so the bidirectional contract remains broken even after the input-overwrite defect is fixed.

---

## 4. Validation

`node --check` is **not** sufficient. This requires interactive testing against a deployed Central revision, plus an SSE-trace check.

### 4.1 Pre-flight: enable the page's built-in tracer

The page ships with a debug instrument at L3600+ (`window.GM_DEBUG`). In the browser console on the deployed page:

```js
sessionStorage.setItem('gm_debug_enabled', '1');
location.reload();
```

This will log every `ffFlow.refresh` call, every SSE event, every `__ffFlowRooms` write, and every traced custom event. Use this trace to verify the fix is doing what's expected.

### 4.2 Single-tab input survival

1. Open `/LE-farm-admin.html#growing/grow-management`.
2. Begin typing in **any non-dim** input — e.g. zone name, room name, build plan unit count.
3. Without blurring, observe the GM_DEBUG log for `📡 SSE event` lines.
4. Trigger a server-side change via a separate channel (e.g. another tab calling `POST /api/setup/save-rooms`, or an E.V.I.E. tool call). This must produce SSE events.
5. **Expected:** `📣 dispatchEvent: data-change` appears, but the input you are typing in is **not** destroyed and your value is **not** reset.
6. Blur the input. The deferred re-render should now run.

### 4.3 Self-echo suppression

1. With GM_DEBUG enabled, change a room dimension and tab away to fire the 500 ms save.
2. Watch the log for `→ ffFlow.refresh()` calls.
3. **Expected:** zero `ffFlow.refresh()` calls in the 2 s after the save's own POST resolved. Other tabs' refreshes are still allowed.

### 4.4 Bidirectional sync round-trip

(Requires the SPLIT_BRAIN_WRITE_PATH_FIX deployed.)

1. Open `/views/grow-management.html` in tab A.
2. Open `/views/3d-farm-viewer.html` in tab B.
3. In tab B, enable Edit mode and drag a system to a new position. Wait for `Saved layout` toast.
4. **Expected in tab A:** within ~1 s, the equipment summary and breadcrumb refresh; the new placement coordinates are visible in any group inspector. No focused input in tab A is destroyed (test with one focused).
5. In tab A, change the zone count. Save.
6. **Expected in tab B:** within ~1 s, the 3D scene rebuilds with the new zone count; running with GM_DEBUG-equivalent in 3D viewer should show one SSE event firing one `loadData() → buildScene()`.

### 4.5 Refresh-storm regression check

1. Load both pages with GM_DEBUG / equivalent.
2. Trigger one `/api/setup/save-rooms` (any save).
3. **Expected:** exactly one `data-change` SSE event arrives on each subscriber and exactly one `refresh()` runs. Pre-fix, you would see 3-4 SSE events and one debounced refresh; post-fix, one event fires that one refresh.

---

## 5. What this fix does NOT close

| Item | Status | Where to address |
|------|--------|------------------|
| 3D viewer drag-save not reaching LE (split-brain POST) | OPEN — covered separately | `SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md` |
| E.V.I.E. tools writing to `farmStore` instead of LE | OPEN | Followup — see prior doc §4 |
| `/api/sync/{rooms,groups}` dead-write into `farm_data` | OPEN | Followup — see prior doc §4 |
| `reconcileGroupsFromRooms()` orphan-drop on sparse payload | OPEN | Followup — separate fix; this defect is unrelated |
| The page's monolithic IIFE (~3500 LOC of inline JS) | OPEN | Refactor candidate; out of scope for this incident |
| 3D viewer becoming the primary surface | DESIGN — needs sequencing | See playbooks 10 + 00 |

The fixes in this doc address the **immediate symptom** (page is unusable) and **enable** the bidirectional sync the docs already specify, but do not close every drift surface.

---

## 6. Why the 3D viewer becomes the primary surface

`docs/playbooks/10-farm-builder.md` §1 establishes the design intent:

> "Light Engine Foxtrot today treats farm setup as **passive**: the operator tells the system what equipment exists … The Farm Builder flips this … operators are users of a recommendation, not authors of a bill of materials."

§4 then names `public/views/3d-farm-viewer.html` as the surface that "renders accepted proposals; supports preview overlay for draft proposals." Combined with the bidirectional sync section in the persistence-fix doc (§ "Bidirectional Sync"), the contract is:

- 3D viewer is the operator's primary interaction (drag, select, inspect, accept).
- Grow Management page becomes the structured fallback / detail editor.
- Both subscribe to LE's SSE stream and to `DataFlowBus` cross-tab events.
- Any edit on either surface propagates to the other within ~1 s.

For that contract to hold:

1. Writes on either surface must reach **LE's canonical store** (today: 3D viewer `POST /data/groups.json` does not — see split-brain doc).
2. SSE-driven refreshes on the receiving surface must **not destroy in-flight user input** (today: grow-management refresh wipes any non-dim input — this doc).
3. The two surfaces must **emit the same event vocabulary** so neither is deaf to the other (today: both listen to `data-change`/`rooms-updated`/`groups-updated`/`zones-updated`; the proposed §3.3 collapses server-side fan-out to a single `data-change` with an `affected[]` array, which both subscribers can handle).

After 3.1 + 3.2 + 3.3 + the split-brain write fix, the bidirectional contract from the docs becomes operational.

---

## 7. Recommended commit message

```
fix(grow-mgmt): stop wiping in-flight user input on SSE refresh

Symptom: operators reported "the page does not allow user inputs" on
/LE-farm-admin.html#growing/grow-management. Any field outside Length /
Width / Height was reset within ~250 ms-1 s of typing.

Root cause (layered):
- refresh()'s focus-protection guard only covered [data-room-dim] inputs.
  Every other input was destroyed by the cascade of renderZones() /
  renderEquipment() / renderControllers() during refresh.
- /api/setup/save-rooms emits 3-4 SSE events (rooms + zones + groups +
  optional target-ranges) per save. The page debounces these into one
  refresh, but every save and every cross-tab write fires that refresh.
- The page had no way to ignore its own save's SSE echo, so even
  single-tab edits triggered the wipe.

Fix:
1. refresh() now skips destructive re-renders if ANY input/textarea/
   select/contenteditable inside the page has focus. Deferred renders
   resume on focusout.
2. Introduces _selfEchoSuppressUntil — a 2 s window during which SSE
   events from the page's own save are ignored.
3. Collapses the server-side rooms/zones/groups fan-out into a single
   data-change event with an affected[] array. Subscribers (this page +
   3D viewer) read affected[] instead of dispatching per-kind refreshes.

Validation: docs/audits/GROW_MGMT_INPUT_OVERWRITE_FIX_2026-04-25.md
sections 4.2, 4.3, 4.5. Bidirectional round-trip in 4.4 also requires the
SPLIT_BRAIN_WRITE_PATH_FIX patch from the same audit folder.

Does NOT close: split-brain POST, EVIE/farm-ops-agent direct farmStore
writes, /api/sync/{rooms,groups} dead-write, sparse-payload orphan-drop
in reconcileGroupsFromRooms. See same doc §5.
```

---

## 8. Deploy notes

- The grow-management.html change must be applied to **both** copies (`greenreach-central/public/views/grow-management.html` is authoritative per `.github/CLOUD_ARCHITECTURE.md`; copy to `public/views/grow-management.html` after editing).
- Per the dual-deploy rule, this is a Central + LE change. Build and deploy both services from the same SHA.
- The server-foxtrot.js change requires only LE redeploy.
- The 3d-farm-viewer-v2.js subscriber update (to read `affected[]`) requires LE redeploy.
- Bundle this with `SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md` so the bidirectional contract works end-to-end on first deploy.
- Per the README branch-drift warning: confirm no in-flight grow-management work on side branches before deploying.

---

## 9. Followup items

In order of marginal value:

1. **Apply SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md** alongside this fix. Without it, the 3D viewer drag-save still doesn't round-trip to LE.
2. **Add a contract test** that asserts `refresh()` does not destroy a focused input. Cheap to write; would have caught this defect months ago.
3. **Audit the other emitDataChange call sites** (server-foxtrot.js L25269, L26064, L26955, L26978, L28899-L28910, L28958, L29044, L33526) and convert them to the new single-event-with-affected-array shape.
4. **Reduce or eliminate the IIFE blob** at the bottom of grow-management.html. The 3500-line inline script makes refactors like this far more dangerous than they should be.
5. **Move the operator's primary surface to the 3D viewer** per playbook 10. Once the bidirectional sync works reliably, Grow Mgmt can become a detail editor invoked from the viewer rather than an alternate authoring surface.
