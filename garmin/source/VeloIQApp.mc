import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! VeloIQ na Garmin Edge – aplikacja urządzenia: prowadzi trening z planu VeloIQ (silnik elastyczny jak
//! w telefonie), nagrywa jazdę do FIT, pokazuje własne pola danych, rozmawia z Enzo i wysyła jazdę do VeloIQ.
class VeloIQApp extends Application.AppBase {
    var ride as Ride;

    function initialize() {
        AppBase.initialize();
        ride = new Ride();
    }

    function onStart(state as Dictionary?) as Void {
        ride.boot();
    }

    function onStop(state as Dictionary?) as Void {
        ride.shutdown();
    }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        var v = new RootView();
        return [v, new RootDelegate(v)];
    }
}

//! Jeden widok na całą aplikację: rysuje ekran odpowiedni do stanu jazdy (start / jazda / podsumowanie).
//! Menu, parowanie i ustawienia są widokami nakładanymi na wierzch.
class RootView extends WatchUi.View {
    var home as HomeScreen;
    var rideScr as RideScreen;
    var summary as SummaryScreen;
    hidden var _lastState as Number = 0;
    var inputAt as Number = 0;          // ostatnie dotknięcie / przycisk na tym widoku (RootDelegate)
    hidden var _hiddenAt as Number = 0;
    hidden var _byUser as Boolean = false;

    function initialize() {
        View.initialize();
        home = new HomeScreen();
        rideScr = new RideScreen();
        summary = new SummaryScreen();
    }

    function current() {
        var st = getRide().state;
        if (st != _lastState) {
            if (st == RideState.RECORDING && _lastState == RideState.IDLE) { rideScr.page = 0; }
            _lastState = st;
        }
        if (st == RideState.IDLE) { return home; }
        if (st == RideState.DONE) { return summary; }
        return rideScr;
    }

    //! Zasłonięcie widoku: nasze menu (tuż po dotknięciu / przycisku) albo okno systemu (powiadomienie z telefonu,
    //! komunikat licznika) – to drugie pojawia się bez wejścia od zawodnika.
    function onHide() as Void {
        var now = System.getTimer();
        _hiddenAt = now;
        _byUser = now - inputAt < 1500;
    }

    function onShow() as Void {
        if (_hiddenAt > 0) {
            var gone = System.getTimer() - _hiddenAt;
            var r = getRide();
            if (!_byUser && gone >= 8000 && r.active()) { r.coveredBySystem(gone / 1000); }
            _hiddenAt = 0;
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var r = getRide();
        if (r.uiPage >= 0) { var pi = rideScr.indexOf(r.uiPage); rideScr.page = pi < 0 ? 0 : pi; r.uiPage = -1; }
        if (r.uiZoom >= 0) { rideScr.zoom = r.uiZoom; r.uiZoom = -1; }
        current().draw(dc);
    }
}

class RootDelegate extends WatchUi.BehaviorDelegate {
    hidden var _v as RootView;

    function initialize(v as RootView) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        _v.inputAt = System.getTimer();
        var xy = evt.getCoordinates();
        _v.current().tap(xy[0], xy[1]);
        WatchUi.requestUpdate();
        return true;
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        _v.inputAt = System.getTimer();
        var used = _v.current().key(evt.getKey());
        if (used) { WatchUi.requestUpdate(); }
        return used;
    }

    function onSwipe(evt as WatchUi.SwipeEvent) as Boolean {
        var d = evt.getDirection();
        if (d == WatchUi.SWIPE_LEFT) { _v.current().turn(1); return true; }
        if (d == WatchUi.SWIPE_RIGHT) { _v.current().turn(-1); return true; }
        return false;
    }

    function onNextPage() as Boolean {
        _v.current().turn(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        _v.current().turn(-1);
        return true;
    }

    function onMenu() as Boolean {
        _v.inputAt = System.getTimer();
        _v.current().menu();
        return true;
    }

    function onBack() as Boolean {
        _v.inputAt = System.getTimer();
        var r = getRide();
        if (r.state == RideState.IDLE) { return false; }            // ekran startowy: wyjście z aplikacji
        if (r.state == RideState.DONE) { r.reset(); WatchUi.requestUpdate(); return true; }
        _v.rideScr.menu();                                          // w trakcie jazdy „wstecz” nie zamyka aplikacji
        return true;
    }
}
