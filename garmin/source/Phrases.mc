import Toybox.Lang;

//! Komunikaty silnika w wersji NA EKRAN (krótkie, do przeczytania jednym spojrzeniem).
//! Klucze i zmienne są takie same jak w silniku telefonu (FLEX_PHRASES), więc telefon może
//! z tego samego zdarzenia złożyć pełną wypowiedź Enzo. "\n" = nowa linia na banerze.
module Phrases {

    function table() {
        return {
            "armNext" => "Za minutę interwał {n}/{total}\n{durS}, {low}-{high} W",
            "tenSec" => "10 sekund",
            "goNow" => "Możesz startować",
            "chainNext" => "Zaraz potem, bez przerwy\n{durS}, {low}-{high} W",
            "chainGo" => "Teraz!\n{low}-{high} W",
            "waiting" => "Czekam na start interwału {n}\nprzerwa trwa {restS}",
            "autoStart" => "START! {durS}\n{low}-{high} W",
            "restInfo" => "przerwa trwała {restS}",
            "autoPause" => "Pauza interwału\nzostało {leftS}",
            "autoResume" => "Wznawiam\nzostało {leftS}",
            "earlyStop" => "Interwał przerwany po {doneS}",
            "falseStart" => "Falstart, nie liczę\nInterwał {n} ruszy, gdy przyspieszysz",
            "seriesEnd" => "Seria {n}/{total}: {avg} W\n{verdict}",
            "seriesPrev" => "poprzednia {prev} W",
            "hrUp" => "tętno +{d} vs 1. seria",
            "intervalStart" => "Interwał {n}/{total}: START\n{durS}, {low}-{high} W",
            "recoveryStart" => "Przerwa {durS}\nluźno, poniżej {high} W",
            "warmupStart" => "Rozgrzewka {durS}\n{low}-{high} W",
            "steadyStart" => "{name} {durS}\n{low}-{high} W",
            "cooldownStart" => "Schłodzenie {durS}\nluźno, poniżej {high} W",
            "tooHigh" => "Za mocno\nodpuść {delta} W",
            "tooLow" => "Za słabo\ndodaj {delta} W",
            "recoveryTooHigh" => "To odpoczynek\nzejdź poniżej {high} W",
            "cadenceLow" => "Kadencja {cad}\npodnieś do {cadLow}",
            "cadenceHigh" => "Kadencja {cad}\nzejdź do {cadHigh}",
            "half" => "Połowa\nśrednio {avg} W",
            "lastMinute" => "Ostatnia minuta\ntrzymaj!",
            "praise" => "Idealnie\ntak trzymaj!",
            "planDone" => "Plan zrobiony!\nnagrywam dalej",
            "freeStart" => "Nagrywanie\njazda swobodna",
            "effort" => "Wysiłek {durS}\nśrednio {avg} W",
            "hrHigh" => "Tętno {hr}, powyżej zakresu\nzwolnij trochę",
            "hrRecovered" => "Tętno {hr}\njesteś gotowy",
            "status" => "Średnio {avg} W{hrTxt}",
            "readiness" => "Gotowość dziś {pct}%\n{state}",
            "condition" => "Kondycja dziś {sign}{n}",
            "count" => "{n}",
            "endCount" => "{n}",
            "drink" => "Pij!\nkilka łyków",
            "eat" => "Czas na jedzenie\nżel albo baton, popij"
        };
    }

    function verdictText(v as String) as String {
        if (v.equals("high")) { return "mocniej niż plan"; }
        if (v.equals("low")) { return "trochę poniżej planu"; }
        return "idealnie w zakresie";
    }
}
