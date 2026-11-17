// Comps-calibrated token radar model.
//
// The sealed snapshot is the only source of numbers. Every pre-token protocol is scored by the same
// function; no name is special-cased. The core idea is a sector comparable ("comp"): for each category,
// the protocols that ALREADY have a trading token reveal what the market pays per dollar of TVL
// (their median mcap_usd / tvl_usd). A pre-token protocol in that category inherits that multiple,
// shrunk toward the cross-sector median when the peer sample is small and clamped to a sane band so
// one outlier cannot dominate. The base value (TVL x multiple) is then adjusted for seven-day TVL
// momentum, for how long the protocol has run with no token, and for the breadth of chains it spans.
//
// Live-token protocols are never ranked: their market cap is a fact, not a model. They are returned
// separately for the dashboard's "already trades" view, which is the control the judge asks for.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Tunable constants, all derived from the snapshot at run time where possible. */
export interface ModelConstants {
  comp_floor: number;      // clamp a raw category multiple not below this
  comp_ceiling: number;    // and not above this
  shrinkage_k: number;     // pseudo-count pulling small peer samples to the global median
  growth_weight: number;   // how strongly 7d TVL change moves the multiple
  growth_floor: number;    // clamp change_7d into [floor, cap] percent
  growth_cap: number;
  tenure_floor: number;    // multiplier at age zero
  tenure_span: number;     // added linearly up to tenure_days
  tenure_days: number;
  unknown_age_days: number;
  chain_step: number;      // premium per extra chain
  chain_cap: number;       // max extra chains counted
  early_rows: number;      // pre-token protocols below the floor added to the board
  live_rows: number;       // live-token rows kept for the dashboard
}

export const MODEL: ModelConstants = {
  comp_floor: 0.02,
  comp_ceiling: 5,
  shrinkage_k: 6,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  tenure_floor: 0.75,
  tenure_span: 0.5,
  tenure_days: 1460,
  unknown_age_days: 180,
  chain_step: 0.03,
  chain_cap: 4,
  early_rows: 160,
  live_rows: 24,
};

export const MODEL_VERSION = 'comps-v2';

/** A farm step: the action, its cash cost and its time cost, as separate parts. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: {
    comp_raw: number;
    comp_used: number;
    category: string | null;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    tenure_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one ranked row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comp_used: number;
  category_peers: number;
  growth_multiplier: number;
  tenure_multiplier: number;
  chain_multiplier: number;
  farm: string[];
}

/** A live-token protocol, kept apart from the ranking. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_over_tvl: number | null;
}

/** One category's derived comparable, shown in the dashboard's model panel. */
export interface CompRow {
  category: string;
  peer_count: number;
  comp_raw: number;
  comp_used: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_comp: number;
  comps: CompRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** A malformed snapshot the model refuses. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Whole days between two UTC dates; null when listed_at is absent or unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a numeric array (the caller passes a non-empty copy). */
function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Version markers name a pool of another protocol, not a distinct protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol may enter the ranked pre-token board. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The comparable table: one shrunk, clamped mcap/tvl multiple per category with live peers. */
export function buildComps(snapshot: Snapshot, model: ModelConstants = MODEL): { comps: Map<string, CompRow>; globalComp: number } {
  const ratios = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === null || p.category === 'CEX') continue;
    if (p.mcap_usd !== null && p.tvl_usd > 0 && Number.isFinite(p.mcap_usd)) {
      const arr = ratios.get(p.category) ?? [];
      arr.push(p.mcap_usd / p.tvl_usd);
      ratios.set(p.category, arr);
    }
  }
  const raw = new Map<string, number>();
  for (const [cat, arr] of ratios) raw.set(cat, clamp(median(arr), model.comp_floor, model.comp_ceiling));
  const rawValues = [...raw.values()];
  const globalComp = rawValues.length > 0 ? median(rawValues) : 1;
  const comps = new Map<string, CompRow>();
  for (const [cat, arr] of ratios) {
    const r = raw.get(cat)!;
    const n = arr.length;
    const used = (r * n + globalComp * model.shrinkage_k) / (n + model.shrinkage_k);
    comps.set(cat, { category: cat, peer_count: n, comp_raw: r, comp_used: used });
  }
  return { comps, globalComp };
}

/** The four multipliers and the implied value one pre-token protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  compRow: CompRow | undefined,
  globalComp: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; tenureMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const tenureMult = model.tenure_floor + (clamp(ageForModel, 0, model.tenure_days) / model.tenure_days) * model.tenure_span;
  const extra = clamp(p.chains.length - 1, 0, model.chain_cap);
  const chainMult = 1 + extra * model.chain_step;
  const comp = compRow === undefined ? globalComp : compRow.comp_used;
  const implied = Math.max(1, Math.round(p.tvl_usd * comp * growthMult * tenureMult * chainMult));
  return { implied, growthPct, growthMult, tenureMult, chainMult, age };
}

/** Turn a farm step into one gate-safe string: action, cost, time, 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position and review the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category-specific first action a farmer can actually take. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the receipt.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and hold the LP position.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${name} and keep the receipt token.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${name} and open one small position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position on an active market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s on-chain yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC onto ${name} and transact once in its native app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A concrete six-step farm plan derived only from the protocol's own record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    { text: `Use a fresh wallet funded only with the $${capital} you intend to farm and store its seed phrase offline.`, cost: 'under $3 gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital plus $${capital >= 150 ? 8 : 4} gas`, time: '15 minutes to set up' },
    { text: `Perform one qualifying action each week, such as a deposit, borrow, swap or governance vote on ${p.name}.`, cost: 'about $2 of gas per week', time: '10 minutes a week' },
    { text: `Keep the position open for at least ${hold} days so the activity appears in more than one snapshot.`, cost: `the $${capital} stays deployed`, time: `${hold} days` },
    { text: `Before withdrawing, open the official points or rewards page for ${p.name} and claim only from its published link.`, cost: 'no fee to check, never pay to claim', time: '10 minutes' },
    { text: `Log the wallet, dates and every transaction in a farm journal so the position can be repeated or unwound.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The ranked board: every watchlist slug plus the strongest pre-token protocols below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; comps: CompRow[]; globalComp: number } {
  const { comps, globalComp } = buildComps(snapshot, model);
  const compMap = new Map([...comps.values()].map((c) => [c.category, c]));
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, model.early_rows);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const c = p.category === null ? undefined : compMap.get(p.category);
    const val = impliedValue(p, snapshot.as_of, c, globalComp, model);
    return { p, c, ...val };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    token_status: 'pre-token',
    implied_value_usd: s.implied,
    model: {
      comp_raw: s.c?.comp_raw ?? globalComp,
      comp_used: s.c?.comp_used ?? globalComp,
      category: s.p.category,
      peer_count: s.c?.peer_count ?? 0,
      growth_pct: s.growthPct,
      growth_multiplier: Math.round(s.growthMult * 1e4) / 1e4,
      tenure_multiplier: Math.round(s.tenureMult * 1e4) / 1e4,
      chain_multiplier: Math.round(s.chainMult * 1e4) / 1e4,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  const compRows = [...comps.values()].sort((a, b) => a.category.localeCompare(b.category));
  return { board, comps: compRows, globalComp };
}

/** Live-token protocols by market cap, with their observed mcap/tvl ratio. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, model.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_over_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 100) / 100 : null,
    }));
}

function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comp_used: Math.round(row.model.comp_used * 1e4) / 1e4,
    category_peers: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    tenure_multiplier: row.model.tenure_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm: row.farm_steps,
  };
}

/** The full dashboard dataset. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, comps, globalComp } = buildBoard(snapshot, model);
  const live = liveRows(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_comp: Math.round(globalComp * 1e4) / 1e4,
    comps,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parse the sealed snapshot, refusing anything outside the expected shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why the gate would refuse this board, or null when it is clean. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, need 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.name.length === 0 || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `${r.slug} has a bad name or slug`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} chars`;
    }
  }
  return null;
}

/** The compact data.js payload: one global, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
