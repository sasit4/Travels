/* ============================================================
   Gurudev Travels — front-end logic
   - Innova fleet (replaceable images)
   - Pick pickup/drop on an interactive OpenStreetMap (Leaflet) — no API key (tap / drag / search)
   - Submit -> opens WhatsApp with the full booking (sent to your number)
   - Live "View route on Google Maps" link
   - Optional Google Apps Script / Google Sheet save (background)
   - Dark/Light toggle, scroll reveal, success modal
   ============================================================ */

/* ===================== CONFIG ===================== */

// 🔧 1) The CAB OWNER's WhatsApp number — receives every new booking (digits only, with country code).
const OWNER_WHATSAPP = "919688211890"; // +91 96882 11890
//        (the CUSTOMER's number is taken from the booking form's phone field)

// 🔧 2) Location search. Works with NO key (OpenStreetMap + Nominatim). For Google-quality
//        suggestions (best coverage of Indian villages/landmarks) paste a Google Maps Platform key
//        with "Places API (New)" + "Geocoding API" enabled and restricted to your site's domain.
//        Leave PASTE_ to keep using the free OpenStreetMap search.
const GOOGLE_MAPS_KEY = "PASTE_YOUR_GOOGLE_MAPS_API_KEY_HERE";

// 🔧 3) Optional Apps Script URL to also save bookings to a Google Sheet (leave PASTE_ to skip).
const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

// 🔧 4) Where the map opens by default before a location is chosen (lat,lng + zoom).
const DEFAULT_MAP_CENTER = { lat: 11.1271, lng: 78.6569 }; // Tamil Nadu, India
const DEFAULT_MAP_ZOOM = 7;

// 🔧 5) Your fleet.
const FLEET = [
  {
    id: "rumion", img: "assets/img/rumion.png", name: "Toyota Rumion", seats: 7, bags: 4, fare: "Contact for pricing", tag: "White · Premium", badge: "jade",
    desc: "Comfortable 7-seater white Toyota Rumion. Perfect for family trips and long journeys with premium comfort."
  },
];

/* ===================== HELPERS ===================== */

const $ = (id) => document.getElementById(id);
const todayStr = () => new Date().toISOString().split("T")[0];
const isConfigured = () => API_URL && !API_URL.startsWith("PASTE_");
const show = (id) => $(id)?.classList.remove("hidden");
const hide = (id) => $(id)?.classList.add("hidden");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function mapsRouteUrl(from, to) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`;
}

// Route link on its own line, with a blank line above it, closing both WhatsApp messages.
function mapLinkLines(b) {
  if (!b.pickup || !b.drop) return [];
  return ["", `Route map: ${mapsRouteUrl(b.routeFrom || b.pickup, b.routeTo || b.drop)}`];
}

const RULE = "----------------------------";

// Message the CAB OWNER receives (a new booking has come in).
function buildOwnerMessage(b) {
  const lines = [
    "*GURUDEV TRAVELS*",
    "New Booking Request",
    RULE,
    `Name        : ${b.name}`,
    `Phone       : ${b.phone}`,
    `Car         : ${b.car}`,
    `Pickup      : ${b.pickup}`,
    `Drop        : ${b.drop}`,
    `From        : ${b.dateFrom}`,
    `To          : ${b.dateTo}`,
    `Passengers  : ${b.passengers}`,
    RULE,
  ];
  lines.push(...mapLinkLines(b));
  return lines.join("\n");
}

// Message the CUSTOMER receives (their booking is confirmed).
function buildCustomerMessage(b) {
  const lines = [
    "*GURUDEV TRAVELS*",
    "Booking Confirmed",
    RULE,
    `Hi ${b.name}, thank you for booking with us.`,
    "",
    `Car         : ${b.car}`,
    `Pickup      : ${b.pickup}`,
    `Drop        : ${b.drop}`,
    `From        : ${b.dateFrom}`,
    `To          : ${b.dateTo}`,
    `Passengers  : ${b.passengers}`,
    RULE,
  ];
  // Same route link the owner gets, so both sides open the identical directions.
  lines.push(...mapLinkLines(b), "");
  lines.push(
    "Your driver's details will be shared before pickup.",
    "For any help, just reply to this message.",
    "",
    "Gurudev Travels - Safe & comfortable journeys",
  );
  return lines.join("\n");
}

function whatsappLink(message, to) {
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/* ===================== THEME ===================== */
(function initTheme() {
  const saved = localStorage.getItem("wander-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) document.documentElement.classList.add("dark");
})();

/* ===================== FLEET ===================== */
function renderFleet() {
  // The fleet grid is replaced by a static feature section in index.html.
  // We only need to update the car selection dropdown.
  $("car").innerHTML = FLEET.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} · ${c.seats} seats</option>`).join("");
}

/* ===================== OPEN-SOURCE MAPS (Leaflet + OpenStreetMap + Nominatim) ===================== */
// No API key needed. Geocoding/search via the free Nominatim service.
const NOMINATIM = "https://nominatim.openstreetmap.org";

/* ----- Optional Google Places (New) — used only when GOOGLE_MAPS_KEY is set and working ----- */
let googleFailed = false, googleLib = null, placesToken = null;
window.gm_authFailure = () => { googleFailed = true; console.warn("Google Maps key rejected — using OpenStreetMap search."); };

function loadGooglePlaces() {
  if (!GOOGLE_MAPS_KEY || GOOGLE_MAPS_KEY.startsWith("PASTE_") || googleFailed) return Promise.resolve(null);
  if (!googleLib) googleLib = new Promise((resolve) => {
    window.__gmReady = async () => {
      try { resolve(await google.maps.importLibrary("places")); }
      catch (e) { console.warn("Google Places failed to load:", e); resolve(null); }
    };
    const el = document.createElement("script");
    el.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&loading=async&callback=__gmReady`;
    el.async = true;
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return googleLib;
}

async function googleSearch(query) {
  const places = await loadGooglePlaces();
  if (!places || googleFailed) return null; // null = fall back to Nominatim
  try {
    placesToken = placesToken || new places.AutocompleteSessionToken(); // one billing session per pick
    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query, sessionToken: placesToken, includedRegionCodes: ["in"],
    });
    return suggestions.filter(x => x.placePrediction)
      .map(x => ({ display_name: x.placePrediction.text.toString(), _pred: x.placePrediction }));
  } catch (e) { console.warn("Google search failed:", e); return null; }
}

// Google predictions carry no coordinates until one is chosen; fetch them (closes the billing session).
async function resolveCoords(r) {
  if (r.lat != null || !r._pred) return r;
  const place = r._pred.toPlace();
  await place.fetchFields({ fields: ["location", "formattedAddress"] });
  r.lat = place.location.lat(); r.lon = place.location.lng();
  r.display_name = place.formattedAddress || r.display_name;
  placesToken = null;
  return r;
}

// Free-form place search -> array of results [{display_name, lat, lon}] (Google ones resolve lat/lon on pick)
async function geocodeSearch(query) {
  if (!query || query.trim().length < 3) return [];
  const g = await googleSearch(query.trim());
  if (g) return g;
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&limit=6&addressdetails=0&countrycodes=in&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    return await res.json();
  } catch (e) { console.warn("Search failed:", e); return []; }
}

// Coordinates -> human address
async function reverseGeocode(lat, lon) {
  if (await loadGooglePlaces()) {
    try {
      const { Geocoder } = await google.maps.importLibrary("geocoding");
      const res = await new Geocoder().geocode({ location: { lat, lng: lon } });
      if (res.results && res.results[0]) return res.results[0].formatted_address;
    } catch (e) { console.warn("Google reverse geocode failed:", e); }
  }
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const d = await res.json();
    return d && d.display_name ? d.display_name : null;
  } catch (e) { console.warn("Reverse geocode failed:", e); return null; }
}

// Simple debounce so we respect Nominatim's ~1 request/second policy.
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ----- Typing suggestions on the pickup/drop fields (free, via Nominatim) ----- */
// Confirmed lat/lng for each field — only set once a suggestion (or the map picker) is picked,
// so the route link/WhatsApp message can use the exact point instead of guessing from free text.
const pickedCoords = { pickup: null, drop: null };

function renderSuggestions(listEl, results, inputEl, fieldKey) {
  if (!results.length) { listEl.classList.add("hidden"); listEl.innerHTML = ""; return; }
  listEl.innerHTML = results.map((r, i) => {
    const [main, ...rest] = r.display_name.split(", ");
    return `<li data-i="${i}">📍 <strong>${escapeHtml(main)}</strong><span class="suggest-sub">${rest.length ? ", " + escapeHtml(rest.join(", ")) : ""}</span></li>`;
  }).join("");
  listEl.classList.remove("hidden");
  listEl.querySelectorAll("li").forEach((li) => li.addEventListener("click", async () => {
    const r = await resolveCoords(results[li.dataset.i]);
    inputEl.value = r.display_name;
    pickedCoords[fieldKey] = { lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
    listEl.classList.add("hidden");
    updateMapLink();
  }));
}

function initOsmAutocomplete() {
  [["pickup", "pickupSuggest", "pickup"], ["drop", "dropSuggest", "drop"]].forEach(([inputId, listId, fieldKey]) => {
    const input = $(inputId), list = $(listId);
    const run = debounce(async () => {
      const results = await geocodeSearch(input.value);
      renderSuggestions(list, results, input, fieldKey);
    }, 500);
    input.addEventListener("input", () => {
      pickedCoords[fieldKey] = null; // typed freely again — no longer an exact confirmed point
      updateMapLink();
      run();
    });
    input.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 150));
    document.addEventListener("click", (e) => {
      if (e.target !== input && !list.contains(e.target)) list.classList.add("hidden");
    });
  });
}

/* ----- Map picker modal (Leaflet) ----- */
const LEAFLET_ICON = (typeof L !== "undefined") ? L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
}) : null;

let pmap, pmarker, mapBuilt = false, mapTargetField = null, pickedAddress = "", pickedLatLng = null;

function buildPickerMap() {
  pmap = L.map("mapCanvas").setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors",
  }).addTo(pmap);
  pmarker = L.marker([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], { draggable: true, icon: LEAFLET_ICON }).addTo(pmap);

  pmap.on("click", (e) => setPicked(e.latlng.lat, e.latlng.lng));
  pmarker.on("dragend", () => { const ll = pmarker.getLatLng(); setPicked(ll.lat, ll.lng); });

  // Search box inside the modal -> results list
  const results = $("mapResults");
  const run = debounce(async () => {
    const list = await geocodeSearch($("mapSearch").value);
    if (!list.length) { results.classList.add("hidden"); results.innerHTML = ""; return; }
    results.innerHTML = list.map((r, i) =>
      `<li data-i="${i}">${escapeHtml(r.display_name)}</li>`).join("");
    results.classList.remove("hidden");
    results.querySelectorAll("li").forEach(li => li.addEventListener("click", async () => {
      const r = await resolveCoords(list[li.dataset.i]);
      const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      pmap.setView([lat, lon], 15);
      setPicked(lat, lon, r.display_name);
      results.classList.add("hidden");
      $("mapSearch").value = r.display_name;
    }));
  }, 500);
  $("mapSearch").addEventListener("input", run);

  mapBuilt = true;
}

async function setPicked(lat, lon, knownAddr) {
  pmarker.setLatLng([lat, lon]);
  pickedLatLng = { lat, lon };
  $("mapConfirm").disabled = false;
  if (knownAddr) { pickedAddress = knownAddr; $("mapPickedAddr").textContent = knownAddr; return; }
  $("mapPickedAddr").textContent = "Locating…";
  pickedAddress = await reverseGeocode(lat, lon) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $("mapPickedAddr").textContent = pickedAddress;
}

function openMapPicker(field) {
  if (typeof L === "undefined") {
    alert("Map library is still loading — please try again in a moment, or type the location.");
    $(field).focus();
    return;
  }
  mapTargetField = field;
  pickedAddress = "";
  $("mapModalTitle").textContent = field === "pickup" ? "📍 Select pickup location" : "🏁 Select drop location";
  $("mapSearch").value = "";
  $("mapResults").classList.add("hidden");
  $("mapPickedAddr").textContent = "—";
  $("mapConfirm").disabled = true;
  show("mapModal");

  if (!mapBuilt) buildPickerMap();

  // Leaflet needs a size refresh once the modal is visible.
  setTimeout(async () => {
    pmap.invalidateSize();
    const existing = $(field).value.trim();
    if (existing) {
      const first = (await geocodeSearch(existing))[0];
      const r = first && await resolveCoords(first);
      if (r) { const lat = parseFloat(r.lat), lon = parseFloat(r.lon); pmap.setView([lat, lon], 14); setPicked(lat, lon, r.display_name); }
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { const { latitude: lat, longitude: lon } = pos.coords; pmap.setView([lat, lon], 14); setPicked(lat, lon); },
        () => { pmap.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM); }
      );
    }
  }, 250);
}

function initMapPicker() {
  document.querySelectorAll(".map-pick-btn").forEach(btn =>
    btn.addEventListener("click", () => openMapPicker(btn.dataset.target)));
  $("mapClose").addEventListener("click", () => hide("mapModal"));
  $("mapModal").addEventListener("click", (e) => { if (e.target.id === "mapModal") hide("mapModal"); });
  $("mapConfirm").addEventListener("click", () => {
    if (mapTargetField && pickedAddress) {
      $(mapTargetField).value = pickedAddress;
      pickedCoords[mapTargetField] = pickedLatLng;
      updateMapLink();
    }
    hide("mapModal");
  });
  $("mapUseLocation")?.addEventListener("click", () => {
    if (!navigator.geolocation) { alert("Your browser doesn't support location access — please pick on the map or type the address."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const { latitude: lat, longitude: lon } = pos.coords; pmap.setView([lat, lon], 15); setPicked(lat, lon); },
      () => alert("Couldn't get your location. Please allow location access, or pick the spot on the map.")
    );
  });
}

// Coordinates (when a suggestion or the map was used) beat loose typed text for the actual route.
function updateMapLink() {
  const pickupText = $("pickup").value.trim(), dropText = $("drop").value.trim();
  const from = pickedCoords.pickup ? `${pickedCoords.pickup.lat},${pickedCoords.pickup.lon}` : pickupText;
  const to = pickedCoords.drop ? `${pickedCoords.drop.lat},${pickedCoords.drop.lon}` : dropText;
  const link = $("mapLink");
  if (pickupText && dropText) { link.href = mapsRouteUrl(from, to); link.classList.remove("hidden"); link.classList.add("flex"); }
  else { link.classList.add("hidden"); link.classList.remove("flex"); }
}

/* ===================== BOOKING FORM ===================== */
function initBookingForm() {
  const from = $("dateFrom"), to = $("dateTo");
  from.min = todayStr(); to.min = todayStr();
  from.addEventListener("change", () => {
    to.min = from.value || todayStr();
    if (to.value && to.value < from.value) to.value = from.value;
  });

  $("pickup").addEventListener("input", updateMapLink);
  $("drop").addEventListener("input", updateMapLink);

  $("bookingForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const err = $("formError"); err.classList.add("hidden");
    const b = {
      name: $("name").value.trim(), car: $("car").value,
      pickup: $("pickup").value.trim(), drop: $("drop").value.trim(),
      // Exact coordinates when a suggestion/map pin was picked, else the typed text (Google will geocode it).
      routeFrom: pickedCoords.pickup ? `${pickedCoords.pickup.lat},${pickedCoords.pickup.lon}` : $("pickup").value.trim(),
      routeTo: pickedCoords.drop ? `${pickedCoords.drop.lat},${pickedCoords.drop.lon}` : $("drop").value.trim(),
      dateFrom: $("dateFrom").value, dateTo: $("dateTo").value,
      passengers: $("passengers").value, phone: $("phone").value.trim(),
    };

    if (!b.name || !b.pickup || !b.drop || !b.dateFrom || !b.dateTo || !b.phone)
      return showError(err, "Please fill in all fields.");
    if (b.pickup.toLowerCase() === b.drop.toLowerCase())
      return showError(err, "Pickup and drop points can't be the same.");
    if (b.dateTo < b.dateFrom)
      return showError(err, "The 'To' date must be after the 'From' date.");
    if (!/^[0-9]{10,15}$/.test(b.phone))
      return showError(err, "Enter a valid WhatsApp number (digits only, with country code).");

    // Build both notifications.
    const ownerUrl = whatsappLink(buildOwnerMessage(b), OWNER_WHATSAPP);
    const customerUrl = whatsappLink(buildCustomerMessage(b), b.phone);

    // Open the OWNER's WhatsApp immediately (synchronous = no popup block) so they're notified.
    window.open(ownerUrl, "_blank");

    showSuccess(b, ownerUrl, customerUrl);
    resetForm(e.target);

    // ---- Backend: save to Sheet + (if Cloud API configured) auto-send BOTH WhatsApp messages ----
    if (isConfigured()) {
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "create", booking: b }),
      }).catch((ex) => console.warn("Backend call failed:", ex));
    }
  });

  $("closeModal").addEventListener("click", () => hide("successModal"));
  $("successModal").addEventListener("click", (e) => { if (e.target.id === "successModal") hide("successModal"); });
}

function resetForm(form) { form.reset(); $("passengers").value = 2; pickedCoords.pickup = null; pickedCoords.drop = null; updateMapLink(); }
function showError(el, msg) { el.textContent = msg; el.classList.remove("hidden"); }
function showSuccess(b, ownerUrl, customerUrl) {
  $("modalSummary").innerHTML = `
    <div class="flex justify-between gap-4"><span class="text-slate-400">Car</span><span class="font-semibold text-right">${escapeHtml(b.car)}</span></div>
    <div class="flex justify-between gap-4"><span class="text-slate-400">Route</span><span class="font-semibold text-right">${escapeHtml(b.pickup)} → ${escapeHtml(b.drop)}</span></div>
    <div class="flex justify-between gap-4"><span class="text-slate-400">Dates</span><span class="font-semibold text-right">${b.dateFrom} → ${b.dateTo}</span></div>
    <div class="flex justify-between gap-4"><span class="text-slate-400">Passengers</span><span class="font-semibold">${escapeHtml(b.passengers)}</span></div>
    <div class="flex justify-between gap-4"><span class="text-slate-400">Name</span><span class="font-semibold text-right">${escapeHtml(b.name)}</span></div>
    <a href="${mapsRouteUrl(b.routeFrom || b.pickup, b.routeTo || b.drop)}" target="_blank" rel="noopener" class="block pt-1 text-brand-600 dark:text-brand-300 font-semibold hover:underline">🗺️ View route on Google Maps</a>`;
  $("waOwnerBtn").href = ownerUrl;
  $("waCustomerBtn").href = customerUrl;
  show("successModal");
}

/* ===================== CONTACT ===================== */
function initContact() {
  $("phoneLink").href = whatsappLink("Hi Gurudev Travels! 👋", OWNER_WHATSAPP);
  $("contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = `Hi Gurudev Travels! 👋\n\nName: ${$("cName").value.trim()}\nMessage: ${$("cMsg").value.trim()}`;
    window.open(whatsappLink(text, OWNER_WHATSAPP), "_blank");
  });
}

/* ===================== SCROLL REVEAL ===================== */
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));
}

/* ===================== NAVBAR + SCROLL-UP ===================== */
function initScrollUi() {
  const nav = $("navbar");
  const up = document.querySelector(".scrollup");
  const onScroll = () => {
    const y = window.scrollY;
    nav?.classList.toggle("nav-scrolled", y > 60);
    up?.classList.toggle("show", y > 400);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ===================== SUBSCRIBE (optional) ===================== */
function initSubscribe() {
  const f = document.getElementById("subscribeForm");
  if (!f) return;
  f.addEventListener("submit", (e) => { e.preventDefault(); f.reset(); alert("Thanks for subscribing! 🎉 We'll send offers your way."); });
}

/* ===================== BOOT ===================== */
function initCarousel() {
  const el = $("destCarousel");
  if (!el) return;
  const step = () => {
    const card = el.querySelector(".dest-card");
    return card ? card.getBoundingClientRect().width + 20 : 260;
  };
  const atEnd = () => el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
  const next = () => atEnd() ? el.scrollTo({ left: 0, behavior: "smooth" }) : el.scrollBy({ left: step(), behavior: "smooth" });
  const prev = () => el.scrollLeft <= 4 ? el.scrollTo({ left: el.scrollWidth, behavior: "smooth" }) : el.scrollBy({ left: -step(), behavior: "smooth" });
  $("destNext")?.addEventListener("click", next);
  $("destPrev")?.addEventListener("click", prev);

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let timer = null;
  const start = () => { if (!timer) timer = setInterval(next, 2500); };
  const stop = () => { clearInterval(timer); timer = null; };
  ["mouseenter", "touchstart", "focusin"].forEach(ev => el.addEventListener(ev, stop, { passive: true }));
  ["mouseleave", "touchend", "focusout"].forEach(ev => el.addEventListener(ev, start, { passive: true }));
  start();
}

document.addEventListener("DOMContentLoaded", () => {
  $("year").textContent = new Date().getFullYear();
  // Mobile menu toggle
  const mobileMenu = $("mobileMenu");
  const mobileMenuBtn = $("mobileMenuBtn");
  if (mobileMenu && mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("hidden");
    });
    // Close menu when a link is clicked
    mobileMenu.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => mobileMenu.classList.add("hidden"));
    });
  }

  // Theme toggles
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("wander-theme", isDark ? "dark" : "light");
  };
  $("themeToggle")?.addEventListener("click", toggleTheme);
  $("themeToggleMobile")?.addEventListener("click", toggleTheme);

  renderFleet();
  initBookingForm();
  initMapPicker();
  initOsmAutocomplete();
  initContact();
  initReveal();
  initScrollUi();
  initSubscribe();
  initCarousel();
});











































        /* =========================================================
           DESTINATION CAROUSEL DATA
           ========================================================= */

        const destinationImages = [

            {
                image:
                    "https://www.clubmahindra.com/blog/media/section_images/ultimate-o-8ac88a2da056a3d.jpg",

                name: "Ooty",

                description:
                    "Escape into misty hills, peaceful lakes and beautiful tea gardens surrounded by nature."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Boating_in_Kodaikanal_Lake_with_Mist.jpg?width=1000",

                name: "Kodaikanal",

                description:
                    "Discover cool mountain views, peaceful lakes and charming places surrounded by greenery."
            },


            {
                image:
                    "https://www.tamilnadutemples.in/img/madurai-meenakshi/madurai-meenakshi-4.jpg",

                name: "Madurai",

                description:
                    "Experience ancient temples, rich culture and the vibrant traditional beauty of Tamil Nadu."
            },


            {
                image:
                    "https://www.daiwikhotels.com/wp-content/uploads/2024/07/Rectangle-18262-3-2048x1262.jpg",

                name: "Rameshwaram",

                description:
                    "Explore sacred temples, beautiful coastal views and one of Tamil Nadu's iconic destinations."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Vivekananda_Rock_Memorial%2C_Kanyakumari.jpg?width=1000",

                name: "Kanyakumari",

                description:
                    "Enjoy stunning ocean views, beautiful sunsets and the unique meeting point of three seas."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Yercaud_lake.jpg?width=1000",

                name: "Yercaud",

                description:
                    "Relax among green hills, peaceful lakes and scenic viewpoints in this beautiful hill station."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Brihadisvara_Temple_during_Maha_Shivaratri-WUS03611_%28edit%29.jpg?width=1000",

                name: "Thanjavur",

                description:
                    "Discover magnificent temples, traditional art and the rich cultural heritage of Tamil Nadu."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Adiyogi_Shiva_steel_burst_2018.jpg?width=1000",

                name: "Coimbatore",

                description:
                    "Explore waterfalls, temples, greenery and the beautiful natural surroundings of Coimbatore."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Rock_Fortress_-_Tiruchirappalli_-_India.JPG?width=1000",

                name: "Trichy",

                description:
                    "Visit historic temples, magnificent rock formations and fascinating cultural landmarks."
            },


            {
                image:
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Velankanni_Church_2026.jpg?width=1000",

                name: "Velankanni",

                description:
                    "Experience a peaceful coastal destination known for its famous church and spiritual atmosphere."
            }

        ];


        /* =========================================================
           CURRENT DESTINATION
           ========================================================= */

        let currentDestination = 2;


        /* =========================================================
           MAIN CARDS
           ========================================================= */

        const destinationCards =
            document.querySelectorAll(".dest-main-card");


        /* =========================================================
           THUMBNAILS
           ========================================================= */

        const destinationThumbs =
            document.querySelectorAll(".dest-thumb");


        /* =========================================================
           CENTER CONTENT
           ========================================================= */

        const destinationPlaceName =
            document.querySelector(".dest-place-name");


        const destinationDescription =
            document.querySelector(".dest-description");


        const destinationDetailsBtn =
            document.getElementById("destinationDetailsBtn");


        /* =========================================================
           UPDATE CAROUSEL
           ========================================================= */

        function updateDestinationCarousel(direction = "") {


            /* ==========================================
               UPDATE MAIN 5 CARDS
               ========================================== */


            destinationCards.forEach(card => {

                card.classList.remove(
                    "moving-next",
                    "moving-prev"
                );

                void card.offsetWidth;

                if (direction === "next") {
                    card.classList.add("moving-next");
                }

                if (direction === "prev") {
                    card.classList.add("moving-prev");
                }

            });



            destinationCards.forEach(
                (card, positionIndex) => {

                    const relativePosition =
                        positionIndex - 2;


                    const imageIndex =
                        (
                            currentDestination +
                            relativePosition +
                            destinationImages.length
                        ) %
                        destinationImages.length;


                    const image =
                        card.querySelector("img");


                    /* UPDATE IMAGE */

                    image.src =
                        destinationImages[imageIndex].image;


                    /* UPDATE ALT */

                    image.alt =
                        destinationImages[imageIndex].name;


                    /* UPDATE POSITION */

                    card.setAttribute(
                        "data-position",
                        relativePosition
                    );

                }
            );


            /* ==========================================
               UPDATE CENTER NAME
               ========================================== */

            destinationPlaceName.textContent =
                destinationImages[currentDestination].name;


            /* ==========================================
               UPDATE CENTER DESCRIPTION
               ========================================== */

            destinationDescription.textContent =
                destinationImages[currentDestination].description;




            destinationDetailsBtn.href =
                "destination-details.html?place=" +
                encodeURIComponent(
                    destinationImages[currentDestination].name
                );

            /* ==========================================
               UPDATE BOTTOM THUMBNAILS
               ========================================== */

            destinationThumbs.forEach(
                (thumb, index) => {

                    const thumbIndex =
                        (
                            currentDestination -
                            2 +
                            index +
                            destinationImages.length
                        ) %
                        destinationImages.length;


                    const image =
                        thumb.querySelector("img");


                    const name =
                        thumb.querySelector("span");


                    /* UPDATE THUMBNAIL IMAGE */

                    image.src =
                        destinationImages[thumbIndex].image;


                    /* UPDATE ALT */

                    image.alt =
                        destinationImages[thumbIndex].name;


                    /* UPDATE NAME */

                    name.textContent =
                        destinationImages[thumbIndex].name;


                    /* UPDATE DATA INDEX */

                    thumb.setAttribute(
                        "data-index",
                        thumbIndex
                    );


                    /* ACTIVE THUMBNAIL */

                    if (
                        thumbIndex ===
                        currentDestination
                    ) {

                        thumb.classList.add("active");

                    } else {

                        thumb.classList.remove("active");

                    }

                }
            );

        }


        /* =========================================================
           NEXT BUTTON
           ========================================================= */

        document
            .getElementById("destNext")
            .addEventListener(
                "click",
                function () {

                    currentDestination =
                        (
                            currentDestination + 1
                        ) %
                        destinationImages.length;


                    updateDestinationCarousel("next");

                }
            );


        /* =========================================================
           PREVIOUS BUTTON
           ========================================================= */

        document
            .getElementById("destPrev")
            .addEventListener(
                "click",
                function () {

                    currentDestination =
                        (
                            currentDestination -
                            1 +
                            destinationImages.length
                        ) %
                        destinationImages.length;


                    updateDestinationCarousel("prev");

                }
            );


        /* =========================================================
           THUMBNAIL CLICK
           ========================================================= */

        destinationThumbs.forEach(
            function (thumb) {

                thumb.addEventListener(
                    "click",
                    function () {

                        currentDestination =
                            Number(
                                this.getAttribute(
                                    "data-index"
                                )
                            );


                        updateDestinationCarousel();

                    }
                );

            }
        );


        /* =========================================================
           INITIAL LOAD
           ========================================================= */

        updateDestinationCarousel();



































// offer and update section


/* =========================================================
   GURUDEV TRAVELS
   TRAVEL UPDATES SUBSCRIBE
   ========================================================= */

const subscribeForm =
    document.getElementById("subscribeForm");

const subscribeEmail =
    document.getElementById("subscribeEmail");

const subscribeMessage =
    document.getElementById("subscribeMessage");

const subscribeBtnText =
    document.getElementById("subscribeBtnText");


if (subscribeForm) {

    subscribeForm.addEventListener("submit", function (e) {

        e.preventDefault();

        const email =
            subscribeEmail.value.trim();


        /* Empty email */

        if (!email) {

            subscribeMessage.textContent =
                "Please enter your email address.";

            subscribeMessage.style.color =
                "#fb7185";

            return;
        }


        /* Email validation */

        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (!emailPattern.test(email)) {

            subscribeMessage.textContent =
                "Please enter a valid email address.";

            subscribeMessage.style.color =
                "#fb7185";

            return;
        }


        /* Loading */

        subscribeBtnText.textContent =
            "Joining...";


        subscribeMessage.textContent =
            "Connecting you with Gurudev Travels...";

        subscribeMessage.style.color =
            "#38bdf8";


        setTimeout(function () {

            subscribeBtnText.textContent =
                "You're In ✓";


            subscribeMessage.textContent =
                "Welcome to Gurudev Travels! Your latest travel offers are on the way.";

            subscribeMessage.style.color =
                "#22d3ee";


            subscribeEmail.value = "";


            /* Reset button text */

            setTimeout(function () {

                subscribeBtnText.textContent =
                    "Get Updates";

            }, 2500);


        }, 1000);

    });


}


















































// contact section










/* =========================================================
   GURUDEV TRAVELS
   PREMIUM CONTACT + WHATSAPP
   ========================================================= */


/* =========================================================
   ORIGINAL PHONE NUMBER
   ========================================================= */

const gurudevPhone =
    "919688211890";


/* =========================================================
   PHONE LINK
   ========================================================= */

const phoneLink =
    document.getElementById("phoneLink");

if (phoneLink) {

    phoneLink.href =
        "tel:+919688211890";

}


/* =========================================================
   CONTACT FORM
   ========================================================= */

const contactForm =
    document.getElementById("contactForm");

const cName =
    document.getElementById("cName");

const cMsg =
    document.getElementById("cMsg");


if (contactForm) {

    contactForm.addEventListener(
        "submit",
        function (event) {

            event.preventDefault();


            const name =
                cName.value.trim();

            const message =
                cMsg.value.trim();


            /* =========================
               VALIDATION
               ========================= */

            if (!name) {

                cName.focus();

                return;
            }


            if (!message) {

                cMsg.focus();

                return;
            }


            /* =========================
               WHATSAPP MESSAGE
               ========================= */

            const whatsappMessage =
                `Hello Gurudev Travels,

My name is ${name}.

${message}

I would like to know more about your travel services.`;


            const whatsappURL =
                "https://wa.me/" +
                gurudevPhone +
                "?text=" +
                encodeURIComponent(
                    whatsappMessage
                );


            /* =========================
               OPEN WHATSAPP
               ========================= */

            window.open(
                whatsappURL,
                "_blank"
            );

        }
    );

}


/* =========================================================
   QUICK ENQUIRY CHIPS
   ========================================================= */

const quickTopics =
    document.querySelectorAll(
        ".quick-topic"
    );


quickTopics.forEach(function (button) {

    button.addEventListener(
        "click",
        function () {

            const message =
                button.dataset.message;


            /* Fill message */

            if (cMsg) {

                cMsg.value =
                    message;

                cMsg.focus();

            }


            /* Active state */

            quickTopics.forEach(
                function (item) {

                    item.classList.remove(
                        "active"
                    );

                }
            );


            button.classList.add(
                "active"
            );

        }
    );

});






































































// footer section


/* =========================================================
   GURUDEV TRAVELS
   PREMIUM FOOTER JAVASCRIPT
   ========================================================= */


/* =========================================================
   DYNAMIC COPYRIGHT YEAR
   ========================================================= */

const yearElement =
    document.getElementById("year");

if (yearElement) {

    yearElement.textContent =
        new Date().getFullYear();

}


/* =========================================================
   LUXURY SCROLL UP BUTTON
   ========================================================= */

const luxuryScrollup =
    document.getElementById("luxuryScrollup");


function updateScrollButton() {

    if (!luxuryScrollup) {
        return;
    }

    if (window.scrollY > 500) {

        luxuryScrollup.classList.add("show");

    } else {

        luxuryScrollup.classList.remove("show");

    }

}


/* Listen for scroll */

window.addEventListener(
    "scroll",
    updateScrollButton,
    { passive: true }
);


/* Initial state */

updateScrollButton();


/* =========================================================
   SMOOTH SCROLL FOR INTERNAL FOOTER LINKS
   ========================================================= */

document
    .querySelectorAll('.luxury-footer a[href^="#"]')
    .forEach(function (link) {

        link.addEventListener(
            "click",
            function (event) {

                const targetId =
                    link.getAttribute("href");


                if (
                    !targetId ||
                    targetId === "#"
                ) {
                    return;
                }


                const target =
                    document.querySelector(
                        targetId
                    );


                if (!target) {
                    return;
                }


                event.preventDefault();


                target.scrollIntoView({

                    behavior: "smooth",

                    block: "start"

                });

            }
        );

    });


/* =========================================================
   FOOTER CTA BUTTON FEEDBACK
   ========================================================= */

const footerBookButton =
    document.querySelector(
        ".footer-book-btn"
    );


if (footerBookButton) {

    footerBookButton.addEventListener(
        "click",
        function () {

            footerBookButton.classList.add(
                "footer-button-clicked"
            );

            setTimeout(
                function () {

                    footerBookButton.classList.remove(
                        "footer-button-clicked"
                    );

                },
                350
            );

        }
    );

}
































// about section






/* ============================================================
   ABOUT SECTION — SOFT REVEAL
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  const aboutSection = document.querySelector("#about");

  if (!aboutSection) return;

  const revealItems = aboutSection.querySelectorAll(
    ".about-content, .about-visual"
  );

  const observer = new IntersectionObserver(
    (entries, obs) => {

      entries.forEach((entry) => {

        if (!entry.isIntersecting) return;

        entry.target.classList.add("about-visible");

        obs.unobserve(entry.target);
      });

    },
    {
      threshold: 0.15
    }
  );

  revealItems.forEach((item) => {
    item.classList.add("about-reveal");
    observer.observe(item);
  });

});


































// review section
/* ============================================================
   GURUDEV TRAVELS — REVIEWS SYSTEM
   Static Frontend + LocalStorage
============================================================ */

(function initReviews() {

    const reviewForm = document.getElementById("reviewForm");
    const reviewsCards = document.getElementById("reviewsCards");

    if (!reviewForm || !reviewsCards) return;


    /* ========================================================
       SAMPLE REVIEWS
       These are demo/sample reviews, not real customer reviews.
    ======================================================== */

    const defaultReviews = [
        {
            name: "Arun",
            route: "Madurai → Kodaikanal",
            tripType: "Family Trip",
            vehicle: "Toyota Rumion",
            rating: 5,
            experience:
                "The journey was very comfortable and smooth. The vehicle was clean and the driver was friendly throughout the trip.",
            highlights: [
                "Comfortable Ride",
                "Friendly Driver",
                "Clean Vehicle"
            ],
            createdAt: Date.now() - (2 * 60 * 60 * 1000)
        },

        {
            name: "Meena",
            route: "Tirunelveli → Kanyakumari",
            tripType: "Weekend Trip",
            vehicle: "Toyota Rumion",
            rating: 5,
            experience:
                "We had a pleasant family trip. Pickup was on time and the overall travel experience was safe and relaxing.",
            highlights: [
                "Safe Journey",
                "On-Time Service"
            ],
            createdAt: Date.now() - (8 * 60 * 60 * 1000)
        },

        {
            name: "Karthik",
            route: "Chennai → Ooty",
            tripType: "Friends Trip",
            vehicle: "Toyota Rumion",
            rating: 4,
            experience:
                "Very comfortable ride for a long journey. The vehicle had enough space and the trip was enjoyable.",
            highlights: [
                "Comfortable Ride",
                "Clean Vehicle"
            ],
            createdAt: Date.now() - (1 * 24 * 60 * 60 * 1000)
        }
    ];


    /* ========================================================
       LOAD REVIEWS
    ======================================================== */

    let reviews;

    try {

        const savedReviews =
            localStorage.getItem("gurudevTravelsReviews");

        reviews = savedReviews
            ? JSON.parse(savedReviews)
            : defaultReviews;

    } catch (error) {

        reviews = defaultReviews;

    }


    /* ========================================================
       SAVE REVIEWS
    ======================================================== */

    function saveReviews() {

        localStorage.setItem(
            "gurudevTravelsReviews",
            JSON.stringify(reviews)
        );

    }


    /* ========================================================
       INITIAL SAVE
    ======================================================== */

    if (!localStorage.getItem("gurudevTravelsReviews")) {
        saveReviews();
    }


    /* ========================================================
       RELATIVE TIME
    ======================================================== */

    function getRelativeTime(timestamp) {

        const seconds =
            Math.floor((Date.now() - timestamp) / 1000);

        if (seconds < 60) {
            return "Just Now";
        }

        const minutes =
            Math.floor(seconds / 60);

        if (minutes < 60) {
            return `${minutes} min ago`;
        }

        const hours =
            Math.floor(minutes / 60);

        if (hours < 24) {
            return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        }

        const days =
            Math.floor(hours / 24);

        if (days === 1) {
            return "Yesterday";
        }

        return `${days} days ago`;
    }


    /* ========================================================
       CREATE STARS
    ======================================================== */

    function createStars(rating) {

        let stars = "";

        for (let i = 1; i <= 5; i++) {

            stars += i <= rating ? "★" : "☆";

        }

        return stars;
    }


    /* ========================================================
       CREATE AVATAR
    ======================================================== */

    function getInitial(name) {

        return name
            .trim()
            .charAt(0)
            .toUpperCase();

    }


    /* ========================================================
       RENDER REVIEWS
       Latest 3 only
    ======================================================== */

    function renderReviews() {

        reviews.sort(
            (a, b) => b.createdAt - a.createdAt
        );


        const latestReviews =
            reviews.slice(0, 3);


        reviewsCards.innerHTML =
            latestReviews.map((review, index) => {

                const highlights =
                    review.highlights || [];


                const highlightHTML =
                    highlights
                        .map(
                            item =>
                                `<span class="review-highlight-tag">
                                    ${escapeHTML(item)}
                                </span>`
                        )
                        .join("");


                return `

                    <article class="review-card">

                        ${
                            index === 0
                                ? `
                                <div class="latest-review-badge">
                                    ✨ LATEST TRAVELLER
                                </div>
                                `
                                : ""
                        }


                        <div class="review-card-header">

                            <div class="reviewer-info">

                                <div class="reviewer-avatar">
                                    ${escapeHTML(
                                        getInitial(review.name)
                                    )}
                                </div>

                                <div>

                                    <strong>
                                        ${escapeHTML(review.name)}
                                    </strong>

                                    <small>
                                        ${getRelativeTime(
                                            review.createdAt
                                        )}
                                    </small>

                                </div>

                            </div>


                            <div class="review-stars">
                                ${createStars(review.rating)}
                            </div>

                        </div>


                        <div class="review-route">

                            <span>
                                📍 ${escapeHTML(review.route)}
                            </span>

                            <span>
                                ${escapeHTML(review.tripType)}
                            </span>

                        </div>


                        <div class="review-text-content">

                            "${escapeHTML(
                                review.experience
                            )}"

                        </div>


                        <div class="review-highlights-display">

                            ${highlightHTML}

                        </div>


                        <div class="review-completed">

                            <span>
                                🚗 ${escapeHTML(review.vehicle)}
                            </span>

                            <strong>
                                ✓ TRIP COMPLETED
                            </strong>

                        </div>

                    </article>

                `;

            })
            .join("");


        updateRatingSummary();
    }


    /* ========================================================
       UPDATE RATING
    ======================================================== */

    function updateRatingSummary() {

        if (!reviews.length) return;


        const total =
            reviews.reduce(
                (sum, review) =>
                    sum + Number(review.rating || 0),
                0
            );


        const average =
            total / reviews.length;


        const averageElement =
            document.getElementById("averageRating");


        if (averageElement) {

            averageElement.textContent =
                average.toFixed(1);

        }


        const countElement =
            document.getElementById("reviewCountText");


        if (countElement) {

            countElement.textContent =
                `Based on ${reviews.length} traveller ${
                    reviews.length === 1
                        ? "experience"
                        : "experiences"
                }`;

        }

    }


    /* ========================================================
       HTML SAFETY
    ======================================================== */

    function escapeHTML(value) {

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    }


    /* ========================================================
       RATING SELECTOR
    ======================================================== */

    const ratingButtons =
        document.querySelectorAll(
            "#ratingSelector button"
        );

    const ratingInput =
        document.getElementById("reviewRating");


    function updateRating(selectedRating) {

        ratingInput.value = selectedRating;


        ratingButtons.forEach(button => {

            const value =
                Number(button.dataset.rating);

            button.classList.toggle(
                "active",
                value <= selectedRating
            );

        });

    }


    ratingButtons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                updateRating(
                    Number(button.dataset.rating)
                );

            }
        );

    });


    updateRating(5);


    /* ========================================================
       CHARACTER COUNT
    ======================================================== */

    const experienceInput =
        document.getElementById(
            "reviewExperience"
        );

    const charCount =
        document.getElementById(
            "reviewCharCount"
        );


    experienceInput.addEventListener(
        "input",
        () => {

            charCount.textContent =
                experienceInput.value.length;

        }
    );


    /* ========================================================
       SUBMIT REVIEW
    ======================================================== */

    reviewForm.addEventListener(
        "submit",
        function (event) {

            event.preventDefault();


            const name =
                document.getElementById(
                    "reviewName"
                ).value.trim();


            const route =
                document.getElementById(
                    "reviewRoute"
                ).value.trim();


            const tripType =
                document.getElementById(
                    "reviewTripType"
                ).value;


            const vehicle =
                document.getElementById(
                    "reviewVehicle"
                ).value;


            const rating =
                Number(
                    document.getElementById(
                        "reviewRating"
                    ).value
                );


            const experience =
                document.getElementById(
                    "reviewExperience"
                ).value.trim();


            const selectedHighlights =
                Array.from(
                    document.querySelectorAll(
                        ".highlight-option input:checked"
                    )
                ).map(
                    checkbox => checkbox.value
                );


            if (
                !name ||
                !route ||
                !tripType ||
                !vehicle ||
                !rating ||
                !experience
            ) {

                return;

            }


            /* NEW REVIEW */
            const newReview = {

                name,
                route,
                tripType,
                vehicle,
                rating,
                experience,

                highlights:
                    selectedHighlights,

                createdAt:
                    Date.now()

            };


            /* Add latest review FIRST */
            reviews.unshift(newReview);


            saveReviews();


            /* Animate cards */
            reviewsCards.classList.add(
                "is-changing"
            );


            setTimeout(() => {

                renderReviews();

                reviewsCards.classList.remove(
                    "is-changing"
                );

            }, 250);


            /* Reset form */
            reviewForm.reset();


            updateRating(5);

            charCount.textContent = "0";


            /* Success */
            const successMessage =
                document.getElementById(
                    "reviewSuccess"
                );


            successMessage.classList.add(
                "show"
            );


            setTimeout(() => {

                successMessage.classList.remove(
                    "show"
                );

            }, 4000);


            /* Scroll to latest reviews */
            setTimeout(() => {

                reviewsCards.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });

            }, 350);

        }
    );


    /* ========================================================
       REVIEW NAVIGATION
       Shows latest 3, then rotates older reviews
    ======================================================== */

    /* ========================================================
   REVIEW NAVIGATION
   - Always keeps newest review as #1
   - Older reviews stay stored
   - Shows only 3 reviews at a time
   - Arrows move through older reviews
======================================================== */

let reviewPage = 0;

const REVIEWS_PER_PAGE = 3;


/* --------------------------------------------------------
   RENDER CURRENT 3 REVIEWS
-------------------------------------------------------- */

function renderReviewPage() {

    const sortedReviews = [...reviews].sort(
        (a, b) => b.createdAt - a.createdAt
    );

    const totalPages = Math.ceil(
        sortedReviews.length / REVIEWS_PER_PAGE
    );

    if (totalPages === 0) {
        reviewPage = 0;
        return;
    }

    if (reviewPage >= totalPages) {
        reviewPage = totalPages - 1;
    }

    if (reviewPage < 0) {
        reviewPage = 0;
    }


    const start =
        reviewPage * REVIEWS_PER_PAGE;

    const visibleReviews =
        sortedReviews.slice(
            start,
            start + REVIEWS_PER_PAGE
        );


    reviewsCards.innerHTML =
        visibleReviews.map((review, index) => {

            const highlights =
                review.highlights || [];

            const highlightHTML =
                highlights
                    .map(
                        item =>
                            `<span class="review-highlight-tag">
                                ${escapeHTML(item)}
                            </span>`
                    )
                    .join("");


            return `

                <article class="review-card">

                    ${
                        reviewPage === 0 && index === 0
                            ? `
                                <div class="latest-review-badge">
                                    ✨ LATEST TRAVELLER
                                </div>
                            `
                            : ""
                    }


                    <div class="review-card-header">

                        <div class="reviewer-info">

                            <div class="reviewer-avatar">
                                ${escapeHTML(
                                    getInitial(review.name)
                                )}
                            </div>

                            <div>

                                <strong>
                                    ${escapeHTML(review.name)}
                                </strong>

                                <small>
                                    ${getRelativeTime(
                                        review.createdAt
                                    )}
                                </small>

                            </div>

                        </div>


                        <div class="review-stars">
                            ${createStars(review.rating)}
                        </div>

                    </div>


                    <div class="review-route">

                        <span>
                            📍 ${escapeHTML(review.route)}
                        </span>

                        <span>
                            ${escapeHTML(review.tripType)}
                        </span>

                    </div>


                    <div class="review-text-content">

                        "${escapeHTML(
                            review.experience
                        )}"

                    </div>


                    <div class="review-highlights-display">

                        ${highlightHTML}

                    </div>


                    <div class="review-completed">

                        <span>
                            🚗 ${escapeHTML(review.vehicle)}
                        </span>

                        <strong>
                            ✓ TRIP COMPLETED
                        </strong>

                    </div>

                </article>

            `;

        }).join("");


    updateRatingSummary();

    updateReviewButtons(
        sortedReviews.length
    );
}


/* --------------------------------------------------------
   UPDATE ARROWS
-------------------------------------------------------- */

function updateReviewButtons(totalReviews) {

    const previousButton =
        document.getElementById("reviewPrev");

    const nextButton =
        document.getElementById("reviewNext");

    if (!previousButton || !nextButton) {
        return;
    }


    const totalPages =
        Math.ceil(
            totalReviews / REVIEWS_PER_PAGE
        );


    /*
       LEFT ARROW
       Go back towards newer reviews
    */

    previousButton.disabled =
        reviewPage === 0;


    /*
       RIGHT ARROW
       Go forward towards older reviews
    */

    nextButton.disabled =
        reviewPage >= totalPages - 1;


    previousButton.style.opacity =
        previousButton.disabled ? "0.35" : "1";

    nextButton.style.opacity =
        nextButton.disabled ? "0.35" : "1";


    previousButton.style.pointerEvents =
        previousButton.disabled ? "none" : "auto";

    nextButton.style.pointerEvents =
        nextButton.disabled ? "none" : "auto";
}


/* --------------------------------------------------------
   LEFT ARROW → NEWER REVIEWS
-------------------------------------------------------- */

const previousButton =
    document.getElementById("reviewPrev");

if (previousButton) {

    previousButton.addEventListener(
        "click",
        function () {

            if (reviewPage > 0) {

                reviewPage--;

                reviewsCards.classList.add(
                    "is-changing"
                );


                setTimeout(() => {

                    renderReviewPage();

                    reviewsCards.classList.remove(
                        "is-changing"
                    );

                }, 200);

            }

        }
    );

}


/* --------------------------------------------------------
   RIGHT ARROW → OLDER REVIEWS
-------------------------------------------------------- */

const nextButton =
    document.getElementById("reviewNext");

if (nextButton) {

    nextButton.addEventListener(
        "click",
        function () {

            const totalPages =
                Math.ceil(
                    reviews.length /
                    REVIEWS_PER_PAGE
                );


            if (reviewPage < totalPages - 1) {

                reviewPage++;

                reviewsCards.classList.add(
                    "is-changing"
                );


                setTimeout(() => {

                    renderReviewPage();

                    reviewsCards.classList.remove(
                        "is-changing"
                    );

                }, 200);

            }

        }
    );

}




    /* ========================================================
       INITIAL RENDER
    ======================================================== */

  renderReviewPage();


    /* ========================================================
       UPDATE RELATIVE TIME
       Every 60 seconds
    ======================================================== */

    setInterval(
        renderReviews,
        60000
    );


})();






















































const revealSections =
    document.querySelectorAll(".scroll-reveal");

const revealObserver =
    new IntersectionObserver(
        (entries) => {

            entries.forEach((entry) => {

                if (entry.isIntersecting) {

                    entry.target.classList.add(
                        "scroll-visible"
                    );

                } else {

                    entry.target.classList.remove(
                        "scroll-visible"
                    );

                }

            });

        },
        {
            threshold: 0.15
        }
    );

revealSections.forEach((section) => {
    revealObserver.observe(section);
});


















































// trip calculation start


/* =====================================================
   GURUDEV TRAVELS - TRIP COST CALCULATOR
===================================================== */

(() => {
    "use strict";

    const calculator = document.getElementById("trip-calculator");

    // Prevent errors if this section is not on the page.
    if (!calculator) return;

    const pickupInput = document.getElementById("tripPickup");
    const dropInput = document.getElementById("tripDrop");
    const stopsContainer = document.getElementById("tripStopsContainer");
    const addStopButton = document.getElementById("addTripStop");
    const tripTypeSelect = document.getElementById("tripType");
    const vehicleSelect = document.getElementById("tripVehicle");
    const daysSelect = document.getElementById("tripDays");
    const calculateButton = document.getElementById("calculateTripCost");
    const whatsappButton = document.getElementById("tripWhatsAppBooking");
    const messageElement = document.getElementById("tripCalculatorMessage");

    const output = {
        distance: document.getElementById("tripDistanceResult"),
        days: document.getElementById("tripDaysResult"),
        vehicle: document.getElementById("tripVehicleResult"),
        rent: document.getElementById("tripRentResult"),
        driver: document.getElementById("tripDriverResult"),
        distanceCharge: document.getElementById("tripDistanceChargeResult"),
        total: document.getElementById("tripTotalResult")
    };

    /*
      EXAMPLE PRICING ONLY.

      Change these values to match your actual
      Gurudev Travels pricing policy.

      dailyRent:
        Vehicle rental per day.

      driverAllowance:
        Driver allowance per day.

      perKm:
        Distance charge per kilometre.

      minimumKmPerDay:
        Minimum billable kilometres per day.

      The calculation uses whichever is greater:
      actual route kilometres OR minimum kilometres.
    */

    const vehicleRates = {
        rumion: {
            name: "Toyota Rumion",
            dailyRent: 3000,
            driverAllowance: 400,
            perKm: 0,
            minimumKmPerDay: 250
        },

        innova: {
            name: "Toyota Innova",
            dailyRent: 3500,
            driverAllowance: 400,
            perKm: 0,
            minimumKmPerDay: 250
        },

        crysta: {
            name: "Innova Crysta",
            dailyRent: 4000,
            driverAllowance: 500,
            perKm: 0,
            minimumKmPerDay: 250
        }
    };

    // Replace this with your official business WhatsApp number.
    // Country code included; do not use +, spaces or dashes.
    const WHATSAPP_NUMBER = "91XXXXXXXXXX";

    let lastEstimate = null;

    const currencyFormatter = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0
    });

    function formatCurrency(amount) {
        return currencyFormatter.format(amount);
    }

    function showMessage(message, type = "") {
        messageElement.textContent = message;
        messageElement.className = "trip-calculator-message";

        if (type) {
            messageElement.classList.add(`trip-${type}`);
        }
    }

    function clearEstimate() {
        lastEstimate = null;
        whatsappButton.disabled = true;

        output.distance.textContent = "-- KM";
        output.days.textContent = "--";
        output.vehicle.textContent = "--";
        output.rent.textContent = "₹0";
        output.driver.textContent = "₹0";
        output.distanceCharge.textContent = "₹0";
        output.total.textContent = "₹0";
    }

    function getStops() {
        return Array.from(
            stopsContainer.querySelectorAll(".trip-stop-input")
        )
            .map(input => input.value.trim())
            .filter(Boolean);
    }

    // Add an additional stop.
    addStopButton.addEventListener("click", () => {
        const currentStops =
            stopsContainer.querySelectorAll(".trip-stop-row").length;

        if (currentStops >= 5) {
            showMessage("You can add up to 5 additional stops.", "error");
            return;
        }

        const row = document.createElement("div");
        row.className = "trip-stop-row";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "trip-stop-input";
        input.placeholder = `Stop ${currentStops + 1}`;
        input.setAttribute("aria-label", `Additional stop ${currentStops + 1}`);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "trip-remove-stop";
        removeButton.textContent = "×";
        removeButton.setAttribute("aria-label", "Remove this stop");

        removeButton.addEventListener("click", () => {
            row.remove();
            clearEstimate();
            showMessage("Stop removed. Calculate the trip again.");
        });

        input.addEventListener("input", clearEstimate);

        row.append(input, removeButton);
        stopsContainer.appendChild(row);

        clearEstimate();
        showMessage("Additional stop added.");
    });

    // Clear the previous estimate whenever trip details change.
    [
        pickupInput,
        dropInput,
        tripTypeSelect,
        vehicleSelect,
        daysSelect
    ].forEach(element => {
        element.addEventListener("input", clearEstimate);
        element.addEventListener("change", clearEstimate);
    });

    // Convert a place name into latitude and longitude.
    async function geocodePlace(place) {
        const url =
            "https://nominatim.openstreetmap.org/search?" +
            new URLSearchParams({
                q: place,
                format: "jsonv2",
                limit: "1",
                countrycodes: "in"
            });

        const response = await fetch(url, {
            headers: {
                Accept: "application/json"
            }
        });

        if (!response.ok) {
            throw new Error("Location search is temporarily unavailable.");
        }

        const results = await response.json();

        if (!results.length) {
            throw new Error(`Could not find this location: ${place}`);
        }

        return {
            lat: Number(results[0].lat),
            lon: Number(results[0].lon),
            name: results[0].display_name
        };
    }

    // Get driving distance between two coordinates.
    async function getDrivingDistance(from, to) {
        const coordinates =
            `${from.lon},${from.lat};${to.lon},${to.lat}`;

        const url =
            `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
            "?overview=false&alternatives=false&steps=false";

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Could not calculate the road distance.");
        }

        const data = await response.json();

        if (data.code !== "Ok" || !data.routes || !data.routes.length) {
            throw new Error("No driving route was found for these locations.");
        }

        return data.routes[0].distance / 1000;
    }

    // Calculate the full route through all stops.
    async function calculateRouteDistance(placeNames) {
        const locations = [];

        /*
          Geocode locations one at a time to avoid sending
          several simultaneous requests to the free service.
        */
        for (const placeName of placeNames) {
            locations.push(await geocodePlace(placeName));
        }

        let totalDistance = 0;

        for (let index = 0; index < locations.length - 1; index++) {
            totalDistance += await getDrivingDistance(
                locations[index],
                locations[index + 1]
            );
        }

        return totalDistance;
    }

    // Calculate trip cost.
    calculateButton.addEventListener("click", async () => {
        clearEstimate();
        showMessage("");

        const pickup = pickupInput.value.trim();
        const drop = dropInput.value.trim();
        const stops = getStops();
        const tripType = tripTypeSelect.value;
        const vehicleKey = vehicleSelect.value;
        const days = Number(daysSelect.value);
        const rate = vehicleRates[vehicleKey];

        if (!pickup || !drop) {
            showMessage("Please enter both Pickup and Drop locations.", "error");
            return;
        }

        if (!rate || !Number.isInteger(days) || days < 1) {
            showMessage("Please select a valid vehicle and trip duration.", "error");
            return;
        }

        const routePlaces = [pickup, ...stops, drop];

        if (tripType === "roundtrip") {
            routePlaces.push(pickup);
        }

        calculateButton.disabled = true;
        calculateButton.textContent = "Calculating...";
        showMessage("Finding locations and calculating road distance...");

        try {
            const distance = await calculateRouteDistance(routePlaces);

            /*
              Illustrative pricing formula:

              1. Daily rental = daily rate × number of days.
              2. Driver allowance = daily allowance × days.
              3. Minimum billable KM = minimum KM/day × days.
              4. Distance charge = billable KM × per-KM rate.

              Here, perKm is 0 in the sample rates, so the
              example total uses daily rent + driver allowance.
              Change the rates/formula to match your business.
            */

            const minimumDistance = rate.minimumKmPerDay * days;

            const billableDistance = Math.max(
                distance,
                minimumDistance
            );

            const vehicleRent = rate.dailyRent * days;

            const driverAllowance = rate.driverAllowance * days;

            const distanceCharge = billableDistance * rate.perKm;

            const total =
                vehicleRent +
                driverAllowance +
                distanceCharge;

            lastEstimate = {
                pickup,
                drop,
                stops,
                tripType,
                vehicle: rate.name,
                days,
                distance,
                billableDistance,
                vehicleRent,
                driverAllowance,
                distanceCharge,
                total
            };

            output.distance.textContent =
                `${distance.toFixed(1)} KM` +
                (tripType === "roundtrip" ? " (round trip)" : "");

            output.days.textContent =
                `${days} ${days === 1 ? "Day" : "Days"}`;

            output.vehicle.textContent = rate.name;
            output.rent.textContent = formatCurrency(vehicleRent);
            output.driver.textContent = formatCurrency(driverAllowance);
            output.distanceCharge.textContent = formatCurrency(distanceCharge);
            output.total.textContent = formatCurrency(total);

            whatsappButton.disabled = false;

            showMessage(
                "Estimate calculated successfully. Final charges may vary.",
                "success"
            );

        } catch (error) {
            showMessage(
                error.message ||
                "Unable to calculate the trip. Please try again.",
                "error"
            );
        } finally {
            calculateButton.disabled = false;
            calculateButton.textContent = "Calculate Trip Cost";
        }
    });

    // Open WhatsApp with the calculated trip details.
    whatsappButton.addEventListener("click", () => {
        if (!lastEstimate) {
            showMessage("Please calculate your trip first.", "error");
            return;
        }

        if (!/^91\d{10}$/.test(WHATSAPP_NUMBER)) {
            showMessage(
                "Please add your official WhatsApp number in the JavaScript code.",
                "error"
            );
            return;
        }

        const estimate = lastEstimate;

        const message = [
            "Hello Gurudev Travels!",
            "",
            "I would like to enquire about this trip:",
            `Pickup: ${estimate.pickup}`,
            `Drop: ${estimate.drop}`,
            `Additional Stops: ${estimate.stops.length ? estimate.stops.join(", ") : "None"}`,
            `Trip Type: ${estimate.tripType === "roundtrip" ? "Round Trip" : "One-Way Trip"}`,
            `Vehicle: ${estimate.vehicle}`,
            `Duration: ${estimate.days} day(s)`,
            `Estimated Road Distance: ${estimate.distance.toFixed(1)} KM`,
            `Estimated Vehicle Rent: ${formatCurrency(estimate.vehicleRent)}`,
            `Driver Allowance: ${formatCurrency(estimate.driverAllowance)}`,
            `Distance Charge: ${formatCurrency(estimate.distanceCharge)}`,
            `Estimated Total: ${formatCurrency(estimate.total)}`,
            "",
            "Please confirm the final fare and availability."
        ].join("\n");

        const whatsappURL =
            `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

        window.open(whatsappURL, "_blank", "noopener,noreferrer");
    });

})();

