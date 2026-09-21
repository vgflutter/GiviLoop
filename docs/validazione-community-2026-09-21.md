# Validazione CLI, MCP e distribuzione

> Documento storico della prima fase. I risultati successivi, inclusi i cicli automatici CLI/MCP riusciti sul sito e la release candidate, sono in [release readiness](release-readiness-2026-09-21.md).

Prove del 21 settembre 2026 su macOS, Node.js 22.21.1. Scopo: verificare il ciclo di review e l'installazione da parte di un nuovo utilizzatore. Queste prove non misurano l'adozione, il risparmio di token o l'efficacia del reasoning web.

## Risultati riproducibili

| Verifica | Risultato | Cosa è stato verificato |
| --- | --- | --- |
| Build TypeScript e `npm test` | 27 test passati, nessuno saltato | Packaging, omissione di symlink, budget, redazione di forme comuni di segreti, archivio, clipboard, provider, associazione fra richiesta e risposta, errori, MCP e timeout della risposta web. |
| MCP via processo stdio reale | 5 test passati, inclusi nei 27 | Inizializzazione, elenco dei 7 tool, preparazione da Git, importazione CLI, lettura con `analyze-only` e `act`, controllo di ID, modalità headless e allegati mancanti. |
| Installazione del pacchetto | Riuscita | `npm pack`, installazione del tarball con `npm install --omit=dev` in una directory temporanea indipendente, esecuzione del binario installato `givi help`. |
| Test sul pacchetto installato | 17 test passati | Le 8 prove CLI del flusso assistito, le 5 MCP e le 4 del provider usano i file `dist` effettivamente installati, non quelli del checkout. |
| Contenuto del pacchetto | 9 file | Inclusi CLI, MCP, provider compilati, README, licenza e nota sui provider. Esclusi diagnostica, run, sorgenti, test e credenziali. |
| Dipendenze | Nessuna mancante; audit: 0 vulnerabilità note | Aggiornate 5 dipendenze transitive compatibili, senza `--force`. Anche l'installazione pulita ha riportato audit senza vulnerabilità. |

Le prove CLI/MCP usano repository temporanei, anche con spazi e caratteri Unicode. Avviano realmente i programmi e il protocollo MCP; simulano gli appunti e l'apertura del browser. Un tentativo inatteso di avviare Playwright in quelle prove fallisce esplicitamente. Le risposte usate nei test sono fixture, non risposte di un modello reale. `act` verifica le istruzioni restituite all'agente: il server MCP non modifica da solo i sorgenti.

I quattro test del provider simulano la pagina e il tempo per verificare completamento, timeout e chiusura del browser nelle due strutture di messaggio supportate. La nuova struttura richiede il proprio attributo di completamento anche quando il testo smette temporaneamente di cambiare e non è presente un pulsante Stop riconosciuto. Non richiedono credenziali né inviano messaggi a ChatGPT.

## Problemi trovati e corretti

- **Provider errato nell'importazione:** una richiesta Claude poteva essere salvata come ChatGPT. `ingest` ora legge il provider dai metadati della run; resta possibile un override esplicito.
- **Sovrascrittura prima della validazione:** un ID non valido poteva provocare un errore dopo aver già cambiato la risposta nell'inbox. La selezione e la validazione precedono la lettura degli appunti e il salvataggio.
- **Risposta attribuita alla richiesta sbagliata:** MCP poteva usare una risposta recente nell'inbox quando quella della run richiesta mancava. Ora una run nota deve avere la propria risposta; il fallback resta solo per repository legacy senza run.
- **Review simultanee:** `copy`, `ingest` e `send` accettano `--run-id ID`. Un'importazione o un invio per una run precedente conserva la risposta in quella run senza sostituire l'inbox della più recente.
- **Richiesta mancante:** `copy` segnala una richiesta cancellata dalla run selezionata, senza copiare silenziosamente un vecchio prompt.
- **Risposta web incompleta:** la correzione precedente impedisce di salvare come completata una risposta ancora in generazione allo scadere del timeout.
- **Risposta visibile ma non letta:** una prova reale anonima ha restituito `GIVILOOP_WEB_OK`, ma il vecchio selettore ha contato zero risposte. Ispezionato il markup effettivo: il sito usa `data-message-role="assistant"`, `data-assistant-markdown` e `data-message-complete`. Il lettore ora supporta questi attributi, aspetta il completamento ed estrae il testo senza l'intestazione «ChatGPT ha detto» e i pulsanti. Rimane compatibile con `data-message-author-role`.

## Prove contro il sito reale

Il percorso richiesto è completamente automatico: preparazione locale, compilazione della chat, invio, lettura della risposta e ritorno all'agente. L'implementazione usa Playwright; non richiede copia/incolla da parte dell'utilizzatore. Il flusso assistito `copy --open` / `ingest` è una modalità separata.

Una prova con la CLI reale, `send --run-id 2026-09-21T09-24-30-509Z-c74d5db8 --mode auto --headless`, è fallita prima dell'invio perché il campo di input non è stato trovato. Durata osservata: 47,04 secondi; nessuna risposta creata.

La diagnostica con Chrome visibile ha caricato una pagina HTTP 200 con pulsanti «Accedi» e banner cookie: il profilo dedicato non risultava autenticato. Questo non prova da solo la causa del fallimento headless. Un successivo invio minimo in modalità visibile si è fermato durante la navigazione; lo screenshot di Chrome mostra `ERR_NETWORK_IO_SUSPENDED`, con il messaggio relativo alla sospensione del computer.

Una prova successiva ha effettivamente inviato il messaggio e ricevuto `GIVILOOP_WEB_OK` in una conversazione anonima. Il salvataggio è fallito perché il selettore precedente non riconosceva il nuovo markup. Dopo la correzione, una riproduzione locale con **Chrome reale headless** e il markup acquisito dal sito ha salvato esattamente `GIVILOOP_WEB_OK`, escludendo domanda, risposta precedente e comandi della pagina e attendendo il nuovo attributo di completamento. È una verifica del lettore su una riproduzione, non una nuova risposta ottenuta dal sito.

Il successivo tentativo completo riguarda la run `2026-09-21T10-46-31-323Z-333b6a69`, creata dalla CLI con un piccolo file `cart.ts` contenente un errore noto nell'accumulatore di `reduce`. La modalità headless è fallita prima dell'invio perché l'input non era disponibile; il tentativo visibile è fallito nel caricamento del sito. Nessuna review è stata salvata per questa run. Gli effetti dell'errore nel file sono stati riprodotti localmente su array vuoto, un elemento e due elementi; non si attribuiscono questi risultati al modello.

**Esito del test web:** dimostrati invio e ricezione automatici nella sessione anonima; corretto il riconoscimento della risposta e verificato il lettore con Chrome locale. Il ciclo completo sul sito dopo la correzione e l'uso del reasoning dell'account autenticato restano da verificare. È stato riaperto Chrome normale con il profilo dedicato per il login iniziale dell'utilizzatore. Non è stato richiesto alcun copia/incolla manuale per il percorso automatico.

I risultati precedenti tramite Codex CLI sono descritti nel [resoconto web e costi](validazione-web-e-costi-2026-09-21.md). Sono review reali con un trasporto diverso; non vanno conteggiati come successi dell'integrazione ChatGPT web.

La diagnostica locale è conservata sotto `.giviloop/diagnostics/package-install-final/`, `web-auto/`, `web-visible-smoke/`, `response-replay/` e `live-roundtrip/`, esclusi da Git e dal pacchetto.

## Limiti e valore per chi prova il progetto

I test sono stati eseguiti su macOS con Node 22. Le diramazioni Windows/Linux degli appunti esistono nel codice, ma non sono state validate su macchine con quei sistemi. La suite non certifica tutti i cambiamenti possibili dell'interfaccia web, l'upload su account autenticati o la selezione di modelli specifici.

Il valore già verificabile è preparare un contesto delimitato, conservare richiesta e risposta associate e restituire la review all'agente con istruzioni per valutarla. Non è ancora dimostrato un risparmio totale di token o un vantaggio di qualità rispetto alle review native degli agenti. Per un primo gruppo di utilizzatori, le misure utili sono completamento senza interventi, tempo attivo, problemi riproducibili trovati e suggerimenti scartati.

Il funzionamento tecnico dell'automazione e l'autorizzazione contrattuale del provider sono questioni distinte: vedere la [nota sull'accesso](accesso-provider.md). Né la gratuità né una clausola di responsabilità trasformano il copia/incolla automatico in un'attività manuale.
