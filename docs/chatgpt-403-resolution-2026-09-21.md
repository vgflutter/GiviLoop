# ChatGPT: correzione del 403 in 0.3.0-rc.2

Il 21 settembre 2026 l'accesso reale è tornato operativo sul Mac di prova, con il profilo GiviLoop già autenticato. Sono riuscite due richieste complete, una CLI e una MCP, entrambe in background e senza un nuovo tap umano.

## Differenza verificata

La baseline con `launchPersistentContext` di Playwright continuava a ricevere una challenge Cloudflare, pur conservando login e `cf_clearance`. Avviando lo stesso Chrome come processo nativo e collegandosi tramite Chrome DevTools Protocol, con lo stesso profilo e la stessa rete, la pagina è passata da HTTP 403 a HTTP 200. Non sono stati cancellati cookie o profili, cambiati rete/proxy, modificati user agent o `navigator`, né cliccati automaticamente controlli di verifica.

Questo confronto identifica una configurazione di avvio funzionante; non isola un singolo flag come causa universale del blocco. La correzione riguarda il browser visibile, anche minimizzato. Una successiva prova **headless ha ancora ricevuto una challenge**.

## Implementazione

Le sessioni visibili ora usano Chrome nativo, sandbox e portachiavi del sistema, con il profilo dedicato esistente. GiviLoop assegna una porta temporanea su `127.0.0.1` e si collega esclusivamente al WebSocket annunciato dal processo che ha avviato. Non si collega al browser personale né a un server CDP configurato da remoto. L'endpoint di controllo non viene salvato nei report; rimane aperto solo per la durata della sessione posseduta.

La chiusura invia `Browser.close` e attende l'uscita effettiva del processo, invece di limitarsi a disconnettere Playwright. Cancellazione MCP e terminazione CLI chiudono il browser posseduto e rilasciano il profilo. Restano i controlli di origine, il limite delle verifiche ripetute e il divieto di reinvio automatico dopo un invio incerto. Stato e access probe indicano `transport: native-cdp`; headless mantiene il percorso Playwright.

## Prove live

| Percorso | Durata del browser | Esito |
| --- | ---: | --- |
| CLI, `--mode auto --background` | 20,38 s | Individuato `reduce()` senza valore iniziale; risposta completa salvata. |
| MCP, `mode: auto`, `background: true` | 26,29 s | Individuato `slice(-0)`; risposta completa salvata. |

Entrambe le run registrano `submitted: true`, `outcome: completed`, `verificationRequired: false`; il browser viene chiuso. Le correzioni suggerite sono state controllate indipendentemente con undici casi di regressione, lasciando invariati i sorgenti di prova. La risposta su `slice` usa `===` per illustrare contenuti equivalenti: preso come confronto fra riferimenti JavaScript, quell'esempio non sarebbe vero.

Le prove hanno usato il modello corrente dell'interfaccia. **Non attestano la selezione di uno specifico modello dell'abbonamento o il reasoning lungo**: il selettore precedente non era presente nella pagina attuale. Non sono disponibili conteggi affidabili dei token web da queste prove.

Evidenze locali in `.giviloop/diagnostics/access-403/`: `baseline.json`, `native-probe.json`, `native-product-check.json`, `live-cli-response.md`, `live-mcp-summary.json`, `live-mcp-response.md`, `live-verification.json`, `headless-after-fix.json`.

## Utilizzo

Usare il percorso visibile minimizzato:

```sh
givi ask --repo /percorso/repo --file src/cart.ts \
  --question "Trova difetti concreti e suggerisci test di regressione" \
  --send chatgpt-web --mode auto --background
```

Per controllare l'accesso senza inviare un prompt: `givi browser check`. Il sito può ancora richiedere una verifica in futuro; GiviLoop mantiene l'attesa nella stessa richiesta e il rilevamento del ciclo. Non è necessario rifare il login a ogni run.

La risoluzione tecnica del 403 non modifica il [tema contrattuale](accesso-provider.md). La versione resta una candidate: i risultati della CI remota, i modelli web specifici e gli altri limiti documentati nella [validazione precedente](production-validation-2026-09-21.md) non vengono dichiarati risolti da questa correzione.

I risultati sul pacchetto installato sono in `.giviloop/releases/release-checks.json`; archivio `giviloop-0.3.0-rc.2.tgz`. I test browser includono persistenza dei cookie sia headless sia nativa, sandbox, chiusura pulita, terminazione CLI, cancellazione MCP e ripresa senza doppio invio.
