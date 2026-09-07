# Court IQ — Covenant

A volleyball lineup and sub planner built for The Covenant School's middle school team, with a Level dial so the same tool grows into high school. Built for an iPad on the bench: pick a system (4-2, Simple 6, or 5-1), pin your starters, and let it plan how every girl gets on the floor when the score allows.

**Live**: https://demerson-code.github.io/court-iq-covenant/

Forked from [Court IQ College](https://github.com/demerson-code/court-iq-college). One HTML file, one CSS file, one JS file — no build step, no dependencies, deploys from `main`.

Branded for The Covenant School: the seal, its navy and red, and Baskerville headings, matching [covenantschoolwv.org](https://covenantschoolwv.org). Coaches: Mackenzie Moir and Abbie Wayne.

## Local development

```sh
python -m http.server 3470
# open http://localhost:3470
```

```sh
npm test   # Playwright algorithm tests
```

## Sharing

The share link (🔗 in the top bar) carries the whole team — roster, ratings, settings, lineup, and the shelf of saved lineups. Whoever shares the latest link is the source of truth. Theme, tonight's scrimmage attendance, and in-match bench state stay on the device and never travel with the link.
