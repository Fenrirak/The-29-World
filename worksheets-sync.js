/* Private, per-teacher worksheet sync. Local drafts are journalled before
   network writes; revision-checked transactions preserve concurrent edits.
   One record per worksheet avoids a single growing library document.
   Dependencies are injected so the actual sync code can run in offline tests. */
(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const safeId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,180}$/.test(id);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Firestore forbids arrays directly inside arrays. Keep the editor/local
  // backup format intact, and wrap table rows only at the network boundary.
  function cloudRecord(value, encode) {
    if (value?.kind !== "sheet" || !Array.isArray(value.sheet?.blocks)) return value;
    return { ...value, sheet: { ...value.sheet, blocks: value.sheet.blocks.map(block =>
      block?.type !== "table" || !Array.isArray(block.rows) ? block : { ...block, rows: block.rows.map(row =>
        encode ? { cells: row } : Array.isArray(row) ? row : row?.cells) }) } };
  }

  function create(options) {
    const { db, username, storage, key, normalizeSheet, defaultIds, onChange, serverTimestamp } = options;
    const col = db.collection("teacherWorksheets/" + username + "/sheets");
    const makeId = options.makeId || (() => crypto.randomUUID());
    const online = options.online || (() => navigator.onLine !== false);
    const wait = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const state = { v: 1, heads: Object.create(null), pending: Object.create(null), prefs: clone(options.legacy?.prefs || {}) };
    const holds = new Map();
    let localOK = true, ready = false, loaded = false, error = null, stopped = false, unsub = null;
    let timer = null, retryTimer = null, running = null, retryDelay = 2000;
    let sending = null;
    const journalPrefix = key + ":draft:";
    function removeJournal(op) {
      try { storage.removeItem(journalPrefix + op.mutationId); } catch (_) { /* safe to recover again */ }
    }

    function payload(value, id) {
      if (!value || !["sheet", "default", "hidden", "deleted"].includes(value.kind)) return null;
      if (value.kind !== "sheet") return { kind: value.kind, sheet: null };
      const sheet = normalizeSheet(value.sheet);
      if (!sheet || !sheet.moduleKey) return null;
      sheet.id = id;
      return { kind: "sheet", sheet };
    }
    function record(value, id) {
      const p = payload(cloudRecord(value, false), id);
      return p && Number.isSafeInteger(value.revision) && value.revision > 0
        ? { ...p, revision: value.revision, mutationId: String(value.mutationId || "") } : null;
    }
    function base(id) { return state.heads[id]?.revision || 0; }
    function view() {
      const values = Object.assign(Object.create(null), state.heads);
      holds.forEach((held, id) => { values[id] = held.value; });
      Object.assign(values, state.pending);
      const result = { v: 1, sheets: Object.create(null), hidden: [], prefs: clone(state.prefs) };
      for (const [id, value] of Object.entries(values)) {
        if (value?.kind === "sheet") result.sheets[id] = clone(value.sheet);
        else if (value?.kind === "hidden") result.hidden.push(id);
      }
      return result;
    }
    function persist() {
      try {
        // Separate mutation keys prevent one tab's cache snapshot from
        // overwriting another tab's unsynced edits. Only acknowledged or
        // superseded mutations are removed from this durable outbox.
        for (const [id, op] of Object.entries(state.pending)) storage.setItem(journalPrefix + op.mutationId, JSON.stringify({ id, ...op }));
        storage.setItem(key, JSON.stringify({ ...state, pending: {} })); localOK = true;
      }
      catch (_) { localOK = false; }
      return localOK;
    }
    function emit(extra) {
      if (!stopped && onChange) onChange(view(), { ready, loaded, localOK, error, online: online(),
        pending: Object.keys(state.pending).length, saving: !!running, ...extra });
    }
    function queue(id, value, migration) {
      if (!safeId(id)) throw new Error("Invalid worksheet id");
      const p = payload(value, id);
      if (!p) throw new Error("Invalid worksheet draft");
      const previous = state.pending[id];
      if (previous && same(payload(previous, id), p)) return;
      if (!previous && same(payload(state.heads[id], id), p)) return;
      state.pending[id] = { ...p, mutationId: makeId(),
        baseRevision: previous ? previous.baseRevision : holds.has(id) ? holds.get(id).revision : base(id),
        migration: !!migration };
      persist();
      if (localOK && previous && previous.mutationId !== sending) removeJournal(previous);
      emit(); schedule();
    }

    // A v2 journal is authoritative after the first migration. The old v1
    // local file remains untouched, so upgrading never erases its backup.
    let cached = null;
    try { cached = JSON.parse(storage.getItem(key) || "null"); } catch (_) { /* recover from legacy below */ }
    if (cached?.v === 1 && cached.heads && cached.pending) {
      state.prefs = cached.prefs || state.prefs;
      for (const [id, value] of Object.entries(cached.heads)) {
        if (safeId(id)) { const r = record(value, id); if (r) state.heads[id] = r; }
      }
      for (const [id, value] of Object.entries(cached.pending)) {
        if (!safeId(id)) continue;
        const p = payload(value, id);
        if (p && typeof value.mutationId === "string" && Number.isSafeInteger(value.baseRevision)) {
          state.pending[id] = { ...p, mutationId: value.mutationId, baseRevision: value.baseRevision, migration: !!value.migration };
        }
      }
    } else {
      for (const [id, sheet] of Object.entries(options.legacy?.sheets || {})) {
        if (safeId(id)) state.pending[id] = { ...payload({ kind: "sheet", sheet }, id), mutationId: makeId(), baseRevision: 0, migration: true };
      }
      for (const id of options.legacy?.hidden || []) {
        if (safeId(id)) state.pending[id] = { kind: "hidden", sheet: null, mutationId: makeId(), baseRevision: 0, migration: true };
      }
    }
    // Recover unacknowledged changes from a closed/offline tab too. If
    // several tabs left different edits to one sheet, keep separate copies.
    try {
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(journalPrefix));
      for (const journalKey of keys) {
        let op;
        try { op = JSON.parse(storage.getItem(journalKey)); } catch (_) { continue; }
        if (!op || !safeId(op.id) || typeof op.mutationId !== "string" || !Number.isSafeInteger(op.baseRevision)) continue;
        let id = op.id, p = payload(op, id);
        if (!p) continue;
        if (state.pending[id]?.mutationId === op.mutationId) continue;
        if (state.pending[id] && p.kind === "sheet") {
          id = "c-recovered-" + op.mutationId;
          p.sheet.id = id; p.sheet.title = (p.sheet.title || "Untitled worksheet") + " (recovered from this device)";
          op.baseRevision = 0;
        } else if (state.pending[id]) continue;
        state.pending[id] = { ...p, mutationId: op.mutationId, baseRevision: op.baseRevision, migration: !!op.migration };
      }
    } catch (_) { localOK = false; }
    persist();

    function schedule(delay = 450) {
      if (stopped) return;
      cancel(timer); timer = wait(() => { timer = null; flush(); }, delay);
    }
    async function commit(id, op) {
      // The fork id is stable across retries, including an uncertain commit
      // acknowledgement. Transaction callbacks never mutate local state.
      const forkId = "c-sync-" + op.mutationId;
      return db.runTransaction(async tx => {
        const ref = col.doc(id), snap = await tx.get(ref);
        const remote = snap.exists ? record(snap.data(), id) : null;
        if (snap.exists && !remote) throw new Error("Unsupported worksheet record");
        if (remote?.mutationId === op.mutationId || same(payload(remote, id), payload(op, id))) {
          return { id, saved: remote };
        }
        if ((remote?.revision || 0) !== op.baseRevision) {
          if (op.kind !== "sheet") return { id, saved: remote, conflict: !op.migration, stale: true };
          const forkRef = col.doc(forkId), forkSnap = await tx.get(forkRef);
          const existing = forkSnap.exists ? record(forkSnap.data(), forkId) : null;
          if (forkSnap.exists && existing?.mutationId !== op.mutationId) throw new Error("Worksheet copy id collision");
          const sheet = clone(op.sheet);
          sheet.id = forkId;
          sheet.title = (sheet.title || "Untitled worksheet") + (op.migration ? " (recovered from this device)" : " (conflict copy)");
          const fork = existing || { kind: "sheet", sheet, revision: 1, mutationId: op.mutationId };
          if (!existing) tx.set(forkRef, { ...cloudRecord(fork, true), v: 1, updatedAt: serverTimestamp() });
          return { id, saved: remote, forkId, fork, conflict: true };
        }
        const saved = { ...payload(op, id), revision: (remote?.revision || 0) + 1, mutationId: op.mutationId };
        tx.set(ref, { ...cloudRecord(saved, true), v: 1, updatedAt: serverTimestamp() });
        return { id, saved };
      });
    }
    async function drain() {
      let failure = null;
      try {
        while (!stopped && online()) {
          const id = Object.keys(state.pending)[0];
          if (!id) break;
          const sent = clone(state.pending[id]); sending = sent.mutationId;
          const result = await commit(id, sent);
          const later = state.pending[id]?.mutationId !== sent.mutationId ? state.pending[id] : null;
          if (result.saved) state.heads[id] = result.saved;
          else delete state.heads[id];
          if (result.forkId) {
            state.heads[result.forkId] = result.fork;
            delete state.pending[id];
            if (later) {
              const sheet = later.sheet && { ...later.sheet, id: result.forkId,
                title: (later.sheet.title || "Untitled worksheet") + (sent.migration ? " (recovered from this device)" : " (conflict copy)") };
              state.pending[result.forkId] = { ...later, sheet, baseRevision: result.fork.revision, migration: false };
            }
            if (holds.has(id)) {
              holds.delete(id); holds.set(result.forkId, { revision: result.fork.revision, value: result.fork });
            }
          } else if (!later) delete state.pending[id];
          else if (!result.stale) later.baseRevision = result.saved?.revision || 0;
          // Preserve a newer held edit, but update its acknowledged base.
          if (holds.has(id) && !result.conflict) holds.set(id, { revision: result.saved?.revision || 0,
            value: later || result.saved || { kind: "default", sheet: null } });
          ready = true; error = null; retryDelay = 2000;
          persist(); removeJournal(sent); sending = null;
          emit({ conflict: result.conflict, redirect: result.forkId ? { from: id, to: result.forkId } : null });
        }
      } catch (err) { failure = err; error = err; }
      finally {
        running = null; sending = null; persist(); emit();
        if (failure && !stopped && !["permission-denied", "unauthenticated", "invalid-argument", "resource-exhausted"].includes(failure.code)) {
          cancel(retryTimer); retryTimer = wait(() => { retryTimer = null; flush(); }, retryDelay);
          retryDelay = Math.min(30000, retryDelay * 2);
        }
      }
    }
    function flush() {
      cancel(timer); timer = null;
      if (stopped || running || !online() || !Object.keys(state.pending).length) { emit(); return running || Promise.resolve(); }
      // Defer drain by one microtask so synchronous test transports and
      // empty queues cannot clear running before it has been assigned.
      running = Promise.resolve().then(drain); emit(); return running;
    }
    function listen() {
      if (unsub) unsub();
      unsub = col.onSnapshot(snap => {
        if (stopped || snap.metadata?.fromCache || snap.metadata?.hasPendingWrites) return;
        const next = Object.create(null);
        snap.forEach(doc => { if (safeId(doc.id)) { const r = record(doc.data(), doc.id); if (r) next[doc.id] = r; } });
        state.heads = next; ready = true; loaded = true; error = null; persist(); emit(); schedule(0);
      }, err => { error = err; unsub = null; emit(); });
    }
    return {
      view,
      put(sheet) { queue(sheet.id, { kind: "sheet", sheet }); },
      mark(id, kind) { queue(id, { kind, sheet: null }); },
      setPrefs(prefs) { state.prefs = clone(prefs); persist(); },
      hold(id) {
        if (!holds.has(id)) holds.set(id, { revision: state.pending[id]?.baseRevision ?? base(id),
          value: clone(state.pending[id] || state.heads[id] || { kind: "default", sheet: null }) });
      },
      release(id) { if (holds.delete(id)) emit(); },
      replace(data) {
        const ids = new Set([...Object.keys(state.heads), ...Object.keys(state.pending), ...Object.keys(data.sheets), ...data.hidden]);
        for (const id of ids) queue(id, data.sheets[id] ? { kind: "sheet", sheet: data.sheets[id] }
          : { kind: data.hidden.includes(id) ? "hidden" : defaultIds.has(id) ? "default" : "deleted", sheet: null });
        state.prefs = clone(data.prefs); persist(); emit();
      },
      start() { stopped = false; listen(); emit(); schedule(0); },
      retry() { error = null; cancel(retryTimer); retryTimer = null; if (!unsub) listen(); return flush(); },
      flush,
      stop() { persist(); stopped = true; cancel(timer); cancel(retryTimer); if (unsub) unsub(); unsub = null; },
      persist,
      status() { return { localOK, pending: Object.keys(state.pending).length, ready, loaded, error }; }
    };
  }
  root.T29WorksheetSync = { create };
})(typeof window !== "undefined" ? window : globalThis);
