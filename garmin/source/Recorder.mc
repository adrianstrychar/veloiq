import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Lang;

//! Nagrywanie aktywności w formacie FIT (historia Edge → Garmin Connect → Strava) razem z polami
//! VeloIQ: cel mocy i W'bal w każdej sekundzie, cel i rodzaj kroku na lapach, NP/TSS/IF/zgodność w podsumowaniu.
class Recorder {
    hidden var _session = null;
    hidden var _fTarget = null;
    hidden var _fWbal = null;
    hidden var _fLapTarget = null;
    hidden var _fLapType = null;
    hidden var _fNp = null;
    hidden var _fTss = null;
    hidden var _fIf = null;
    hidden var _fCompl = null;
    var laps as Number = 0;

    function initialize() {}

    function active() as Boolean { return _session != null; }
    function recording() as Boolean { return _session != null && _session.isRecording(); }

    function start(name as String, indoor as Boolean) as Boolean {
        if (_session != null) { return true; }
        try {
            _session = ActivityRecording.createSession({
                :name => name,
                :sport => Activity.SPORT_CYCLING,
                :subSport => (indoor ? Activity.SUB_SPORT_INDOOR_CYCLING : Activity.SUB_SPORT_GENERIC)
            });
        } catch (ex) {
            _session = null;
        }
        if (_session == null) { return false; }
        try {
            _fTarget = _session.createField("vq_target", 0, FitContributor.DATA_TYPE_UINT16,
                { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "W" });
            _fWbal = _session.createField("vq_wbal", 1, FitContributor.DATA_TYPE_FLOAT,
                { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "kJ" });
            _fLapTarget = _session.createField("vq_lap_target", 10, FitContributor.DATA_TYPE_UINT16,
                { :mesgType => FitContributor.MESG_TYPE_LAP, :units => "W" });
            _fLapType = _session.createField("vq_lap_type", 11, FitContributor.DATA_TYPE_UINT8,
                { :mesgType => FitContributor.MESG_TYPE_LAP });
            _fNp = _session.createField("vq_np", 20, FitContributor.DATA_TYPE_UINT16,
                { :mesgType => FitContributor.MESG_TYPE_SESSION, :units => "W" });
            _fTss = _session.createField("vq_tss", 21, FitContributor.DATA_TYPE_UINT16,
                { :mesgType => FitContributor.MESG_TYPE_SESSION });
            _fIf = _session.createField("vq_if", 22, FitContributor.DATA_TYPE_FLOAT,
                { :mesgType => FitContributor.MESG_TYPE_SESSION });
            _fCompl = _session.createField("vq_compliance", 23, FitContributor.DATA_TYPE_UINT8,
                { :mesgType => FitContributor.MESG_TYPE_SESSION, :units => "%" });
        } catch (ex2) {
            // pola dodatkowe nie są warunkiem nagrywania
        }
        return _session.start();
    }

    function pause() as Void {
        if (_session != null && _session.isRecording()) { _session.stop(); }
    }

    function resume() as Void {
        if (_session != null && !_session.isRecording()) { _session.start(); }
    }

    //! Co sekundę: cel mocy kroku (środek zakresu, 0 = brak) i W'bal.
    function record(targetW as Number, wbalKj as Float) as Void {
        if (_fTarget != null) { _fTarget.setData(targetW); }
        if (_fWbal != null) { _fWbal.setData(wbalKj); }
    }

    //! Zamyka bieżący lap. Cel i rodzaj dotyczą lapa, który się KOŃCZY.
    function lap(targetW as Number, stepType as Number) as Void {
        if (_session == null) { return; }
        if (_fLapTarget != null) { _fLapTarget.setData(targetW); }
        if (_fLapType != null) { _fLapType.setData(stepType); }
        if (_session.isRecording()) {
            _session.addLap();
            laps++;
        }
    }

    function finish(np as Number, tss as Number, intensity as Float, compliance as Number, lastTarget as Number, lastType as Number) as Boolean {
        if (_session == null) { return false; }
        if (_fNp != null) { _fNp.setData(np); }
        if (_fTss != null) { _fTss.setData(tss); }
        if (_fIf != null) { _fIf.setData(intensity); }
        if (_fCompl != null) { _fCompl.setData(compliance); }
        if (_fLapTarget != null) { _fLapTarget.setData(lastTarget); }
        if (_fLapType != null) { _fLapType.setData(lastType); }
        if (_session.isRecording()) { _session.stop(); }
        var ok = _session.save();
        _session = null;
        return ok;
    }

    function discard() as Void {
        if (_session == null) { return; }
        if (_session.isRecording()) { _session.stop(); }
        _session.discard();
        _session = null;
    }
}
