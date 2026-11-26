import Toybox.Application;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! Menu systemowe (Menu2): działają tak samo dotykiem i przyciskami.
module Menus {

    function item(label as String, sub, id as String) as WatchUi.MenuItem {
        return new WatchUi.MenuItem(label, sub, id, {});
    }

    function toggle(label as String, id as String, on as Boolean) as WatchUi.ToggleMenuItem {
        return new WatchUi.ToggleMenuItem(label, null, id, on, {});
    }

    function autoLapLabel() as String {
        if (Cfg.autoLapMode == 1) { return "co " + Cfg.autoLapKm + " km"; }
        if (Cfg.autoLapMode == 2) { return "co " + Cfg.autoLapMin + " min"; }
        if (Cfg.autoLapMode == 3) { return "wysiłki i podjazdy"; }
        return "wyłączony";
    }

    //! MENU na ekranie startowym: tylko to, czego nie ma na ekranie (start i jazda swobodna są przyciskami).
    function home() as WatchUi.Menu2 {
        var r = getRide();
        var m = new WatchUi.Menu2({ :title => "VeloIQ" });
        if (Cfg.paired()) {
            m.addItem(item("Synchronizuj", "plan, FTP, trasa, zaległe jazdy", "sync"));
            m.addItem(item("Wybierz trening", r.plan == null ? "brak na dziś" : r.plan.name, "pick"));
        } else {
            m.addItem(item("Połącz z kontem VeloIQ", "sam przez telefon albo kodem", "pair"));
        }
        if (r.interrupted != null) { m.addItem(item("Odrzuć przerwaną jazdę", "bez zapisu i wysyłki", "dropck")); }
        m.addItem(item(modeLabel(), modeSub(), "mode"));
        if (r.up.pending() > 0) {
            m.addItem(item("Wyślij zaległe jazdy", "w kolejce: " + r.up.pending(), "upload"));
        }
        m.addItem(item("Ustawienia", null, "settings"));
        m.addItem(item("VeloIQ Edge " + Cfg.VERSION, Cfg.paired() ? "konto: " + (Cfg.athlete.length() > 0 ? Cfg.athlete : "połączone") : "veloiq-three.vercel.app", "about"));
        return m;
    }

    function modeLabel() as String { return Cfg.indoor ? "Tryb: trenażer" : "Tryb: na zewnątrz"; }
    function modeSub() as String { return Cfg.indoor ? "bez GPS, prędkość z mocy" : "GPS, nawigacja po trasie"; }

    //! Trenażer ⇄ na zewnątrz: GPS wyłącza się / włącza od razu.
    function setIndoor(on as Boolean) as Void {
        Cfg.save("indoor", on);
        var hub = getRide().hub;
        hub.stop();
        hub.start(!Cfg.indoor);
    }

    //! Most do telefonu: stan jednym słowem (pod przełącznikiem w ustawieniach).
    function linkSub() as String {
        var r = getRide();
        if (!Cfg.phoneLink) { return "wyłączony"; }
        if (r.link.active) { return "słucha · wysłane " + r.link.okN + ", błędy " + r.link.failN; }
        return System.getDeviceSettings().phoneConnected ? "otwórz VeloIQ w telefonie" : "brak telefonu";
    }

    function settings() as WatchUi.Menu2 {
        var m = new WatchUi.Menu2({ :title => "Ustawienia" });
        m.addItem(item("FTP", "" + Cfg.ftp + " W" + (Cfg.paired() ? " (z VeloIQ)" : ""), "ftp"));
        m.addItem(item("Auto-lap", autoLapLabel(), "autolap"));
        m.addItem(new WatchUi.ToggleMenuItem("Auto-pauza", "postój zatrzymuje czas", "autopause", Cfg.autoPause, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Dźwięki", null, "tones", Cfg.tones, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Jasny motyw", "do pełnego słońca", "theme", Cfg.theme == 1, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Telefon (Enzo, dane na żywo)", linkSub(), "phone", Cfg.phoneLink, {}));
        if (getRide().course != null) { m.addItem(new WatchUi.ToggleMenuItem("Nawigacja po trasie", getRide().course.name, "nav", Cfg.navOn, {})); }
        m.addItem(item("Ekrany jazdy", "które strony przewijać", "screens"));
        m.addItem(item("Pola danych: strona 1", null, "fields0"));
        m.addItem(item("Pola danych: strona 2", null, "fields1"));
        if (Cfg.paired()) { m.addItem(item("Odłącz konto VeloIQ", Cfg.athlete, "unpair")); }
        return m;
    }

    //! Ekrany jazdy – domyślnie tylko najważniejsze (TRENING, wykres planu, pola danych, okrążenia, trasa);
    //! resztę można dołożyć tutaj.
    function screens() as WatchUi.Menu2 {
        var m = new WatchUi.Menu2({ :title => "Ekrany jazdy" });
        m.addItem(new WatchUi.ToggleMenuItem("Wykres treningu", "moc na tle planu", "pgChart", Cfg.pgChart, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Druga strona pól", "pola danych 2", "pgF2", Cfg.pgF2, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Podjazd", "profil na trasie", "pgClimb", Cfg.pgClimb, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Wysiłek", "rezerwa W', strefy", "pgEffort", Cfg.pgEffort, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Paliwo", "węglowodany, picie", "pgFuel", Cfg.pgFuel, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Enzo", "historia komunikatów", "pgEnzo", Cfg.pgEnzo, {}));
        m.addItem(new WatchUi.ToggleMenuItem("Kolorowe krawędzie", "zgodność z celem", "edges", Cfg.edges, {}));
        return m;
    }

    //! MENU w trakcie jazdy: sterowanie jazdą. Enzo, jedzenie i prowadzenie są pod przyciskiem ENZO
    //! (tu „Enzo…” – dla liczników bez ekranu dotykowego).
    function ride(scr) as WatchUi.Menu2 {
        var r = getRide();
        var e = r.eng;
        var m = new WatchUi.Menu2({ :title => "Jazda" });
        m.addItem(item(r.state == RideState.PAUSED ? "Wznów" : "Pauza", null, "pause"));
        if (e != null && e.phase != Phase.FREE) {
            m.addItem(item((e.phase == Phase.ARMED || e.phase == Phase.WAITING) ? "Start interwału teraz" : "Następny lap", null, "next"));
            if (e.falseStartLeft() > 0) { m.addItem(item("Falstart", "nie licz tego startu", "falstart")); }
        } else {
            m.addItem(item("Okrążenie", null, "lap"));
        }
        m.addItem(item("Enzo...", "pytania, jedzenie, prowadzenie", "enzo"));
        if (r.nav != null) { m.addItem(item(r.nav.enabled ? "Wyłącz nawigację" : "Włącz nawigację", r.nav.course.name, "navtoggle")); }
        if (scr.pageId() == Pg.F1 || scr.pageId() == Pg.F2) { m.addItem(item("Pola danych tej strony", null, "fields")); }
        m.addItem(item("Zakończ jazdę", "zapisz albo odrzuć", "end"));
        return m;
    }

    //! Przycisk ENZO: rozmowa, gotowe pytania, jedzenie i picie, prowadzenie do miejsc, zmiany planu –
    //! to samo, co komendy głosowe przez telefon (id pozycji = komenda dla Ride.onPhoneCommand).
    function enzo() as WatchUi.Menu2 {
        var r = getRide();
        var e = r.eng;
        var m = new WatchUi.Menu2({ :title => "Enzo" });
        if (r.link.active) { m.addItem(item("Mów do Enzo", "głos przez telefon", "talk")); }
        m.addItem(item("Zapytaj Enzo", "odpowiedź na ekranie", "ask"));
        m.addItem(item("Zjadłem żel", "+25 g węglowodanów", "eat:25"));
        m.addItem(item("Zjadłem baton", "+40 g węglowodanów", "eat:40"));
        m.addItem(item("Wypiłem", null, "drink"));
        if (!Cfg.indoor) { m.addItem(item("Prowadź do...", "kawiarnia, woda, serwis, start", "go")); }
        if (e != null && e.phase != Phase.FREE) { m.addItem(item("Zmień plan", "dłużej, krócej, mocniej", "plan")); }
        return m;
    }

    //! Prowadzenie: dojazd profilem roweru (BRouter przez VeloIQ), trasa trafia na licznik w trakcie jazdy.
    function goTo() as WatchUi.Menu2 {
        var r = getRide();
        var m = new WatchUi.Menu2({ :title => "Prowadź do" });
        m.addItem(item("Najbliższa kawiarnia", null, "route:poi:cafe"));
        m.addItem(item("Najbliższa woda", "źródło, kran, sklep", "route:poi:water"));
        m.addItem(item("Najbliższy serwis", "sklep rowerowy", "route:poi:bike"));
        if (r.nav != null) { m.addItem(item("Wróć na trasę", r.nav.course.name, "route:rejoin")); }
        m.addItem(item("Do startu", "trasa z powrotem", "route:start"));
        return m;
    }

    //! Zmiany planu w trakcie jazdy – to samo, co komendy głosowe przez telefon („dodaj minutę”, „mocniej o 5%”…).
    function planEdits() as WatchUi.Menu2 {
        var e = getRide().eng;
        var m = new WatchUi.Menu2({ :title => "Zmień plan" });
        m.addItem(item("Krok +1 min", null, "extend:60"));
        m.addItem(item("Krok -1 min", null, "extend:-60"));
        m.addItem(item("Cele mocy +5%", e != null && e.bias != 0 ? "teraz " + e.bias + "%" : null, "bias:+5"));
        m.addItem(item("Cele mocy -5%", null, "bias:-5"));
        if (e != null && e.bias != 0) { m.addItem(item("Cele jak w planie", null, "bias:0")); }
        m.addItem(item("Jeszcze jeden interwał", null, "repeat"));
        return m;
    }

    function pause() as WatchUi.Menu2 {
        var m = new WatchUi.Menu2({ :title => "Pauza" });
        m.addItem(item("Wznów", null, "resume"));
        m.addItem(item("Zapisz jazdę", "FIT + wysyłka do VeloIQ", "save"));
        m.addItem(item("Odrzuć jazdę", "bez zapisu", "discard"));
        return m;
    }

    function questions() as WatchUi.Menu2 {
        var m = new WatchUi.Menu2({ :title => "Zapytaj Enzo" });
        m.addItem(item("Jak mi idzie?", null, "Jak mi idzie? Oceń krótko moc i tętno."));
        m.addItem(item("Co teraz i co dalej?", null, "Co mam teraz robić i co będzie dalej?"));
        m.addItem(item("Ile do końca?", null, "Ile zostało do końca kroku i całego treningu?"));
        m.addItem(item("Jeść albo pić?", null, "Czy powinienem teraz jeść albo pić?"));
        m.addItem(item("Ciężko, odpuścić?", null, "Jest mi ciężko. Odpuścić czy trzymać?"));
        m.addItem(item("Daj mi kopa!", null, "Zmotywuj mnie krótko, opierając się na moich danych."));
        return m;
    }

    function workouts() as WatchUi.Menu2 {
        var m = new WatchUi.Menu2({ :title => "Trening" });
        var list = getRide().workoutList();
        for (var i = 0; i < list.size(); i++) {
            m.addItem(item(list[i][1], list[i][2], list[i][0]));
        }
        if (list.size() == 0) { m.addItem(item("Brak treningów", "zsynchronizuj plan", "")); }
        return m;
    }

    function fields(pageIdx as Number) as WatchUi.Menu2 {
        var ids = Fields.pages()[pageIdx];
        var m = new WatchUi.Menu2({ :title => "Pola, strona " + (pageIdx + 1) });
        m.addItem(item("Liczba pól", "" + ids.size() + " (zmień)", "count"));
        for (var i = 0; i < ids.size(); i++) {
            m.addItem(item("Pole " + (i + 1), Fields.label(ids[i]), "f" + i));
        }
        return m;
    }

    function fieldChoice() as WatchUi.Menu2 {
        var m = new WatchUi.Menu2({ :title => "Wybierz pole" });
        for (var i = 0; i < Fields.COUNT; i++) {
            m.addItem(item(Fields.label(i), null, "" + i));
        }
        return m;
    }
}

class HomeMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _scr;

    function initialize(scr) {
        Menu2InputDelegate.initialize();
        _scr = scr;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        var r = getRide();
        if (id.equals("sync")) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            _scr.flash("Synchronizuję...");
            r.sync(_scr);
        } else if (id.equals("pick")) {
            WatchUi.pushView(Menus.workouts(), new WorkoutMenuDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id.equals("pair")) {
            var v = new PairView(_scr);
            WatchUi.switchToView(v, new PairDelegate(v), WatchUi.SLIDE_LEFT);
        } else if (id.equals("dropck")) {
            r.clearCheckpoint();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            _scr.flash("Przerwana jazda odrzucona");
        } else if (id.equals("mode")) {
            Menus.setIndoor(!Cfg.indoor);
            item.setLabel(Menus.modeLabel());
            item.setSubLabel(Menus.modeSub());
            WatchUi.requestUpdate();
        } else if (id.equals("settings")) {
            WatchUi.pushView(Menus.settings(), new SettingsMenuDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id.equals("upload")) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            r.up.kick();
            _scr.flash(r.up.running() ? "Wysyłam..." : "Brak połączenia");
        }
    }
}

class WorkoutMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        if (id.length() > 0) {
            Cfg.save("pick", id);
            getRide().loadPlan();
        }
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

class SettingsMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        if (id.equals("ftp")) {
            var v = new FtpView();
            WatchUi.pushView(v, new FtpDelegate(v), WatchUi.SLIDE_LEFT);
        } else if (id.equals("autolap")) {
            // kolejno: wysiłki → 5 km → 10 km → 10 min → wyłączony
            if (Cfg.autoLapMode == 3) { Cfg.put("autoLapKm", 5); Cfg.save("autoLapMode", 1); }
            else if (Cfg.autoLapMode == 1 && Cfg.autoLapKm == 5) { Cfg.save("autoLapKm", 10); }
            else if (Cfg.autoLapMode == 1) { Cfg.put("autoLapMin", 10); Cfg.save("autoLapMode", 2); }
            else if (Cfg.autoLapMode == 2) { Cfg.save("autoLapMode", 0); }
            else { Cfg.save("autoLapMode", 3); }
            item.setSubLabel(Menus.autoLapLabel());
            WatchUi.requestUpdate();
        } else if (id.equals("autopause")) { Cfg.save("autoPause", (item as WatchUi.ToggleMenuItem).isEnabled()); }
        else if (id.equals("tones")) { Cfg.save("tones", (item as WatchUi.ToggleMenuItem).isEnabled()); }
        else if (id.equals("theme")) { Cfg.save("theme", (item as WatchUi.ToggleMenuItem).isEnabled() ? 1 : 0); Th.apply(Cfg.theme); }
        else if (id.equals("phone")) {
            Cfg.save("link", (item as WatchUi.ToggleMenuItem).isEnabled());
            var r = getRide();
            if (Cfg.phoneLink) { r.link.event(r.hiMsg()); }     // sygnał do telefonu – aplikacja VeloIQ odpowie
            item.setSubLabel(Menus.linkSub());
            WatchUi.requestUpdate();
        }
        else if (id.equals("nav")) { Cfg.save("navOn", (item as WatchUi.ToggleMenuItem).isEnabled()); }
        else if (id.equals("screens")) { WatchUi.pushView(Menus.screens(), new SettingsMenuDelegate(), WatchUi.SLIDE_LEFT); }
        else if (id.equals("pgChart") || id.equals("pgF2") || id.equals("pgEffort") || id.equals("pgFuel") || id.equals("pgClimb")
            || id.equals("pgEnzo") || id.equals("edges")) {
            Cfg.save(id, (item as WatchUi.ToggleMenuItem).isEnabled());
        }
        else if (id.equals("unpair")) {
            WatchUi.pushView(new WatchUi.Confirmation("Odłączyć konto VeloIQ?"), new UnpairConfirm(), WatchUi.SLIDE_IMMEDIATE);
        }
        else if (id.equals("fields0")) { WatchUi.pushView(Menus.fields(0), new FieldsMenuDelegate(0), WatchUi.SLIDE_LEFT); }
        else if (id.equals("fields1")) { WatchUi.pushView(Menus.fields(1), new FieldsMenuDelegate(1), WatchUi.SLIDE_LEFT); }
    }
}

class FieldsMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _page as Number;

    function initialize(pageIdx as Number) {
        Menu2InputDelegate.initialize();
        _page = pageIdx;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        var pages = Fields.pages();
        if (id.equals("count")) {
            // 4 → 6 → 8 → 10 → 4; nowe pola dostają kolejne nieużyte typy
            var cur = pages[_page];
            var want = cur.size() >= 10 ? 4 : (cur.size() < 4 ? 4 : cur.size() + 2);
            var next = [];
            for (var i = 0; i < want; i++) {
                if (i < cur.size()) { next.add(cur[i]); }
                else {
                    var pick = 0;
                    for (var c = 0; c < Fields.COUNT; c++) {
                        if (next.indexOf(c) < 0) { pick = c; break; }
                    }
                    next.add(pick);
                }
            }
            pages[_page] = next;
            Cfg.save("pages", pages);
            WatchUi.switchToView(Menus.fields(_page), new FieldsMenuDelegate(_page), WatchUi.SLIDE_IMMEDIATE);
        } else {
            var slot = id.substring(1, id.length()).toNumber();
            WatchUi.pushView(Menus.fieldChoice(), new FieldChoiceDelegate(_page, slot), WatchUi.SLIDE_LEFT);
        }
    }
}

class FieldChoiceDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _page as Number;
    hidden var _slot as Number;

    function initialize(pageIdx as Number, slot as Number) {
        Menu2InputDelegate.initialize();
        _page = pageIdx;
        _slot = slot;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var field = item.getId().toString().toNumber();
        var pages = Fields.pages();
        if (field != null && _slot < pages[_page].size()) {
            pages[_page][_slot] = field;
            Cfg.save("pages", pages);
        }
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        WatchUi.switchToView(Menus.fields(_page), new FieldsMenuDelegate(_page), WatchUi.SLIDE_IMMEDIATE);
    }
}

class RideMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _scr;

    function initialize(scr) {
        Menu2InputDelegate.initialize();
        _scr = scr;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        var r = getRide();
        if (id.equals("fields")) {
            var fi = _scr.pageId() == Pg.F2 ? 1 : 0;
            WatchUi.switchToView(Menus.fields(fi), new FieldsMenuDelegate(fi), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id.equals("end")) {
            r.pause();
            WatchUi.switchToView(Menus.pause(), new PauseMenuDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id.equals("enzo")) {
            WatchUi.switchToView(Menus.enzo(), new EnzoMenuDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id.equals("falstart")) { if (r.eng != null) { r.eng.cancelStart(); } }
        else if (id.equals("next") || id.equals("lap")) { r.lapButton(); }
        else if (id.equals("navtoggle")) {
            if (r.nav != null) { r.setNav(!r.nav.enabled); r.showBanner(r.nav.enabled ? "Nawigacja włączona" : "Nawigacja wyłączona", "info", 3); }
        }
        else if (id.equals("pause")) { r.togglePause(); }
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

class EnzoMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        var r = getRide();
        if (id.equals("ask")) {
            WatchUi.switchToView(Menus.questions(), new QuestionMenuDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id.equals("plan")) {
            WatchUi.switchToView(Menus.planEdits(), new PlanEditDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id.equals("go")) {
            WatchUi.switchToView(Menus.goTo(), new GoMenuDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (id.equals("talk")) { r.talkToPhone(); }
        else { r.onPhoneCommand(id); }       // ta sama ścieżka co polecenie głosowe z telefonu
    }
}

//! „Prowadź do…”: wybór miejsca → ta sama komenda co głosem przez telefon.
class GoMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        getRide().onPhoneCommand(item.getId().toString());
    }
}

class UnpairConfirm extends WatchUi.ConfirmationDelegate {
    function initialize() { ConfirmationDelegate.initialize(); }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            Cfg.unpair();
            getRide().pairing.cancel();
            getRide().link.event(getRide().hiMsg());
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);   // ustawienia pod potwierdzeniem (jak przy odrzuceniu jazdy)
        }
        return true;
    }
}

class QuestionMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var r = getRide();
        r.askEnzo(item.getId().toString());
        if (r.enzoBusy) { r.showBanner("Enzo myśli...", "enzo", 8); }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

class DiscardConfirm extends WatchUi.ConfirmationDelegate {
    function initialize() { ConfirmationDelegate.initialize(); }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            getRide().finish(false);
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);   // menu pauzy pod potwierdzeniem
        }
        return true;
    }
}

class PauseMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId().toString();
        var r = getRide();
        if (id.equals("resume")) {
            r.resume();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else if (id.equals("save")) {
            r.finish(true);
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else if (id.equals("discard")) {
            WatchUi.pushView(new WatchUi.Confirmation("Odrzucić jazdę?"), new DiscardConfirm(), WatchUi.SLIDE_IMMEDIATE);
        }
    }
}

class PlanEditDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        getRide().planEdit(item.getId().toString());
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
