# Accesso ai provider e responsabilità

Stato verificato il 21 settembre 2026 per un progetto gratuito e open source. Questo documento distingue il flusso automatico da quello assistito e descrive le incertezze; non certifica l'autorizzazione dei provider né l'efficacia giuridica di un esonero.

## Il flusso completamente automatico

`givi ask --send chatgpt-web --mode auto` prepara il prompt, lo inserisce nel sito, invia la richiesta, attende la risposta e la salva nella run. `givi send --mode auto` esegue lo stesso trasferimento per una richiesta già preparata. MCP può poi restituire la review all'agente. L'opzione `--background` usa una finestra Chrome ridotta a icona; `--headless` usa un browser senza finestra. Nessuna delle due elimina eventuali requisiti di login o verifica, né modifica le condizioni di accesso al provider.

L'implementazione attuale usa Playwright per compilare il campo e leggere il testo della risposta dalla pagina. Non richiede che l'utente copi o incolli. Sostituire la lettura della pagina con clic automatici sul pulsante «Copia» e lettura degli appunti rimarrebbe acquisizione automatica: il meccanismo tecnico non crea da solo un'eccezione alla clausola contrattuale sull'estrazione automatica di output.

Questo percorso è disponibile nel codice, ma non va presentato come autorizzato dal provider sulla sola base di una prova riuscita o dell'avvertenza MIT. Il flusso assistito sotto è una modalità diversa, con interventi manuali effettivi.

## Il percorso che conserva l'uso della chat web

GiviLoop può automatizzare il packaging locale e l'organizzazione della review, mentre l'utilizzatore usa direttamente il sito del provider:

1. `givi ask`, `prepare` o `archive` prepara il contesto, senza `--send`.
2. `givi copy --open` copia il prompt e apre il normale browser predefinito sul provider del pacchetto.
3. L'utente incolla, allega eventuali file, seleziona il modello ed invia sul sito.
4. L'utente copia la risposta con le funzioni del sito o del browser.
5. `givi ingest` importa il testo dagli appunti locali su richiesta esplicita. L'agente può poi leggere e valutare il risultato salvato.

Questi passaggi sono disponibili nella CLI. `--open` è stato aggiunto in questa modifica. Il browser non viene controllato da Playwright e GiviLoop non legge il DOM, la rete o le risposte del sito. Se l'apertura del browser fallisce, il prompt rimane copiato e viene indicato il collegamento da aprire manualmente.

Questo conserva la possibilità di scegliere il reasoning disponibile nel proprio account web, con i relativi limiti. Richiede passaggi manuali reali. Non fornisce la comodità dell'intero ciclo headless, ma rimuove l'acquisizione automatica dal sito che origina il problema contrattuale esaminato. Non è una garanzia generale di conformità per ogni account, contenuto o utilizzo.

`copy`, `ingest` e `send` accettano `--run-id ID` per scegliere una richiesta già preparata. Senza il parametro usano la run più recente. Conservare l'ID mostrato in fase di preparazione e usarlo sia per la copia sia per l'importazione quando si gestiscono più review. Una risposta importata per una run precedente rimane associata a quella richiesta; il provider viene letto dai suoi metadati. MCP accetta lo stesso ID nel campo `runId` e segnala una risposta mancante senza sostituirla con quella di un'altra run.

## Automazione completa e scelta individuale

GiviLoop implementa ora cinque adapter verso runtime locali: **Ollama**, **DwarfStar**, **llama.cpp**, **LM Studio** e **MLX-LM**. La richiesta e la generazione passano per il server locale, senza acquisire output dal sito ChatGPT e senza usare le quote dell'abbonamento web. È il percorso concreto per offrire automazione senza dipendere da quell'integrazione web. Restano applicabili le licenze del runtime, dei pesi e dei contenuti. Se la review viene restituita a un agente cloud, quel testo entra comunque nella conversazione dell'agente: inferenza locale non significa che l'intero lavoro dell'agente sia offline.

Per l'automazione completa proporrei trasporti documentati dal provider, con accesso personale dell'utilizzatore. Codex descrive `codex exec` proprio per invocazioni da script e produzione di output utilizzabili da altri programmi. Un adapter GiviLoop non è ancora implementato: le prove già effettuate sono invocazioni separate della CLI. [Documentazione ufficiale](https://learn.chatgpt.com/docs/non-interactive-mode)

Tenere un'integrazione browser facoltativa o separarla in un plugin è una scelta architetturale possibile, ma non modifica i termini del servizio usato. Non presenterei `--experimental`, una casella «accetto il rischio» o l'installazione separata come autorizzazioni. Nemmeno un pulsante manuale che avvia la lettura automatica del DOM elimina di per sé la questione.

I termini europei OpenAI vietano l'estrazione automatica di dati/output e prevedono possibili restrizioni sull'account per violazioni. Non contengono nelle disposizioni esaminate un'eccezione generale per questo caso perché il software è gratuito. Questa è la base della distinzione tecnica, non un giudizio sulla legalità astratta di pubblicare il progetto. [Termini ufficiali](https://openai.com/policies/eu-terms-of-use/)

## Cosa può dire correttamente la documentazione

GiviLoop ha già una licenza MIT con clausole di esclusione delle garanzie e limitazione della responsabilità. La licenza disciplina il software distribuito; non cambia il contratto dell'utilizzatore con il provider e non costituisce una promessa di immunità per l'autore. [Testo MIT ufficiale](https://opensource.org/license/mit)

Avvertenza proposta, coerente con il README e da far verificare a un legale se si vuole fare affidamento sulla sua efficacia:

> GiviLoop è un progetto indipendente distribuito con licenza MIT, con le esclusioni e limitazioni previste da tale licenza nei limiti consentiti dalla legge applicabile. Ogni utilizzatore è responsabile della scelta dei provider, dell'uso del proprio account, dei contenuti trasferiti e del rispetto delle condizioni applicabili. La disponibilità di un'integrazione non implica che il provider ne autorizzi l'uso. GiviLoop non è affiliato ai provider e non concede diritti di accesso ai loro servizi.

Questa formulazione chiarisce ruoli e limiti. Non afferma che tutta la responsabilità sia trasferibile all'utente, né rende consentita una modalità di accesso vietata dal provider.

## Messaggio per l'adozione

«Un secondo parere sul codice, con contesto selezionato e review conservate nel progetto. GiviLoop collega il tuo agente a una seconda review tramite chat web o modelli locali. Puoi riutilizzare il tuo accesso alla chat per evitare una chiamata API aggiuntiva, nei limiti del piano e delle condizioni del provider.»

Il beneficio economico va espresso come possibile minore spesa aggiuntiva e minore lavoro ripetuto. Nessuna promessa di token gratuiti, quota illimitata o conformità garantita. La scelta dell'utente resta effettiva perché il comportamento di ciascun percorso è descritto esplicitamente.
