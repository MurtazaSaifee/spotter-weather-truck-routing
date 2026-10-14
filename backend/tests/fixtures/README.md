# Recorded provider responses

Each file is a real response, captured once from the live provider and checked in so the tests
run offline. Tests load them with the `load_fixture` fixture and answer the matching URL with
respx. An edge case is a hand-edited copy made inside the test, never a second file.

Scrub secrets before saving: replace the HERE key with `REDACTED` anywhere it could appear.

| File | Request | Recorded |
|---|---|---|
| `places/here_autosuggest_chicago.json` | `GET autosuggest.search.hereapi.com/v1/autosuggest?q=Chicago&in=countryCode:USA,CAN,MEX&at=39.5,-98.5&limit=8` | 2026-10-14 |
| `places/photon_chicago.json` | `GET photon.komoot.io/api/?q=Chicago&limit=8&bbox=-170,14,-50,72` (needs a `User-Agent` header) | 2026-10-14 |
