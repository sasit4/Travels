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
  { id:"rumion", img:"assets/img/rumion.png", name:"Toyota Rumion", seats:7, bags:4, fare:"Contact for pricing", tag:"White · Premium", badge:"jade",
    desc:"Comfortable 7-seater white Toyota Rumion. Perfect for family trips and long journeys with premium comfort." },
];

/* ===================== HELPERS ===================== */

const $ = (id) => document.getElementById(id);
const todayStr = () => new Date().toISOString().split("T")[0];
const isConfigured = () => API_URL && !API_URL.startsWith("PASTE_");
const show = (id) => $(id)?.classList.remove("hidden");
const hide = (id) => $(id)?.classList.add("hidden");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function mapsRouteUrl(from, to){
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`;
}

// Route link on its own line, with a blank line above it, closing both WhatsApp messages.
function mapLinkLines(b){
  if (!b.pickup || !b.drop) return [];
  return ["", `Route map: ${mapsRouteUrl(b.routeFrom || b.pickup, b.routeTo || b.drop)}`];
}

const RULE = "----------------------------";

// Message the CAB OWNER receives (a new booking has come in).
function buildOwnerMessage(b){
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
function buildCustomerMessage(b){
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

function whatsappLink(message, to){
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/* ===================== THEME ===================== */
(function initTheme(){
  const saved = localStorage.getItem("wander-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) document.documentElement.classList.add("dark");
})();

/* ===================== FLEET ===================== */
function renderFleet(){
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

function loadGooglePlaces(){
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

async function googleSearch(query){
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
async function resolveCoords(r){
  if (r.lat != null || !r._pred) return r;
  const place = r._pred.toPlace();
  await place.fetchFields({ fields: ["location", "formattedAddress"] });
  r.lat = place.location.lat(); r.lon = place.location.lng();
  r.display_name = place.formattedAddress || r.display_name;
  placesToken = null;
  return r;
}

// Free-form place search -> array of results [{display_name, lat, lon}] (Google ones resolve lat/lon on pick)
async function geocodeSearch(query){
  if (!query || query.trim().length < 3) return [];
  const g = await googleSearch(query.trim());
  if (g) return g;
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&limit=6&addressdetails=0&countrycodes=in&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers:{ "Accept":"application/json" } });
    return await res.json();
  } catch (e) { console.warn("Search failed:", e); return []; }
}

// Coordinates -> human address
async function reverseGeocode(lat, lon){
  if (await loadGooglePlaces()){
    try {
      const { Geocoder } = await google.maps.importLibrary("geocoding");
      const res = await new Geocoder().geocode({ location: { lat, lng: lon } });
      if (res.results && res.results[0]) return res.results[0].formatted_address;
    } catch (e) { console.warn("Google reverse geocode failed:", e); }
  }
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers:{ "Accept":"application/json" } });
    const d = await res.json();
    return d && d.display_name ? d.display_name : null;
  } catch (e) { console.warn("Reverse geocode failed:", e); return null; }
}

// Simple debounce so we respect Nominatim's ~1 request/second policy.
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ----- Typing suggestions on the pickup/drop fields (free, via Nominatim) ----- */
// Confirmed lat/lng for each field — only set once a suggestion (or the map picker) is picked,
// so the route link/WhatsApp message can use the exact point instead of guessing from free text.
const pickedCoords = { pickup: null, drop: null };

function renderSuggestions(listEl, results, inputEl, fieldKey){
  if (!results.length){ listEl.classList.add("hidden"); listEl.innerHTML = ""; return; }
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

function initOsmAutocomplete(){
  [["pickup","pickupSuggest","pickup"], ["drop","dropSuggest","drop"]].forEach(([inputId, listId, fieldKey]) => {
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
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize:[25,41], iconAnchor:[12,41], popupAnchor:[1,-34], shadowSize:[41,41],
}) : null;

let pmap, pmarker, mapBuilt = false, mapTargetField = null, pickedAddress = "", pickedLatLng = null;

function buildPickerMap(){
  pmap = L.map("mapCanvas").setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors",
  }).addTo(pmap);
  pmarker = L.marker([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], { draggable:true, icon:LEAFLET_ICON }).addTo(pmap);

  pmap.on("click", (e) => setPicked(e.latlng.lat, e.latlng.lng));
  pmarker.on("dragend", () => { const ll = pmarker.getLatLng(); setPicked(ll.lat, ll.lng); });

  // Search box inside the modal -> results list
  const results = $("mapResults");
  const run = debounce(async () => {
    const list = await geocodeSearch($("mapSearch").value);
    if (!list.length){ results.classList.add("hidden"); results.innerHTML = ""; return; }
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

async function setPicked(lat, lon, knownAddr){
  pmarker.setLatLng([lat, lon]);
  pickedLatLng = { lat, lon };
  $("mapConfirm").disabled = false;
  if (knownAddr){ pickedAddress = knownAddr; $("mapPickedAddr").textContent = knownAddr; return; }
  $("mapPickedAddr").textContent = "Locating…";
  pickedAddress = await reverseGeocode(lat, lon) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $("mapPickedAddr").textContent = pickedAddress;
}

function openMapPicker(field){
  if (typeof L === "undefined"){
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
    if (existing){
      const first = (await geocodeSearch(existing))[0];
      const r = first && await resolveCoords(first);
      if (r){ const lat = parseFloat(r.lat), lon = parseFloat(r.lon); pmap.setView([lat, lon], 14); setPicked(lat, lon, r.display_name); }
    } else if (navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        (pos) => { const { latitude:lat, longitude:lon } = pos.coords; pmap.setView([lat, lon], 14); setPicked(lat, lon); },
        () => { pmap.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM); }
      );
    }
  }, 250);
}

function initMapPicker(){
  document.querySelectorAll(".map-pick-btn").forEach(btn =>
    btn.addEventListener("click", () => openMapPicker(btn.dataset.target)));
  $("mapClose").addEventListener("click", () => hide("mapModal"));
  $("mapModal").addEventListener("click", (e) => { if (e.target.id === "mapModal") hide("mapModal"); });
  $("mapConfirm").addEventListener("click", () => {
    if (mapTargetField && pickedAddress){
      $(mapTargetField).value = pickedAddress;
      pickedCoords[mapTargetField] = pickedLatLng;
      updateMapLink();
    }
    hide("mapModal");
  });
  $("mapUseLocation")?.addEventListener("click", () => {
    if (!navigator.geolocation){ alert("Your browser doesn't support location access — please pick on the map or type the address."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const { latitude:lat, longitude:lon } = pos.coords; pmap.setView([lat, lon], 15); setPicked(lat, lon); },
      () => alert("Couldn't get your location. Please allow location access, or pick the spot on the map.")
    );
  });
}

// Coordinates (when a suggestion or the map was used) beat loose typed text for the actual route.
function updateMapLink(){
  const pickupText = $("pickup").value.trim(), dropText = $("drop").value.trim();
  const from = pickedCoords.pickup ? `${pickedCoords.pickup.lat},${pickedCoords.pickup.lon}` : pickupText;
  const to = pickedCoords.drop ? `${pickedCoords.drop.lat},${pickedCoords.drop.lon}` : dropText;
  const link = $("mapLink");
  if (pickupText && dropText){ link.href = mapsRouteUrl(from, to); link.classList.remove("hidden"); link.classList.add("flex"); }
  else { link.classList.add("hidden"); link.classList.remove("flex"); }
}

/* ===================== BOOKING FORM ===================== */
function initBookingForm(){
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
    const ownerUrl    = whatsappLink(buildOwnerMessage(b), OWNER_WHATSAPP);
    const customerUrl = whatsappLink(buildCustomerMessage(b), b.phone);

    // Open the OWNER's WhatsApp immediately (synchronous = no popup block) so they're notified.
    window.open(ownerUrl, "_blank");

    showSuccess(b, ownerUrl, customerUrl);
    resetForm(e.target);

    // ---- Backend: save to Sheet + (if Cloud API configured) auto-send BOTH WhatsApp messages ----
    if (isConfigured()){
      fetch(API_URL, {
        method:"POST",
        headers:{ "Content-Type":"text/plain;charset=utf-8" },
        body: JSON.stringify({ action:"create", booking:b }),
      }).catch((ex) => console.warn("Backend call failed:", ex));
    }
  });

  $("closeModal").addEventListener("click", () => hide("successModal"));
  $("successModal").addEventListener("click", (e) => { if (e.target.id === "successModal") hide("successModal"); });
}

function resetForm(form){ form.reset(); $("passengers").value = 2; pickedCoords.pickup = null; pickedCoords.drop = null; updateMapLink(); }
function showError(el, msg){ el.textContent = msg; el.classList.remove("hidden"); }
function showSuccess(b, ownerUrl, customerUrl){
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
function initContact(){
  $("phoneLink").href = whatsappLink("Hi Gurudev Travels! 👋", OWNER_WHATSAPP);
  $("contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = `Hi Gurudev Travels! 👋\n\nName: ${$("cName").value.trim()}\nMessage: ${$("cMsg").value.trim()}`;
    window.open(whatsappLink(text, OWNER_WHATSAPP), "_blank");
  });
}

/* ===================== SCROLL REVEAL ===================== */
function initReveal(){
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { threshold:0.15 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));
}

/* ===================== NAVBAR + SCROLL-UP ===================== */
function initScrollUi(){
  const nav = $("navbar");
  const up = document.querySelector(".scrollup");
  const onScroll = () => {
    const y = window.scrollY;
    nav?.classList.toggle("nav-scrolled", y > 60);
    up?.classList.toggle("show", y > 400);
  };
  window.addEventListener("scroll", onScroll, { passive:true });
  onScroll();
}

/* ===================== SUBSCRIBE (optional) ===================== */
function initSubscribe(){
  const f = document.getElementById("subscribeForm");
  if (!f) return;
  f.addEventListener("submit", (e) => { e.preventDefault(); f.reset(); alert("Thanks for subscribing! 🎉 We'll send offers your way."); });
}

/* ===================== BOOT ===================== */
function initCarousel(){
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
