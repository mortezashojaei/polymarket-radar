# polymarket-vibe-data

Curated subset from `data/radar.db` export for fast coding + decision workflows.

## Files

- `market_state_important.csv` — core per-market snapshot (probability, 24h volume, delta, flips, timestamps)
- `sent_messages_important.csv` — sent digest/alert history context
- `important_snapshot.json` — compact JSON for scripts/agents
- `summary.json` — precomputed stats + top markets

## Notes

- Only non-empty + decision-relevant tables were kept.
- Empty operational tables (`runs`, `seen_alerts`, `signal_state`, `pending_digest_signals`, `kv_state`) were omitted.
- Timestamps are Unix ms; CSV includes ISO UTC helpers.
