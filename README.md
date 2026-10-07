# 🚕 Gurudev Travels — Premium Innova Travel (single page)

A clean, mobile-friendly **single-page** website for an Innova cab service, built with
**HTML5, Tailwind CSS (CDN) and vanilla JavaScript** — premium travel-template look,
Google Maps location picker, and WhatsApp notifications to **both** the cab owner and
the customer. Bookings can optionally be saved to **Google Sheets** via **Apps Script**.

## 📂 Project structure

```
travelling/
├── index.html                  # the whole page (markup only)
├── assets/
│   ├── css/
│   │   └── styles.css          # custom styles + animations (on top of Tailwind)
│   ├── js/
│   │   └── main.js             # all logic + configuration (keys, fleet, numbers)
│   └── img/                    # ← put your photos here (see list below)
├── backend/
│   └── Code.gs                 # Google Apps Script (optional: Sheet + auto WhatsApp)
├── template-original/          # the downloaded reference template (unused — reference only)
└── README.md
```

## ✨ Features
- Full-screen **hero**, **About**, **fleet cards**, **destinations carousel**, **stats**,
  **booking**, **newsletter CTA**, **contact**, and a rich **footer** — one scrolling page
- Sticky navbar that turns solid on scroll + scroll-to-top button
- **Innova fleet** cards with replaceable photos, specs & per-km fares
- **Google Maps location picker** (tap / drag / search) — works for any village or address
- 🗺️ Live **"View route on Google Maps"** link
- On submit: opens WhatsApp to the **owner** + button to send the **customer** a confirmation
  (and fully automatic to both if you enable the Cloud API in `Code.gs`)
- Dark / light toggle, scroll-reveal & loading/success animations

---

## 🗺️ Maps — free & open-source, no API key

Location search and the map picker use **OpenStreetMap + Leaflet + Nominatim** — all free,
**no API key or billing**. Nothing to set up. They're loaded from a CDN in `index.html`.
The "View route" link opens Google Maps directions, which also needs no key.

> Nominatim (the free geocoder) asks for light usage (~1 request/sec). The code already
> debounces typing, which is fine for normal booking traffic. For very high volume, you'd
> self-host Nominatim or use a paid geocoder.

## 🔧 Configure — all at the top of `assets/js/main.js`

```js
const OWNER_WHATSAPP = "919876543210";                            // cab owner's number
const API_URL        = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"; // optional Sheet backend
const FLEET = [ ... ];                                            // your cars + images
```

Only `OWNER_WHATSAPP` and `FLEET` really matter — everything else is optional.

### 🖼️ Add your images → `assets/img/`
| File | Used for |
|------|----------|
| `hero.jpg` | full-screen hero background |
| `hero2.jpg` | small card on the hero (bottom-right) |
| `about1.jpg`, `about2.jpg` | About section (overlapping pair) |
| `exp1.jpg`, `exp2.jpg` | Stats section (overlapping pair) |
| `crysta.jpg`, `hycross.jpg`, `crysta8.jpg` | fleet cards (names set in `FLEET`) |
| `dest1.jpg` … `dest5.jpg` | destinations carousel |

> Any missing image automatically shows a gradient/🚙 placeholder — the page never looks broken.

---

## 📲 WhatsApp notifications (owner + customer)

A static site can't silently send WhatsApp — the browser opens WhatsApp with a ready
message a person taps **send** on. So:

- **No setup (default):** on submit, WhatsApp opens to the **owner** with the booking; the
  success popup has a button to send the **customer** their confirmation.
- **Fully automatic:** set up the **WhatsApp Cloud API** in `backend/Code.gs`
  (`WA_TOKEN`, `WA_PHONE_ID`) — the backend then messages **both** automatically after saving
  to the Sheet. (Messaging a customer outside the 24h window needs an approved template —
  see the notes in `Code.gs`.)

## 🗄️ Optional: save bookings to Google Sheets
1. New Google Sheet → **Extensions ▸ Apps Script** → paste `backend/Code.gs` → Save.
2. **Deploy ▸ New deployment ▸ Web app** · Execute as **Me** · Access **Anyone** → Deploy → authorise.
3. Copy the `/exec` URL into `API_URL` in `assets/js/main.js`.
> After editing `Code.gs`: **Manage deployments ▸ Edit ▸ New version ▸ Deploy** (URL stays the same).

---

## ▶️ Run it
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
Use `localhost` (not `file://`) so the map and geolocation work.

## 🚀 Deploy to Netlify
Drag the project folder onto <https://app.netlify.com/drop>, or connect the repo.
It's static — no build step needed.

---

Comfortable Innova travel, from any village. Safe travels! 🌍
