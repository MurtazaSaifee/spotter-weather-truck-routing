# Recorded provider responses

Each file is a real response, captured once from the live provider and checked in so the tests
run offline. Tests load them with the `load_fixture` fixture and answer the matching URL with
respx. An edge case is a hand-edited copy made inside the test, never a second file.

Scrub secrets before saving: replace the HERE key with `REDACTED` anywhere it could appear.

The two places rows below are historical recordings, made while place search was still limited to
North America. The app no longer sends the `in` or `bbox` parameter, so their request column is what
was recorded, not what the app sends today.

| File | Request | Recorded |
|---|---|---|
| `places/here_autosuggest_chicago.json` | `GET autosuggest.search.hereapi.com/v1/autosuggest?q=Chicago&in=countryCode:USA,CAN,MEX&at=39.5,-98.5&limit=8` | 2026-10-14 |
| `places/photon_chicago.json` | `GET photon.komoot.io/api/?q=Chicago&limit=8&bbox=-170,14,-50,72` (needs a `User-Agent` header) | 2026-10-14 |
| `routing/here_chicago_dallas_truck.json` | `GET router.hereapi.com/v8/routes?transportMode=truck&origin=41.88425,-87.63245&destination=32.77657,-96.79699&departureTime=2026-10-15T08:00:00-05:00&alternatives=6&return=polyline,summary&spans=dynamicSpeedInfo,length,duration&vehicle[grossWeight]=34927` (7 routes, 684 to 1,690 spans each; about 1.4 MB, minified) | 2026-10-14 |
| `routing/here_chicago_havana_truck.json` | Same request to Havana (`23.1136,-82.3666`): HTTP 200 with `routes: []` and a `noRouteFound` notice | 2026-10-14 |
| `routing/here_london_paris_truck_shuttle.json` | `GET router.hereapi.com/v8/routes?transportMode=truck&origin=51.50740,-0.12780&destination=48.85660,2.35220&departureTime=2026-10-15T07:00:00Z&alternatives=6&return=polyline,summary&spans=dynamicSpeedInfo,length,duration&vehicle[grossWeight]=24948` (5 routes, each of three sections: truck, then a car shuttle train or a ferry, then truck; about 440 KB, minified). Used by the multi-section routing tests in `tests/test_routing.py`. | 2026-10-15 |
| `routing/here_chicago_dallas_via_{left,right}_{10,20}.json` | Same request as the Chicago to Dallas truck route, with `alternatives=0` and `via=<lat>,<lng>!passThrough=true`, one per detour via-point (10% and 20% of the fastest route's 1,559 km, either side of its midpoint, at right angles to the heading; see `VIA_POINTS` in `tests/test_plan.py`). One route of one section each, 230 to 250 KB; `right_20` runs along the first Chicago to Dallas route | 2026-10-14 |
| `weather/open_meteo_three_points_8_days.json` | `POST api.open-meteo.com/v1/forecast`, form body `latitude=41.90,35.20,32.80&longitude=-87.65,-97.40,-96.80&hourly=wind_speed_10m,wind_gusts_10m,rain,showers,snowfall&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&forecast_days=8` (three locations, 192 hourly values each from 2026-10-14T00:00 GMT, no gaps; keyless, minified). One location alone comes back as a bare object rather than a one-item list. | 2026-10-14 |
