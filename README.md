# samsam-z/beacon-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/samsam-z/beacon-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/samsam-z/beacon-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Beacon** is a comps-calibrated radar for the token-launch bounty: it reads one sealed DefiLlama
snapshot, sets aside the protocols whose token already trades, and ranks the pre-token ones by an
implied value derived only from the snapshot. For each sector it learns the market's mcap/TVL
multiple from that sector's listed peers, shrinks it toward the cross-sector median, and applies
TVL, seven-day TVL momentum, time without a token and chain breadth. Every row carries a concrete,
costed farm plan. The dashboard is a dependency-free static page with a sortable, filterable board,
a per-protocol valuation breakdown and an "already trades" comparison view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

- `main.ts` — Node 22 entrypoint, standard library only
- `lib/model.ts` — the comps valuation model, board builder and gate checks
- `dashboard/` — the static, offline dashboard (`index.html`, `app.css`, `app.js`)
- `screenshots/` — board, detail and filtered views used by the judge dossier
- `vendor/makefun-board.ts` — the kit's dossier library
- `LICENSE` — MIT
- `.makefun/owner.json` — wallet claim

Implied values are a model's estimates, not predictions or investment advice.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
