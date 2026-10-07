# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, single-page marketing + booking site for **Gurudev Travels**, a one-car (Toyota Rumion)
cab service. No build step, no package manager, no tests, no framework — three files do everything:

- `index.html` — the entire page markup (nav, hero, about, fleet gallery, destinations, booking form, contact, footer, two modals)
- `assets/js/main.js` — all logic **and** all configuration
- `assets/css/styles.css` — hand-written component classes layered on top of Tailwind

Tailwind, Leaflet and Google Fonts come from CDNs in the `<head>`; Tailwind's theme
(`brand`/`jade` palettes, `Inter`/`Outfit` fonts, `darkMode: 'class'`) is configured inline in
`index.html`, not in a config file.

## Run it

```bash
python3 -m http.server 8000    # open http://localhost:8000
```

Serve over `localhost`, never `file://` — the Leaflet map, Nominatim `fetch` calls, and
`navigator.geolocation` all need an http origin. Deploy is a straight static upload (Netlify drop, etc.).

## Configuration lives at the top of assets/js/main.js

Everything a site owner would change is in the `CONFIG` block (lines ~11–31), not in HTML:

- `OWNER_WHATSAPP` — the number that receives every booking (digits + country code)
- `API_URL` — optional Google Apps Script web-app URL. `isConfigured()` treats a value still
  starting with `PASTE_` as "not set up", so the backend `fetch` is skipped silently.
- `DEFAULT_MAP_CENTER` / `DEFAULT_MAP_ZOOM` — where the picker opens (currently Tamil Nadu)
- `FLEET` — the car list. It now only drives the booking form's `<select>` (see below).

## How the pieces fit

**Booking flow (no server).** `initBookingForm` validates the form client-side, then builds two
WhatsApp deep links via `buildOwnerMessage`/`buildCustomerMessage` + `whatsappLink`. The owner's
link is opened with `window.open` **synchronously inside the submit handler** — moving that behind
an `await` or a `.then` will get it blocked as a popup. The customer's link is handed to a button
in the success modal, because a static page can't send on the customer's behalf. If `API_URL` is
configured, a fire-and-forget `fetch` POSTs `{action:"create", booking}` afterwards.

**Maps are key-less by default; Google is an optional upgrade.** Set `GOOGLE_MAPS_KEY` in `CONFIG` (value still starting `PASTE_` = off) and `geocodeSearch`/`reverseGeocode` use Google Places (New) + Geocoding, falling back to Nominatim on any failure; Google predictions get lat/lon lazily via `resolveCoords` on pick. Otherwise: Leaflet + OpenStreetMap tiles + the free Nominatim geocoder.
`geocodeSearch`/`reverseGeocode` are debounced 500 ms to stay within Nominatim's ~1 req/sec
etiquette — keep that debounce if you touch the search paths. The picker map is built lazily on
first open (`mapBuilt`) and needs `pmap.invalidateSize()` after the modal becomes visible.
The "View route" link is a plain Google Maps directions URL (`mapsRouteUrl`), also key-less.

**Fleet rendering is half-static.** `renderFleet()` only populates the `#car` dropdown; the visible
fleet section in `index.html` is hand-written markup plus a 4-slide gallery. `setSlide` is called
from inline `onclick` in the HTML and the auto-advance interval hardcodes `% 4` — adding or removing
a slide means editing both `index.html` and that modulus.

**Wiring convention.** Every feature is an `initX()` function called from one `DOMContentLoaded`
handler at the bottom of `main.js`; DOM access goes through the `$(id)` helper, so elements are
addressed by `id`. Renaming an `id` in `index.html` silently breaks the matching `init` — grep
`main.js` for the id first.

**Images degrade instead of breaking.** Every `<img>` carries an `onerror` that either hides itself
or swaps in a CSS placeholder (`.img-fallback` → 🚙 glyph, `.hero-grad` for the hero). `assets/img/`
is currently empty of photos — the site is *meant* to still render. Don't "fix" missing images by
removing the `onerror` handlers.

**Escaping.** Any user-supplied value injected as HTML (the success-modal summary, fleet options)
must go through `escapeHtml`.

## Notes on the README

`README.md` is partly aspirational and describes an older version: it mentions `backend/Code.gs`,
a `template-original/` folder, and a three-Innova fleet (`crysta.jpg`, `hycross.jpg`, `crysta8.jpg`)
— none of which exist here. Trust the code over the README; the WhatsApp Cloud API auto-send it
describes is not implemented in this repo.
