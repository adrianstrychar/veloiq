import Toybox.Lang;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.System;

//! Czujniki sparowane z Edge (ANT+ / BLE – moc, tętno, kadencja, prędkość) oraz GPS.
//! Aplikacja nie paruje czujników sama: korzysta z tych, które są dodane w ustawieniach licznika.
class SensorHub {
    var power = null;       // W
    var hr = null;          // bpm
    var cad = null;         // rpm
    var speed = null;       // m/s (czujnik prędkości albo GPS)
    var alt = null;         // m
    var temp = null;        // °C
    var lat = null;         // stopnie
    var lon = null;
    var gpsQuality as Number = 0;
    hidden var _powerAt as Number = 0;
    hidden var _hrAt as Number = 0;
    hidden var _cadAt as Number = 0;
    hidden var _fixAt as Number = 0;
    hidden var _on as Boolean = false;

    function initialize() {}

    function start(withGps as Boolean) as Void {
        if (_on) { return; }
        _on = true;
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE, Sensor.SENSOR_BIKEPOWER, Sensor.SENSOR_BIKECADENCE,
            Sensor.SENSOR_BIKESPEED, Sensor.SENSOR_TEMPERATURE] as Array<Sensor.SensorType>);
        Sensor.enableSensorEvents(method(:onSensor));
        if (withGps) {
            Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        }
    }

    function stop() as Void {
        if (!_on) { return; }
        _on = false;
        Sensor.enableSensorEvents(null);
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
    }

    function onSensor(info as Sensor.Info) as Void {
        var now = System.getTimer();
        if (info.power != null) { power = info.power; _powerAt = now; }
        if (info.heartRate != null) { hr = info.heartRate; _hrAt = now; }
        if (info.cadence != null) { cad = info.cadence; _cadAt = now; }
        speed = info.speed;
        if (info.altitude != null) { alt = info.altitude; }
        if (info.temperature != null) { temp = info.temperature; }
        // czujnik zamilkł (bateria, zasięg) → po 5 s brak danych zamiast zamrożonej wartości
        if (power != null && now - _powerAt > 5000) { power = null; }
        if (hr != null && now - _hrAt > 8000) { hr = null; }
        if (cad != null && now - _cadAt > 5000) { cad = null; }
    }

    function onPosition(info as Position.Info) as Void {
        gpsQuality = info.accuracy;
        if (info.position != null && info.accuracy >= Position.QUALITY_POOR) {
            var d = info.position.toDegrees();
            lat = d[0];
            lon = d[1];
            _fixAt = System.getTimer();
        }
        if (info.altitude != null && alt == null) { alt = info.altitude; }
        if (speed == null && info.speed != null) { speed = info.speed; }
    }

    function hasPower() as Boolean { return power != null; }
    function hasHr() as Boolean { return hr != null; }
    function hasGps() as Boolean {
        return lat != null && gpsQuality >= Position.QUALITY_POOR && System.getTimer() - _fixAt < 10000;
    }
}
