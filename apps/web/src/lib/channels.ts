// Canonical telemetry channel registry — the single source of truth for channel
// identity across every parser and consumer.
//
// Problem this solves: each parser used to emit its own display-name keys into
// `GpsSample.extraFields` ("Lat G", "RPM", "Accel X", "Water Temp"…). Those keys
// doubled as the field's identity everywhere — chart toggles, settings
// field-default hide/show, stored graph-prefs, saved video-overlay configs — so
// "hide RPM by default" only matched the one parser whose spelling you'd seen.
//
// Here we define a stable `ChannelId` per physical quantity. Parsers resolve the
// raw log/column name to a `ChannelId` and key `extraFields` by it; the UI reads
// `label`/`unit` for display. A default like "hide RPM" then applies regardless
// of which logger produced the file.
//
// G-force note: lateral/longitudinal g is modelled as DISTINCT ids per source —
// `lat_g`/`lon_g` (primary; GPS-derived when computed), `lat_g_native`/
// `lon_g_native` (logger-reported native g), and `accel_x/y/z` (raw body-frame
// IMU). These legitimately coexist on one sample (e.g. Alfano reports native g
// while we also derive g from GPS), so they must never collapse to one key.

import type { ParsedData } from "@/types/racing";
import {
  channelLabel,
  channelUnit,
  isKnownChannel,
  resolveChannelId,
} from "@lapwing/telemetry-core";
export {
  CHANNELS,
  channelLabel,
  channelUnit,
  getChannelDef,
  isKnownChannel,
  resolveChannelId,
  type ChannelDef,
  type ChannelId,
} from "@lapwing/telemetry-core";

/**
 * Stable key for a channel with no canonical mapping (a custom logger column).
 * Slugged so the same raw column always yields the same key — `custom:` prefixed
 * so it can never collide with a canonical id. Consumers display the original
 * name via the field's label, not this key.
 */
export function customChannelId(rawName: string): string {
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `custom:${slug || "field"}`;
}

/**
 * Resolve a raw name to its stable storage key: a `ChannelId` when known, else a
 * `custom:`-prefixed slug. This is the identity parsers write into `extraFields`
 * and that settings/graph-prefs/overlays key off.
 */
export function channelKeyFor(rawName: string): string {
  return resolveChannelId(rawName) ?? customChannelId(rawName);
}

/**
 * Idempotent migration of any field identity to its canonical storage key.
 * Handles three inputs: an already-canonical id (kept), an already-migrated
 * `custom:` slug (kept), or a legacy display name (resolved). Use this for
 * persisted identities (stored graph-prefs, saved overlay sourceIds) so old data
 * keeps resolving without a destructive migration.
 */
export function toChannelKey(name: string): string {
  if (isKnownChannel(name) || name.startsWith("custom:")) return name;
  return channelKeyFor(name);
}

/**
 * Rewrite a freshly-parsed `ParsedData` so every channel identity is canonical:
 * `fieldMappings` get a stable `name` (id/slug) plus a display `label` and unit,
 * and every sample's `extraFields` keys are renamed to match. Run once per parse
 * (at the format router) so all parsers can keep emitting human display names
 * internally while the rest of the app sees uniform keys regardless of format.
 *
 * Mutates the passed samples' `extraFields` in place (they're owned by the
 * just-parsed result) and returns `data` with rebuilt `fieldMappings`.
 */
export function normalizeChannels(data: ParsedData): ParsedData {
  const rename = new Map<string, string>();
  const usedKeys = new Set<string>();

  const fieldMappings = data.fieldMappings.map((m) => {
    const known = resolveChannelId(m.name);
    let key = toChannelKey(m.name);
    // Two source columns must never collapse onto one channel id — that would
    // clobber a column's samples. Keep the later duplicate under a custom key.
    if (usedKeys.has(key)) key = customChannelId(m.name);
    usedKeys.add(key);
    rename.set(m.name, key);
    return {
      ...m,
      name: key,
      label: m.label ?? (known ? channelLabel(known) : m.name),
      unit: m.unit ?? (known ? channelUnit(known) : undefined),
    };
  });

  for (const s of data.samples) {
    const next: Record<string, number> = {};
    for (const k in s.extraFields) {
      const v = s.extraFields[k];
      if (v === undefined) continue;
      next[rename.get(k) ?? toChannelKey(k)] = v;
    }
    s.extraFields = next;
  }

  return { ...data, fieldMappings };
}
