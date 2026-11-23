import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
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

    function onUpdate(dc as Graphics.Dc) as Void {
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
        var xy = evt.getCoordinates();
        _v.current().tap(xy[0], xy[1]);
        WatchUi.requestUpdate();
        return true;
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
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
        _v.current().menu();
        return true;
    }

    function onBack() as Boolean {
        var r = getRide();
        if (r.state == RideState.IDLE) { return false; }            // ekran startowy: wyjście z aplikacji
        if (r.state == RideState.DONE) { r.reset(); WatchUi.requestUpdate(); return true; }
        _v.rideScr.menu();                                          // w trakcie jazdy „wstecz” nie zamyka aplikacji
        return true;
    }
}
