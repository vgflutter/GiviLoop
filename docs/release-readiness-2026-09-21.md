# GiviLoop 0.1.0-rc.1: verifica di rilascio

Rapporto storico. Per Ollama, DwarfStar e le successive verifiche del login consultare la [validazione 0.2.0-rc.1](local-inference-validation-2026-09-21.md).

Prove del 21 settembre 2026, macOS arm64, Node.js 22.21.1. Questo rapporto aggiorna le validazioni precedenti: il ciclo automatico agente → sito ChatGPT → agente è riuscito sia da CLI sia via MCP. Il risultato è una release candidate per uso locale e feedback della community; non certifica disponibilità continua del sito o compatibilità contrattuale.

## Il blocco del browser

Il profilo dedicato precedente risultava occupato da una sessione Chrome bloccata e mostrava un arresto anomalo. È stato fermato soltanto quel processo, verificato tramite il percorso del profilo. Il profilo originale è stato conservato come backup locale `~/.giviloop/browser-profiles/chatgpt.recovery-20260921T173352Z`; il browser personale non è stato modificato.

Le prove successive con un nuovo profilo dedicato sono riuscite. Questo isola il problema operativo della sessione precedente, senza dimostrare che ogni schermata vuota abbia la stessa causa. Il computer è anche entrato in sospensione durante la sessione: gli intervalli lunghi fra le prove non sono una misura del tempo di elaborazione del modello.

Il prodotto ora offre `givi doctor`, login tramite Chrome normale, rilevamento del profilo occupato, navigazione con timeout e un solo nuovo tentativo prima dell'invio, errori specifici per accesso negato e diagnostica persistente per ogni run. Non ripristina o cancella automaticamente i profili.

## Prove contro ChatGPT reale

| Percorso | Risultato | Verifica |
| --- | --- | --- |
| CLI `auto --headless`, profilo nuovo | HTTP 403, arresto in 0,81 s | Accesso negato riconosciuto prima dell'invio; nessuna risposta inventata e nessun retry automatico. |
| CLI `auto`, finestra visibile | Completato in 9,22 s | Risposta sentinella `GIVILOOP_RECOVERY_OK` inviata, acquisita e salvata automaticamente. |
| CLI `auto --background`, review di `cart.ts` sintetico | Completato in 13,82 s | Chrome minimizzato; risposta salvata e riletta tramite un client MCP reale. Il modello ha individuato l'assenza del valore iniziale in `reduce`. |
| MCP `givi_ask_web_llm`, `auto`, `background: true` | Completato in 13,678 s | Richiesta, invio, acquisizione e ritorno all'agente interamente automatici. Il modello ha trovato il bug `slice(-0)` in `takeLast`; sorgente rimasto invariato con `analyze-only`. |

Le due review di codice sono state controllate indipendentemente. Per `reduce`, il difetto originale è stato riprodotto con array vuoto, un elemento e due elementi; l'aggiunta dello zero iniziale restituisce rispettivamente 0, 6 e 10. Per `takeLast`, il difetto con `count=0` è stato riprodotto e la correzione proposta verificata su quattro casi, inclusi array vuoto e conteggio superiore alla lunghezza.

Queste prove hanno usato il compositore anonimo. Non dimostrano accesso al modello o al reasoning dell'abbonamento, né risparmio di token. Nessuna credenziale è stata acquisita o trasferita. Non è stato necessario copiare o incollare manualmente.

Le evidenze locali sono in `.giviloop/diagnostics/release-hardening/`: riepiloghi `background-review.json` e `mcp-live-summary.json`, risposte, log delle CLI e `mcp-live-validation.json`. La verifica del primo difetto è in `.giviloop/diagnostics/live-roundtrip/fixture-validation.json`. Questi file restano fuori dal repository e dal pacchetto distribuito.

## Regressioni e pacchetto

La suite del checkout passa **41 test**, comprendenti CLI, MCP stdio, associazione fra run e risposte, budget e omissioni, clipboard simulata, conservazione delle run, browser occupato, errori di navigazione, invio dall'esito incerto, risposte incomplete e allegati senza conferma.

La suite aggiuntiva passa **8 test con Chrome reale** e pagine locali controllate. Verifica il ciclo CLI → browser → risposta → MCP, il caricamento di un vero archivio ZIP prima dell'invio, entrambi i formati di risposta supportati e quattro casi di selezione del modello. Nessuno di questi otto test contatta il sito reale. Le selezioni richieste devono corrispondere esattamente e risultare confermate nell'interfaccia; una selezione obbligatoria non confermata ferma l'invio.

`npm run test:package -- --browser` costruisce e installa il tarball in un progetto temporaneo con sole dipendenze di produzione, controlla i binari `givi` e `givi-mcp`, riesegue le suite contro il codice **installato** e controlla il contenuto del pacchetto e l'audit delle dipendenze. Solo se tutti i controlli passano copia l'archivio in `.giviloop/releases/` e scrive `release-checks.json`, con hash SHA-256, file distribuiti, conteggi dei test, versione di Node e risultato dell'audit. I log TAP delle due suite sono salvati accanto al rapporto.

Il controllo del pacchetto ha completato l'installazione pulita e superato tutti i **41 + 8 test** contro il codice installato. Il tarball contiene 16 file previsti e l'audit ha riportato **0 vulnerabilità note** alla data della verifica. Non è stato pubblicato su npm.

La configurazione GitHub Actions copre Node 20, 22 e 24 su Linux e macOS, con un job aggiuntivo per browser e installazione del pacchetto. Non è stata eseguita sui runner remoti durante questa sessione: la matrice configurata non va confusa con piattaforme già verificate.

## Comportamenti consolidati

- `--background` mantiene Chrome minimizzato per l'intero scambio automatico e chiude il contesto alla fine. È distinto da headless e non altera l'identità dichiarata del browser.
- La diagnostica indica separatamente lo stato dell'invio e il risultato della run. Un click incerto non viene ripetuto; una risposta parziale non sovrascrive quella completata precedente.
- Una run nota non prende mai il prompt o la risposta di un'altra run per nascondere un file mancante. I risultati di una run precedente non sostituiscono l'inbox della più recente.
- La pulizia conserva tutte le run in attesa o attive e le dieci più recenti completate e inattive al momento della preparazione successiva.
- L'upload non viene ripetuto se il caricamento è già avvenuto ma la conferma non arriva. Si attende un pulsante di invio abilitato.
- Il playground usa la stessa implementazione della CLI. La versione CLI e quella annunciata da MCP provengono dal manifest del pacchetto.

## Limiti prima di considerarlo stabile

1. Login dell'account, selezione dei modelli dell'abbonamento e sessioni di reasoning lunghe non verificati contro il sito reale. L'autenticazione iniziale può richiedere l'intervento del titolare.
2. Headless ha ricevuto HTTP 403. Background è riuscito su questa macchina, ma può mostrare brevemente la finestra e dipende dalla gestione delle finestre del sistema.
3. L'upload ZIP è verificato con Chrome reale su una pagina locale; manca una prova live autenticata con upload.
4. L'interfaccia del provider può cambiare. La conferma del modello riguarda l'etichetta della UI, non l'identità tecnica del modello; l'estrazione è testo renderizzato, non un'esportazione Markdown garantita.
5. Nessun benchmark dimostra ancora risparmio di token, superiorità del reasoning o adozione. Servono task controllati e metriche prima di promuovere questi benefici come risultati.
6. Una prova riuscita e la licenza MIT non risolvono le condizioni del provider. Il punto contrattuale resta separato e documentato in [accesso ai provider](accesso-provider.md).

## Valore per la community

Il valore dimostrato è una seconda review riproducibile: contesto limitato, trasferimento automatico quando consentito, risposta associata alla richiesta e valutazione critica prima delle modifiche. I due piccoli difetti reali trovati nelle prove sono buoni esempi iniziali; non costituiscono un benchmark.

Per una prima adozione: distribuire la candidate, raccogliere casi riproducibili tramite la guida di troubleshooting e misurare difetti utili, falsi positivi, tempo totale e dimensione del contesto. L'eventuale minore spesa aggiuntiva va misurata sul trasporto scelto, senza promettere token gratuiti o quote illimitate. Trasporti documentati dai provider restano una possibile evoluzione; non sono presentati come già implementati.
