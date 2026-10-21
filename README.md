# Battle Harem

Online kartová hra pre 2–8 hráčov vrátane počítačových súperov. Obsahuje všetkých 299 fyzických lícových kariet z pôvodného tlačového PDF: 25 postáv a spoločný balík 274 kariet. Opakované výtlačky zostávajú samostatnými kartami.

## Hranie

Hostiteľ vytvorí miestnosť, zvolí cieľ 25 / 36 / 50 sŕdc a náhodný alebo vlastný výber postáv. Ostatní sa pripoja šesťznakovým kódom. Po potvrdení pripravenosti hostiteľ spustí partiu.

Proti počítaču: pri vytváraní miestnosti zvoľ 1 až 7 počítačových súperov, potvrď svoju pripravenosť a spusti partiu. Hostiteľ môže počítače pridávať a odoberať aj v čakárni. Dajú sa kombinovať s ľudskými hráčmi do celkového počtu 8. Počítače sú pripravené automaticky a pri vlastnom výbere si zvolia postavu. Počas rozohranej partie sa účastníci nemenia.

Počítač vyhodnocuje svoju ruku, verejné zostavy, kapacity, cenu summonu a ponuky. Zvažuje vykladanie, výmenu kariet, Charge, prihadzovanie, Pas, obetovanie/oživenie a ukončenie ťahu. Ide o jednu základnú strategickú úroveň. Pred rozhodovaním sa skryjú cudzie ruky, rezervované karty a obsah balíkov; nevidí budúce doberanie. Jeho akcie overuje rovnaký serverový systém pravidiel ako akcie ľudí.

Ťahy počítača postupujú pri načítaní miestnosti s krátkou prestávkou medzi akciami. Aj hra osamote potrebuje internet a aspoň jedného pripojeného hráča s otvorenou hrou. Ak všetci odídu, počítače pokračujú po návrate. Súbežné načítania používajú kontrolu verzie, takže sa jedna akcia neodohrá dvakrát.

Čas na Prihodiť / Pas sa nastavuje pri vytvorení miestnosti alebo v čakárni: 30, 60, 90 či 120 sekúnd alebo bez limitu. Nové miestnosti majú predvolene 60 sekúnd. Každé prihodenie obnoví odpočet pre ostatných hráčov. Po uplynutí času všetci čakajúci automaticky pasujú. Čas určuje server a výsledok sa atómovo uloží pri najbližšej autorizovanej požiadavke (počas hry približne každých 1,6 sekundy). Ak sú všetci offline, výsledok sa dokončí pri návrate; oneskorená ponuka už neplatí. Staršie existujúce miestnosti bez nastavenia zostávajú bez časovača.

Každý vidí iba svoju ruku. Ostatné vyložené karty, ponuky a skóre sú verejné. Miestnosť sa ukladá na serveri. Relácia hráča zostáva uložená v jeho prehliadači; odkaz na pozvánku obsahuje iba kód miestnosti.

## Potvrdené pravidlá

- Všetky karty okrem postáv sú spolu zamiešané. Úvodná ruka vychádza z postavy.
- Na začiatku vlastného ťahu si hráč dopĺňa ruku do aktuálnej kapacity.
- Girl a Support sa summonujú z ruky. Počiatočná ponuka musí dosiahnuť cenu; ďalšia ponuka musí byť vyššia než aktuálne najvyššia.
- Každý súper môže prihodiť alebo pasovať. Nové prihodenie ruší predchádzajúce pasy. Keď pasujú všetci okrem lídra, líder získava kartu.
- Počas summonu ostatné bežné akcie a doberanie čakajú. Predošlá ponuka hráča zostáva; novými kartami ju zvyšuje.
- Hviezdy sú kapacita obsadená vyloženými Ability, Harem a Charge kartami. Odhodenie alebo výmena ju uvoľní.
- Charge sa nabije do začiatku ďalšieho vlastného ťahu a po použití sa odhodí. Použité Tame karty sa po summone tiež odhodia.
- Víťazstvo nastane okamžite po dosiahnutí cieľa.
- Umaru Yone / Creepy Turn: pri začatí summonu môže hráč zvoliť súpera. Jedna náhodná karta z jeho ruky sa rezervuje na ukončenie ťahu; jej identita sa neodhaľuje. Hráč potom môže ukončiť ťah bez vlastnej odhodenej karty.
- Karty zabité schopnosťou zostávajú v háreme a zachovávajú typ pre bonusy ostatných. Vlastné srdcia a pasíva strácajú. Zabitie a oživenie na jednej karte zdieľajú limit jedného použitia za vlastný ťah.

## Doplnenia prvého digitálneho vydania

Tieto detaily pôvodný manuál neurčuje úplne. Sú viditeľné aj v pravidlách hry a možno ich upraviť podľa autora:

- Po vyčerpaní doberacieho balíčka sa zamieša odhadzovací balíček.
- Vlastný výber umožňuje viacerým hráčom zvoliť rovnakú postavu; náhodné rozdelenie priraďuje rôzne postavy.
- Nový summon vyžaduje voľné miesto ešte pred získaním karty.
- Pri súčasnom dosiahnutí cieľa rozhoduje poradie od aktívneho hráča.
- Ak sa zmenou pasív prekročí kapacita, hra čaká na nápravu dotknutým hráčom. Ten môže odhodiť vyložené karty alebo vo vlastnom ťahu mimo summonu vyložiť kartu, ktorá celý deficit pokryje. Bonus novej karty sa počíta už pri kontrole kapacity. Pri začiatku ťahu sa doberanie odloží až po náprave.
- Pri výpočte spoločnej ponuky sa najprv použijú vybrané Charge a potom Tame v poradí výberu. Uvoľnené hviezdy sa premietnu do nasledujúcich kariet.
- Vyložená Power Play poskytuje svoj bonus k ruke za nabíjajúce sa Charge. Táto neobvyklá schopnosť je predbežná interpretácia.
- Bežné hranie z ruky necháva aspoň jednu vlastnú kartu na ukončenie ťahu, pokiaľ nebola rezervovaná súperova karta. Sumitachi Yuuka môže pri ukončení použiť mŕtve dievča a vlastnú kartu si ponechať.
- Miestnosti sú prístupné existujúcim členom počas siedmich dní od poslednej hernej akcie. Noví hráči sa pripájajú pred začiatkom partie. Pri odpojení možno pokračovať na tom istom prehliadači. Nastavený časovač sa vzťahuje na reakcie v summone, nie na celý bežný ťah. Výmena hráča botom nie je súčasťou hry.

## Poznámky k pôvodnému balíčku

- Show her scenery má podľa karty základ 3 tames a +2 proti Dandere; chybná hodnota 7 z príkladu manuálu sa nepoužíva.
- Seiza Kage má za prítomnosť Common +1 ku kapacite ruky, nie +1 miesto v háreme.
- Akujima Natsu odkazuje na Riza Hawkeye, ktorá v dodanom balíčku nie je. Bonus zostáva neaktívny, kým sa táto karta nedoplní alebo autor neurčí opravu.
- Karta pomenovaná Surname Name zachováva meno vytlačené v zdroji.

## Zdrojový projekt

Rozhranie používa React a TypeScript; server beží ako Cloudflare Worker cez Vinext. Perzistentné miestnosti sú uložené v D1. Na ťahovú hru sa používa pravidelné načítanie stavu; súčasné akcie sa ukladajú kontrolou verzie a opakovane doručené akcie sa neduplikujú.

- `lib/game.ts`: samostatné herné pravidlá bez sieťových závislostí.
- `lib/bot.ts`: rozhodovanie počítačových súperov nad skrytým pohľadom na cudzie karty.
- `lib/automation.ts`: plánovanie jednej serverovej akcie počítača a prednosť vypršaného časovača.
- `data/cards.json`: hodnoty, podmienky a efekty všetkých kariet.
- `public/cards/`: optimalizované obrázky kariet.
- `app/page.tsx`: rozhranie hry.
- `app/api/room/route.ts`: miestnosti, autentifikácia hráčskej relácie a atómové akcie.
- `db/schema.ts` a `drizzle/`: databázová schéma a migrácie.

Pri prenose na iný hosting treba nakonfigurovať Cloudflare Worker, D1 a aplikovať databázovú migráciu. Projekt nevyžaduje Unity ani inštaláciu na zariadeniach hráčov.

## Overenie

- 88 automatických testov pravidiel a počítačových súperov: `npm test` (Node 24). Zahŕňajú automatické Pas pre 2–8 hráčov, hranicu vypršania, obnovenie času, vypnutý časovač, víťazstvo po vypršaní a skutočné hviezdne pasívky pri nulovej voľnej kapacite.
- Deväť deterministických bot partií pre všetky kombinácie 2/4/8 hráčov a cieľov 25/36/50 dokončilo hru s víťazom. Testy kontrolujú zachovanie kariet, nezávislosť rozhodnutia od skrytých informácií, časovanie, rezerváciu, Yuuka a opravu kapacity.
- Päť reprodukovateľných celých partií: `node tests/simulation.mjs`. Scenáre pokrývajú 2, 4 a 8 hráčov a všetky tri ciele; po každej akcii kontrolujú zachovanie každej fyzickej karty.
- Lokálny integračný test miestnosti s ôsmimi hráčmi overil súčasné pripojenia a pripravenosť, súkromie rúk, neoprávnené akcie, limit miestnosti a ochranu pred duplicitným doručením akcie.
- Serverový test časovača overil 8 súčasných obnovení, jediné pridelenie karty, jediné zvýšenie verzie, zamietnutie oneskoreného prihodenia so zachovaním výsledku a nemožnosť meniť stav neautorizovanou požiadavkou.
- Revízia katalógu porovnala 299 textov efektov s extrakciou tlačového PDF; pri hviezdnych pasívkach nenašla vynechaný bonus. Známe nejasnosti Power Play a chýbajúca Riza Hawkeye sú uvedené vyššie a v herných pravidlách.

Na lokálne spustenie nainštaluj závislosti cez `npm ci`, zostav projekt cez `npm run build`, aplikuj migráciu z priečinka `drizzle` do lokálnej D1 databázy a spusti `npm run dev`. Konfiguráciu hostingu nájdeš v `.openai/hosting.json`; projekt používa databázovú väzbu `DB`.
