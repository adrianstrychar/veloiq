// PLIK GENEROWANY – nie edytuj ręcznie. Źródło: garmin/ci/parity/gen.ts (silnik referencyjny lib/ride/flex-engine.ts).
import Toybox.Lang;
import Toybox.Test;

(:test)
function testParityThreshold2x8(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        300,
        [["Rozgrzewka", 0, 300, 150, 195, 0, 0, 0, 0, 0],
         ["Interwał 1", 1, 480, 290, 310, 0, 0, 0, 0, 0],
         ["Przerwa", 2, 240, 120, 180, 0, 0, 0, 0, 132],
         ["Interwał 2", 1, 480, 290, 310, 0, 0, 0, 0, 0],
         ["Schłodzenie", 4, 300, 135, 165, 0, 0, 0, 0, 0]],
        [[320, 170, 88, 120, 1], [480, 301, 92, 165, 1], [200, 140, 85, 128, 1], [480, 336, 94, 172, 1], [310, 145, 80, 125, 1]],
        []],
        [0, "warmupStart", 239, "armNext", 289, "tenSec", 296, "count", 297, "count", 298, "count", 299, "goNow", 325, "autoStart", 468, "praise", 559, "half", 739, "lastMinute", 799, "seriesEnd", 799, "recoveryStart", 979, "armNext", 1005, "autoStart", 1073, "tooHigh", 1239, "half", 1313, "tooHigh", 1419, "lastMinute", 1479, "seriesEnd", 1479, "cooldownStart", 1779, "planDone"],
        [[1, 480, 480, 301, 100, 320, 0, 0, 0, 320, 165],
         [2, 480, 480, 336, 0, 1000, 1, 26, 0, 200, 172]],
        [],
        [0, "warmup", 320, "interval", 800, "recovery", 1000, "interval", 1480, "cooldown", 1780, "free"],
        [1790, 242, 277, 433, 50, 148, 172]);
}

(:test)
function testParityFalstartAutoPause(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        300,
        [["Rozgrzewka", 0, 240, 150, 195, 0, 0, 0, 0, 0],
         ["Interwał 1", 1, 300, 285, 315, 0, 0, 0, 0, 0],
         ["Przerwa", 2, 180, 120, 180, 0, 0, 0, 0, 0],
         ["Interwał 2", 1, 300, 285, 315, 0, 0, 0, 0, 0],
         ["Schłodzenie", 4, 120, 135, 165, 0, 0, 0, 0, 0]],
        [[200, 165, 88, 118, 1], [9, 320, 95, 130, 0], [22, 0, 0, 128, 0], [40, 150, 85, 122, 1], [150, 300, 92, 160, 1], [12, 0, 0, 150, 0], [152, 302, 92, 166, 1], [185, 140, 84, 130, 1], [305, 298, 91, 168, 1], [130, 150, 80, 128, 1]],
        []],
        [0, "warmupStart", 179, "armNext", 205, "autoStart", 213, "autoPause", 223, "falseStart", 229, "tenSec", 236, "count", 237, "count", 238, "count", 239, "goNow", 276, "autoStart", 409, "praise", 420, "half", 425, "autoPause", 434, "autoResume", 522, "lastMinute", 582, "seriesEnd", 582, "recoveryStart", 702, "armNext", 752, "tenSec", 759, "count", 760, "count", 761, "count", 762, "goNow", 775, "autoStart", 908, "praise", 919, "half", 1009, "lastMinute", 1069, "seriesEnd", 1069, "cooldownStart", 1189, "planDone"],
        [[1, 300, 300, 301, 100, 271, 0, 0, 0, 271, 163],
         [2, 300, 300, 298, 100, 770, 0, 0, 0, 187, 168]],
        [],
        [0, "warmup", 271, "interval", 583, "recovery", 770, "interval", 1070, "cooldown", 1190, "free"],
        [1205, 223, 254, 269, 100, 146, 168]);
}

(:test)
function testParityEarlyStopSkip(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        280,
        [["Rozgrzewka", 0, 180, 140, 180, 0, 0, 0, 0, 0],
         ["Interwał 1", 1, 360, 270, 290, 0, 0, 0, 0, 0],
         ["Przerwa", 2, 180, 110, 170, 0, 0, 0, 0, 0],
         ["Interwał 2", 1, 360, 270, 290, 0, 0, 0, 0, 0],
         ["Przerwa", 2, 180, 110, 170, 0, 0, 0, 0, 0],
         ["Interwał 3", 1, 360, 270, 290, 0, 0, 0, 0, 0],
         ["Schłodzenie", 4, 180, 125, 155, 0, 0, 0, 0, 0]],
        [[190, 160, 86, 115, 1], [200, 281, 90, 160, 1], [120, 120, 80, 140, 1], [130, 130, 82, 132, 1], [365, 262, 89, 163, 1], [100, 135, 82, 135, 1], [200, 280, 90, 165, 1], [300, 140, 80, 130, 1]],
        [1150, 1, 1360, 1]],
        [0, "warmupStart", 119, "armNext", 169, "tenSec", 176, "count", 177, "count", 178, "count", 179, "goNow", 195, "autoStart", 338, "praise", 369, "half", 436, "earlyStop", 436, "seriesEnd", 436, "recoveryStart", 516, "armNext", 566, "tenSec", 573, "count", 574, "count", 575, "count", 576, "goNow", 645, "autoStart", 819, "half", 939, "lastMinute", 999, "seriesEnd", 999, "recoveryStart", 1119, "armNext", 1125, "autoStart", 1150, "seriesEnd", 1150, "cooldownStart", 1194, "recoveryTooHigh", 1330, "planDone"],
        [[1, 207, 360, 276, 99, 190, 0, 0, 1, 190, 159],
         [2, 360, 360, 262, 100, 640, 2, 8, 0, 243, 163],
         [3, 31, 360, 280, 100, 1120, 0, 0, 0, 120, 165]],
        [],
        [0, "warmup", 190, "interval", 397, "recovery", 640, "interval", 1000, "recovery", 1120, "interval", 1151, "cooldown", 1331, "free"],
        [1605, 203, 229, 325, 99, 145, 165]);
}

(:test)
function testParityOverUnder(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        300,
        [["Rozgrzewka", 0, 120, 150, 195, 0, 0, 0, 0, 0],
         ["Under 1.1", 1, 120, 276, 294, 85, 95, 0, 0, 0],
         ["Over 1.1", 1, 60, 306, 324, 85, 95, 2, 0, 0],
         ["Under 1.2", 1, 120, 276, 294, 85, 95, 2, 0, 0],
         ["Over 1.2", 1, 60, 306, 324, 85, 95, 2, 0, 0],
         ["Przerwa", 2, 120, 120, 180, 0, 0, 0, 0, 0],
         ["Under 2.1", 1, 120, 276, 294, 0, 0, 0, 0, 0],
         ["Over 2.1", 1, 60, 306, 324, 0, 0, 2, 0, 0],
         ["Schłodzenie", 4, 120, 135, 165, 0, 0, 0, 0, 0]],
        [[125, 170, 88, 120, 1], [120, 285, 78, 150, 1], [60, 316, 78, 160, 1], [120, 284, 90, 158, 1], [60, 315, 92, 166, 1], [70, 150, 85, 140, 1], [10, 300, 90, 140, 0], [30, 150, 85, 138, 1], [20, 150, 85, 135, 1], [185, 290, 90, 160, 1], [140, 150, 80, 130, 1]],
        [564, 2]],
        [0, "warmupStart", 59, "armNext", 109, "tenSec", 116, "count", 117, "count", 118, "count", 119, "goNow", 130, "autoStart", 164, "cadenceLow", 184, "half", 214, "chainNext", 224, "cadenceLow", 241, "count", 242, "count", 243, "count", 244, "chainGo", 274, "chainNext", 284, "cadenceLow", 301, "count", 302, "count", 303, "count", 304, "chainGo", 364, "half", 394, "chainNext", 421, "count", 422, "count", 423, "count", 424, "chainGo", 484, "seriesEnd", 484, "recoveryStart", 544, "armNext", 560, "autoStart", 564, "falseStart", 594, "tenSec", 601, "count", 602, "count", 603, "count", 604, "goNow", 620, "autoStart", 674, "half", 704, "chainNext", 731, "count", 732, "count", 733, "count", 734, "chainGo", 769, "tooLow", 794, "seriesEnd", 794, "cooldownStart", 914, "planDone"],
        [[1, 120, 120, 285, 100, 125, 0, 0, 0, 125, 150],
         [1, 60, 60, 316, 100, 245, 0, 0, 0, 0, 160],
         [1, 120, 120, 284, 100, 305, 0, 0, 0, 0, 158],
         [1, 60, 60, 315, 100, 425, 0, 0, 0, 0, 166],
         [2, 120, 120, 290, 100, 615, 0, 0, 0, 130, 160],
         [2, 60, 60, 290, 0, 735, 2, 16, 0, 0, 160]],
        [],
        [0, "warmup", 125, "interval", 245, "interval", 305, "interval", 425, "interval", 485, "recovery", 615, "interval", 735, "interval", 795, "cooldown", 915, "free"],
        [940, 237, 260, 223, 88, 146, 166]);
}

(:test)
function testParitySteadyHrSprints(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        300,
        [["Rozgrzewka", 0, 300, 150, 195, 0, 0, 0, 0, 142],
         ["Endurance", 3, 1500, 195, 225, 0, 0, 2, 129, 149],
         ["Sprint 1", 1, 12, 600, 1100, 0, 0, 0, 0, 0],
         ["Przerwa", 2, 150, 120, 180, 0, 0, 0, 0, 132],
         ["Sprint 2", 1, 12, 600, 1100, 0, 0, 0, 0, 0],
         ["Schłodzenie", 4, 300, 135, 165, 0, 0, 0, 0, 136]],
        [[300, 172, 88, 125, 1], [600, 212, 88, 146, 1], [900, 214, 88, 156, 1], [40, 215, 88, 156, 1], [13, 820, 110, 160, 0], [140, 140, 80, 150, 1], [14, 790, 112, 165, 0], [320, 148, 80, 130, 1]],
        []],
        [0, "warmupStart", 299, "steadyStart", 899, "status", 978, "hrHigh", 1278, "hrHigh", 1499, "status", 1578, "hrHigh", 1739, "armNext", 1789, "tenSec", 1796, "count", 1797, "count", 1798, "count", 1799, "goNow", 1842, "autoStart", 1851, "seriesEnd", 1851, "recoveryStart", 1941, "armNext", 1991, "tenSec", 1995, "autoStart", 2004, "seriesEnd", 2004, "cooldownStart", 2304, "planDone"],
        [[1, 12, 12, 820, 0, 1840, 0, 0, 0, 1540, 160],
         [2, 12, 12, 790, 0, 1993, 0, 0, 0, 141, 165]],
        [],
        [0, "warmup", 300, "steady", 1840, "interval", 1852, "recovery", 1993, "interval", 2005, "cooldown", 2305, "free"],
        [2327, 201, 223, 468, 0, 146, 165]);
}

(:test)
function testParityFreeRideEfforts(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        300,
        [],
        [[300, 180, 85, 120, 1], [140, 305, 90, 160, 1], [20, 235, 88, 162, 1], [100, 300, 90, 166, 1], [180, 150, 80, 135, 1], [50, 340, 95, 150, 1], [200, 160, 82, 132, 1], [400, 290, 90, 165, 1], [70, 60, 0, 140, 0], [30, 0, 0, 120, 0], [260, 200, 85, 130, 1], [150, 310, 92, 168, 1]],
        []],
        [0, "freeStart", 621, "effort", 1444, "effort", 1445, "drink"],
        [],
        [[300, 260, 298], [990, 400, 290], [1750, 150, 310]],
        [],
        [1900, 224, 251, 426, 0, 145, 168]);
}

(:test)
function testParityNoSensorsWaiting(logger as Test.Logger) as Boolean {
    return ParityRun.check(logger, [
        250,
        [["Rozgrzewka", 0, 200, 125, 160, 0, 0, 0, 0, 0],
         ["Interwał 1", 1, 240, 240, 260, 0, 0, 0, 0, 0],
         ["Przerwa", 2, 120, 100, 150, 0, 0, 0, 0, 0],
         ["Interwał 2", 1, 240, 240, 260, 0, 0, 0, 0, 0]],
        [[195, 140, -1, 0, 1], [245, 251, -1, 0, 1], [400, 110, -1, 0, 1], [240, 250, -1, 0, 1], [100, 120, -1, 0, 1], [200, 245, -1, 0, 1], [120, 100, -1, 0, 1]],
        []],
        [0, "warmupStart", 139, "armNext", 189, "tenSec", 196, "count", 197, "count", 198, "count", 199, "goNow", 200, "autoStart", 314, "half", 323, "praise", 374, "lastMinute", 434, "seriesEnd", 434, "recoveryStart", 494, "armNext", 544, "tenSec", 551, "count", 552, "count", 553, "count", 554, "goNow", 674, "waiting", 794, "waiting", 845, "autoStart", 959, "half", 968, "praise", 1019, "lastMinute", 1079, "seriesEnd", 1079, "planDone", 1438, "effort"],
        [[1, 240, 240, 251, 100, 195, 0, 0, 0, 195, -1],
         [2, 240, 240, 250, 100, 840, 0, 0, 0, 405, -1]],
        [[1180, 200, 245]],
        [0, "warmup", 195, "interval", 435, "recovery", 840, "interval", 1080, "free"],
        [1500, 177, 207, 265, 100, 0, 0]);
}
