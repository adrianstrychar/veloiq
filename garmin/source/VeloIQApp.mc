import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Test;

class BootView extends WatchUi.View {
    function initialize() { View.initialize(); }
    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_LARGE, "VeloIQ", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class VeloIQApp extends Application.AppBase {
    function initialize() { AppBase.initialize(); }
    function getInitialView() as [Views] or [Views, InputDelegates] { return [ new BootView() ]; }
}

(:test)
function testBoot(logger as Test.Logger) as Boolean {
    logger.debug("pipeline ok");
    return true;
}
