# Biblioteka głosu „Dyrektor Enzo”: emocjonalne wejścia (lead.*) + klipy z liczbami. Tekst fonetyczny (Forca, Brawissimo…).
import json
HOT, CALM, INFO = (1.5, 0.3, 0.9), (0.9, 0.4, 0.85), (0.8, 0.4, 0.8)

def num_pl(n):
    J = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć']
    N = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście']
    D = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt']
    S = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset']
    if n == 0: return 'zero'
    out = [S[n // 100]]; r = n % 100
    if 10 <= r < 20: out.append(N[r - 10])
    else: out += [D[r // 10], J[r % 10]]
    return ' '.join(w for w in out if w)
def fem(n):
    if n == 1: return 'jedna'
    t = num_pl(n)
    return t[:-3] + 'dwie' if n % 10 == 2 and n % 100 != 12 and t.endswith('dwa') else t
def few(n): return n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14)
def form(n, one, f, many): return one if n == 1 else f if few(n) else many
def ord_m(n): return ['', 'pierwszy', 'drugi', 'trzeci', 'czwarty', 'piąty', 'szósty', 'siódmy', 'ósmy', 'dziewiąty', 'dziesiąty', 'jedenasty', 'dwunasty'][n]
def gen_z(n): return ['', 'jednego', 'dwóch', 'trzech', 'czterech', 'pięciu', 'sześciu', 'siedmiu', 'ośmiu', 'dziewięciu', 'dziesięciu', 'jedenastu', 'dwunastu'][n]
def gen_num(n):  # dopełniacz: "od dwustu siedemdziesięciu pięciu"
    J = ['', 'jednego', 'dwóch', 'trzech', 'czterech', 'pięciu', 'sześciu', 'siedmiu', 'ośmiu', 'dziewięciu']
    N = ['dziesięciu', 'jedenastu', 'dwunastu', 'trzynastu', 'czternastu', 'piętnastu', 'szesnastu', 'siedemnastu', 'osiemnastu', 'dziewiętnastu']
    D = ['', '', 'dwudziestu', 'trzydziestu', 'czterdziestu', 'pięćdziesięciu', 'sześćdziesięciu', 'siedemdziesięciu', 'osiemdziesięciu', 'dziewięćdziesięciu']
    S = ['', 'stu', 'dwustu', 'trzystu', 'czterystu', 'pięciuset', 'sześciuset', 'siedmiuset', 'ośmiuset', 'dziewięciuset']
    out = [S[n // 100]]; r = n % 100
    if 10 <= r < 20: out.append(N[r - 10])
    else: out += [D[r // 10], J[r % 10]]
    return ' '.join(w for w in out if w)

LEADS = {
 'arm': ["Uwaga, kampione! Za minutę zaczynamy.", "Przygotuj się! Za minutę jedziemy.", "Pronto? Za minutę interwał. Łyk wody, ręce luźno.", "Słuchaj mnie. Za minutę zaczyna się robota."],
 'go': ["Jedziemy! Forca!", "Start! Ale, ale, ale!", "Teraz! Daj, daj, daj!", "Avanti, kampione! Jedziemy!", "Start! Pokaż mi, co masz!"],
 'warmup': ["Rozgrzewka. Spokojnie, kampione. Budujemy nogi.", "Zaczynamy rozgrzewkę. Bez pośpiechu, luźno.", "Rozgrzewka. Oddychaj, rozkręcaj się powoli."],
 'recovery': ["Przerwa. Kręć luźno. Oddychaj.", "Brawo. Teraz odpoczynek. Pij.", "Luźno, amiko. Odpoczywamy. Zaraz znowu."],
 'cooldown': ["Schłodzenie. Brawissimo, dzisiaj zrobione.", "Koniec roboty. Luźno do domu, kampione.", "Schłodzenie. Rozkręć nogi, oddychaj."],
 'steady': ["Równe tempo. Trzymaj rytm, kampione.", "Teraz tempo. Równo, jak w zegarku."],
 'ten': ["Dziesięć sekund! Przygotuj się!", "Dziesięć sekund! Ręce na kierownicę!"],
 'goNow': ["Możesz startować! Ruszaj, kiedy chcesz!", "Teraz! Ruszaj!"],
 'waiting': ["Czekam na ciebie, kampione. Ruszaj, kiedy będziesz gotowy.", "Spokojnie. Ja czekam. Ruszaj, jak będziesz gotowy."],
 'pause': ["Stoimy. Spokojnie, czekam.", "Pauza. Czerwone światło to też odpoczynek."],
 'resume': ["Jedziemy dalej! Forca!", "Wracamy do roboty! Ale!"],
 'early': ["Nie szkodzi. Zapisałem. Następnym razem dowieziesz.", "Dobrze. Odpoczynek. Głowa do góry, kampione."],
 'seriesEnd': ["Brawissimo! Seria zamknięta!", "Jest! Seria zrobiona! Pięknie!", "Bene, bene! Seria zamknięta!", "Tak się trenuje mistrzów! Seria zamknięta!"],
 'hr': ["Tętno idzie w górę. To normalne. Pij i oddychaj."],
 'tooHigh': ["Nie, nie, nie! Za mocno!", "Spokojnie, amiko! Za mocno!", "Hamuj, kampione! Za mocno!", "Głową, nie emocjami! Za mocno!"],
 'tooLow': ["Za słabo! Forca!", "Więcej, kampione! Więcej!", "Nie odpuszczaj! Za słabo!", "Daj, daj! Za słabo!"],
 'recTooHigh': ["To jest odpoczynek! Zejdź niżej!", "Spokojnie! Teraz odpoczywamy, nie ścigamy się!"],
 'cadLow': ["Kadencja! Kręć szybciej, kampione!", "Szybciej nogami! Lżej, szybciej!"],
 'cadHigh': ["Za szybko kręcisz! Spokojniej nogami!", "Wolniej nogami, mocniej w pedały!"],
 'half': ["Połowa za nami! Tak trzymaj!", "Pół drogi! Wyglądasz świetnie!", "Połowa! Teraz głową!"],
 'last': ["Ostatnia minuta! To jest ten moment! Wszystko, co masz!", "Ostatnia minuta! Daj, daj, daj, daj!", "Ostatnia minuta, kampione! Tu się wygrywa!"],
 'praise': ["Perfetto! Idealnie! Tak trzymaj!", "Brawissimo! Dokładnie tak!", "Pięknie, kampione! Idealnie w zakresie!"],
 'done': ["Plan zrobiony! Brawissimo, kampione! Dzisiaj byłeś mocny!", "Koniec planu! Jestem z ciebie dumny! Luźno do domu."],
 'free': ["Jedziemy! Nagrywam wszystko. Pokaż mi, co masz!"],
 'effort': ["Mocny wysiłek! Zapisałem!", "To był atak! Brawissimo!"],
 'powerLost': ["Nie widzę mocy! Sprawdź czujnik!"],
 'powerBack': ["Moc wróciła. Jedziemy dalej."],
 'hrLost': ["Nie widzę tętna. Sprawdź pas."],
 'hrBack': ["Tętno wróciło."],
}
items = []
for ev, arr in LEADS.items():
    hot = ev not in ('warmup', 'recovery', 'cooldown', 'waiting', 'pause', 'early', 'hr', 'powerBack', 'hrLost', 'hrBack', 'steady')
    for i, t in enumerate(arr):
        items.append(dict(id=f'lead.{ev}.{i}', text=t, p=HOT if hot else CALM, prio=0))
for d in range(5, 155, 5):
    items.append(dict(id=f'add.{d}', text=f'Dodaj {num_pl(d)} {form(d,"wat","waty","watów")}!', p=HOT, prio=1))
    items.append(dict(id=f'sub.{d}', text=f'Odpuść {num_pl(d)} {form(d,"wat","waty","watów")}!', p=HOT, prio=1))
for w in range(80, 605, 5):
    items.append(dict(id=f'w.{w}', text=f'{num_pl(w)} {form(w,"wat","waty","watów")}.', p=INFO, prio=2))
for m in list(range(1, 21)) + [25, 30, 35, 40, 45, 50, 60, 90]:
    items.append(dict(id=f'min.{m}', text=f'{fem(m)} {form(m,"minuta","minuty","minut")}.', p=INFO, prio=2))
for s in (5, 10, 15, 20, 30, 40, 45):
    items.append(dict(id=f'sec.{s}', text=f'{fem(s)} {form(s,"sekunda","sekundy","sekund")}.', p=INFO, prio=2))
for t in range(1, 11):
    for n in range(1, t + 1):
        items.append(dict(id=f'int.{n}.{t}', text=f'Interwał {ord_m(n)} z {gen_z(t)}.', p=INFO, prio=3))
for w in range(80, 605, 5):
    items.append(dict(id=f'from.{w}', text=f'od {gen_num(w)}', p=INFO, prio=6))
    items.append(dict(id=f'to.{w}', text=f'do {gen_num(w)} watów.', p=INFO, prio=4))
for p in range(50, 101):
    items.append(dict(id=f'pct.{p}', text=f'{num_pl(p)} procent w zakresie.', p=INFO, prio=5))
for n in range(3, 26):
    items.append(dict(id=f'hr.{n}', text=f'Tętno o {num_pl(n)} {form(n,"uderzenie","uderzenia","uderzeń")} wyżej.', p=INFO, prio=5))
items.sort(key=lambda x: x['prio'])
json.dump(items, open('manifest.json', 'w'), ensure_ascii=False, indent=0)
print(len(items), {p: sum(1 for x in items if x['prio'] == p) for p in range(6)})
