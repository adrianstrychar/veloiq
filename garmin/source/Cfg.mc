import Toybox.Application;
import Toybox.Lang;
import Toybox.System;
import Toybox.UserProfile;

//! Ustawienia i dane zawodnika trzymane na urządzeniu (Application.Storage), z kopią w pamięci.
module Cfg {
    const DEFAULT_API = "https://veloiq-three.vercel.app";
    const VERSION = "0.3.1";

    var apiBase as String = "https://veloiq-three.vercel.app";
    var token as String = "";          // token urządzenia po sparowaniu z kontem VeloIQ
    var athlete as String = "";        // imię z VeloIQ
    var ftp as Number = 250;
    var hrmax as Number = 0;
    var weightKg as Number = 75;
    var wPrime as Number = 20000;      // J
    var autoLapMode as Number = 3;     // 0 wył., 1 dystans, 2 czas, 3 wysiłki (smart)
    var autoLapKm as Number = 5;
    var autoLapMin as Number = 10;
    var autoPause as Boolean = true;
    var tones as Boolean = true;
    var theme as Number = 0;           // 0 ciemny VeloIQ, 1 jasny (pełne słońce)
    var indoor as Boolean = false;     // trenażer: bez GPS, podtyp „indoor cycling”
    var navOn as Boolean = true;        // nawigacja po trasie GPX z VeloIQ (gdy trasa jest pobrana)
    var phoneLink as Boolean = true;   // most do telefonu (aplikacja VeloIQ z Connect IQ) – domyślnie włączony; klucz "link"
    var pages = null;                  // konfiguracja stron pól danych: [[id, id, …], [id, …]]
    // ekrany graficzne (Ustawienia → Ekrany jazdy) – domyślnie wszystkie
    var pgChart as Boolean = true;     // WYKRES treningu
    var pgEffort as Boolean = true;    // WYSIŁEK (rezerwa W′, strefy)
    var pgFuel as Boolean = true;      // PALIWO
    var pgClimb as Boolean = true;     // PODJAZD (na trasie)
    var edges as Boolean = true;       // kolorowe krawędzie ekranu TRENING (zgodność z celem – jak diody Wahoo)

    function get(key as String, dflt) {
        var v = Application.Storage.getValue(key);
        return v == null ? dflt : v;
    }

    function put(key as String, v) as Void {
        Application.Storage.setValue(key, v);
    }

    function load() as Void {
        apiBase = get("apiBase", DEFAULT_API);
        token = get("token", "");
        athlete = get("athlete", "");
        ftp = get("ftp", 250);
        hrmax = get("hrmax", 0);
        weightKg = get("weightKg", 0);
        if (weightKg <= 0) {
            // waga z profilu Garmina (gramy), dopóki VeloIQ nie poda swojej
            var prof = UserProfile.getProfile();
            weightKg = (prof != null && prof.weight != null && prof.weight > 20000) ? prof.weight / 1000 : 75;
        }
        wPrime = get("wPrime", 20000);
        autoLapMode = get("autoLapMode", 3);
        autoLapKm = get("autoLapKm", 5);
        autoLapMin = get("autoLapMin", 10);
        autoPause = get("autoPause", true);
        tones = get("tones", true);
        theme = get("theme", 0);
        indoor = get("indoor", false);
        phoneLink = get("link", true);       // stary klucz "phoneLink" (domyślnie wył.) celowo pominięty
        navOn = get("navOn", true);
        pages = get("pages", null);
        pgChart = get("pgChart", true);
        pgEffort = get("pgEffort", true);
        pgFuel = get("pgFuel", true);
        pgClimb = get("pgClimb", true);
        edges = get("edges", true);
    }

    function save(key as String, v) as Void {
        put(key, v);
        load();
    }

    function paired() as Boolean {
        return token.length() > 0;
    }

    function unpair() as Void {
        Application.Storage.deleteValue("token");
        Application.Storage.deleteValue("athlete");
        load();
    }
}

//! Kolory: ciemny motyw VeloIQ (#06080A + cyjan #00CFFF) i jasny do pełnego słońca.
module Th {
    var bg as Number = 0x06080A;
    var card as Number = 0x141B21;
    var line as Number = 0x26323B;
    var fg as Number = 0xFFFFFF;
    var dim as Number = 0x93A1AD;
    var accent as Number = 0x00CFFF;
    var onAccent as Number = 0x06080A;
    var good as Number = 0x21D07A;
    var bad as Number = 0xFF4D4D;
    var warn as Number = 0xFFB020;
    var cold as Number = 0x4D9BFF;

    function apply(theme as Number) as Void {
        if (theme == 1) {
            bg = 0xFFFFFF; card = 0xE9EEF2; line = 0xB8C2CB; fg = 0x000000; dim = 0x4A5661;
            accent = 0x0086B3; onAccent = 0xFFFFFF; good = 0x0A8F4B; bad = 0xD01818; warn = 0xB86E00; cold = 0x1F5FD0;
        } else {
            bg = 0x06080A; card = 0x141B21; line = 0x26323B; fg = 0xFFFFFF; dim = 0x93A1AD;
            accent = 0x00CFFF; onAccent = 0x06080A; good = 0x21D07A; bad = 0xFF4D4D; warn = 0xFFB020; cold = 0x4D9BFF;
        }
    }

    //! Kolor strefy mocy Z1–Z7 (indeks 0–6).
    function zone(z as Number) as Number {
        var c = [0x7F8C9A, 0x4D9BFF, 0x21D07A, 0xFFD23F, 0xFF8A1F, 0xFF4D4D, 0xB45CFF];
        return c[z < 0 ? 0 : (z > 6 ? 6 : z)];
    }

    function stepColor(type as Number) as Number {
        if (type == StepType.INTERVAL) { return 0xFF8A1F; }
        if (type == StepType.RECOVERY) { return 0x4D9BFF; }
        if (type == StepType.WARMUP) { return 0x21D07A; }
        if (type == StepType.COOLDOWN) { return 0x7F8C9A; }
        if (type == StepType.STEADY) { return 0x00CFFF; }
        return 0x93A1AD;
    }
}
