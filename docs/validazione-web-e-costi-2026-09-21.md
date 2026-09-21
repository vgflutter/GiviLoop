# GiviLoop: abbonamenti, reasoning e prove reali

> Documento storico della prima fase. I risultati successivi, inclusi i cicli automatici CLI/MCP riusciti sul sito e la release candidate, sono in [release readiness](release-readiness-2026-09-21.md).

Verifica del 21 settembre 2026. Obiettivo dell'autore: progetto open source gratuito con adozione, senza attività commerciale. I risultati tecnici sotto distinguono il ponte ChatGPT web già implementato da due esperimenti tramite Codex CLI: un successo della CLI non dimostra il funzionamento del ponte web.

Aggiornamento delle prove: il [resoconto CLI, MCP e distribuzione](validazione-community-2026-09-21.md) documenta i 27 test, l'installazione pulita, i problemi corretti e le successive prove sul sito reale. I numeri qui sotto descrivono la prima fase della verifica.

## Il vantaggio economico da verificare

L'idea ha valore per chi possiede già un abbonamento: chiedere un secondo parere approfondito può avere un costo marginale inferiore rispetto a una chiamata API separata. È un'ipotesi che dipende dal piano, dalle quote disponibili e dal tipo di accesso consentito. Non implica che la review consumi meno token in totale.

Vanno misurate tre cose diverse:

- **Contesto dell'agente principale:** packaging deterministico di file e diff può evitare di fargli riscrivere il contesto; il feedback che torna deve comunque essere letto.
- **Lavoro totale dei modelli:** aggiungere un revisore aggiunge input, output e possibile reasoning. Una domanda mirata può richiedere meno contesto di un archivio intero, ma il risultato va verificato.
- **Spesa e quote:** un accesso incluso può evitare un addebito API separato, consumando comunque la quota disponibile. La modalità headless non cambia questo bilancio.

La documentazione API specifica che i token di reasoning, anche se non visibili nel testo, sono conteggiati come output; l'utilizzo API può riportarne il numero. Non si può ricavare il reasoning consumato nella chat web dalla lunghezza della risposta o dai secondi trascorsi. [OpenAI Docs: reasoning](https://developers.openai.com/api/docs/guides/reasoning)

La promessa che proporrei per l'adozione è: **«Porta un secondo parere approfondito nel tuo flusso di sviluppo, prepara soltanto il contesto necessario e usa gli accessi che possiedi attraverso modalità supportate.»** Un risparmio percentuale richiede un confronto controllato; questi primi esperimenti non lo dimostrano.

## Quanto è chiaro il vincolo contrattuale

I termini europei OpenAI, aggiornati il 16 gennaio 2026 e applicabili anche ai residenti in Svizzera, vietano: “Automatically or programmatically extracting data or Output”. Comprendono anche l'uso personale non commerciale. La mia lettura è che leggere le risposte dal DOM e salvarle automaticamente, come fa `chatgpt-web` in modalità `auto`, confligga con questo divieto in assenza di una specifica autorizzazione. La titolarità dell'output non annulla le condizioni di accesso. [Termini ufficiali](https://openai.com/policies/eu-terms-of-use/)

La pagina di supporto Pro richiama restrizioni su estrazione automatica, condivisione dell'account e uso di ChatGPT per alimentare servizi di terzi. Un tool locale gratuito non coincide automaticamente con un servizio rivenduto, ma questo non risolve il divieto distinto sull'estrazione. [Informazioni ufficiali Pro](https://help.openai.com/en/articles/9793128-what-is-chatgpt-pro)

Non ho trovato in queste fonti un'eccezione generale per software open source, uso sporadico o account personale. Non qualifico il progetto come illegale: la questione qui è la compatibilità di una specifica modalità d'uso con il contratto. Non si può dedurre un'autorizzazione dal fatto che una prova funzioni o che altri progetti facciano lo stesso.

| Percorso | Valutazione pratica |
| --- | --- |
| Packaging locale, copia manuale nella chat, importazione manuale del testo | Mantiene il lavoro automatico sui file locali, senza lettura automatica del sito. È il punto di partenza che consiglierei per usare i modelli della chat web. |
| Apertura e precompilazione della chat, invio/recupero manuali | Elimina la raccolta automatica dell'output, ma non ho una conferma specifica del provider per questa automazione dell'interfaccia. Da descrivere precisamente nella richiesta di chiarimento. |
| Invio e acquisizione automatica delle risposte via Playwright, visibile o headless | È il percorso con il conflitto più diretto rispetto alla clausola citata. Non lo presenterei come uso autorizzato dell'abbonamento. |
| Codex CLI ufficiale in locale, autenticata dall'utilizzatore | Il login con ChatGPT e l'esecuzione non interattiva sono funzionalità documentate. È il candidato concreto da valutare per un adapter. |
| API con credenziali proprie | Accesso programmatico distinto, con le proprie condizioni e costi; non realizza da solo il vantaggio dell'abbonamento web. |

Codex documenta sia il login con ChatGPT per accesso in abbonamento, sia `codex exec` per script, con risultato salvabile e riuso dell'autenticazione CLI. Questo è il supporto documentale al percorso locale proposto; non equivale a un'approvazione specifica di GiviLoop né garantisce accesso agli stessi modelli e funzioni della chat web. [Autenticazione](https://learn.chatgpt.com/docs/auth), [esecuzione non interattiva](https://learn.chatgpt.com/docs/non-interactive-mode)

Le quote Codex dipendono anche da modello, contesto e reasoning; uso locale e cloud condividono la quota del piano e possono esserci limiti settimanali. Un secondo processo CLI non crea un secondo budget. Per alcuni piani anche altre funzioni agentiche condividono disponibilità o crediti. [Prezzi e limiti](https://learn.chatgpt.com/docs/pricing), [uso con il piano ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)

La sezione sulla gestione avanzata dell'autenticazione in CI/CD avverte di non usare quel flusso con repository pubblici/open source. Riguarda quel percorso di autenticazione su runner: non va trasformata in una promessa che si possano distribuire credenziali ai contributori, né interpretata da sola come divieto di sviluppare un tool locale open source. Gli esperimenti qui usano esclusivamente la CLI locale e l'autenticazione già presente. [Sezione CI/CD](https://learn.chatgpt.com/docs/non-interactive-mode#authenticate-in-automation)

## Prove eseguite

Dipendenze verificate: Node.js `22.21.1`, npm, zip, Google Chrome, Playwright `1.61.1`, MCP SDK `1.29.0`, TypeScript `5.9.3`. Le dipendenze npm erano state installate con `npm ci` nella preparazione della sessione. `npm ls --depth=0` e la build non indicano dipendenze mancanti. Codex CLI `0.154.0-alpha.6.2` risulta autenticata con ChatGPT.

### ChatGPT web

1. Eseguito realmente `givi ask --send chatgpt-web --mode auto --headless` con una richiesta minima di rispondere `GIVILOOP_OK`, senza sorgenti allegati. Run `2026-09-21T09-00-54-126Z-c0347b70`. Fallimento prima dell'invio: campo della chat non trovato. Nessuna risposta salvata.
2. Aperto il sito reale in Chrome visibile tramite Playwright, senza argomenti aggiuntivi per nascondere l'automazione. La pagina risponde HTTP 200 e mostra il compositore, il login e il banner cookie. Il profilo GiviLoop era nuovo e non autenticato. Questo non dimostra da solo la causa del fallimento headless.
3. Durante il login manuale con Google, l'autore ha ricevuto «Questo browser o questa app potrebbero non essere sicuri». Google documenta il possibile blocco dei browser controllati da software: la causa è coerente con quel limite, non con una dipendenza npm mancante. [Guida ufficiale Google](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en)
4. Chiusa soltanto l'istanza Chrome di test e aperto Chrome normalmente, senza Playwright né debug remoto, sul profilo separato di GiviLoop per l'accesso manuale. L'esito della successiva prova autenticata va ancora verificato. Nessuna credenziale è stata copiata da altri profili.

### Due review reali tramite Codex CLI

Il pacchetto è stato generato da `givi ask`; il trasporto sperimentale è una chiamata separata a `codex exec`, non una nuova funzionalità `--send codex` già implementata. Usati login ChatGPT, sandbox di sola lettura e modalità effimera; le variabili delle API key sono state rimosse dall'ambiente del processo. Gli eventi registrano soltanto la risposta dell'agente, senza esecuzioni di strumenti.

| Prova | Contesto GiviLoop | Durata | Input token riportati | Di cui cached | Output token riportati | Esito |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Review del provider | File `src/providers/chatgpt-web.ts`, richiesta di massimo tre problemi; prompt 16.630 byte | 21,90 s | 17.495 | 11.520 | 610 | Risposta salvata; tre rilievi da valutare |
| Review focalizzata | Estratto reale delle funzioni che attendono la risposta; prompt 2.510 byte | 14,69 s | 14.093 | 11.520 | 314 | Risposta salvata; analisi del falso successo al timeout |

I cached token sono un sottoinsieme degli input, non vanno sommati. Gli input comprendono anche il contesto della CLI, non soltanto i file allegati. Entrambe le run riportano `reasoning_output_tokens: 0`: è il dato osservato, non una prova di equivalenza con un modello web in modalità reasoning avanzata. Il modello predefinito non è stato forzato e non viene attribuito ad Astra sulla base di questi eventi. Non sono stati misurati l'addebito monetario effettivo o la variazione percentuale della quota dell'account.

Le domande e i contesti delle due prove differiscono: la tabella documenta esecuzioni riuscite, non un benchmark controllato di risparmio o superiorità.

Artefatti locali, esclusi da Git: `.giviloop/diagnostics/codex-review/` e `.giviloop/diagnostics/codex-focused/` contengono `response.md`, `events.jsonl`, `summary.json` e stderr. La diagnostica del browser è in `.giviloop/diagnostics/visible-browser.json`.

### Un finding riprodotto e corretto

La prima review ha segnalato che `waitForFinalAssistantResponse` restituiva `lastText` allo scadere del timeout, anche con generazione ancora attiva. Il comportamento è stato riprodotto sulla funzione compilata, con pagina e orologio controllati: risposta parziale restituita come successo a 1.000 ms. Evidenza locale: `.giviloop/diagnostics/partial-response-reproduction.json`.

Correzione applicata: scaduto il timeout, se non è stata confermata la conclusione, viene restituito un errore esplicito anziché salvare il frammento come review completata. Il testo parziale non viene conservato da questa correzione minima. Due test verificano il rifiuto della risposta ancora in generazione e il salvataggio di quella stabile e completata, inclusa la chiusura del browser. Build e tutti i 12 test passano.

Gli altri rilievi su upload e identificazione del modello restano ipotesi tecniche da verificare contro la UI corrente; non sono stati corretti sulla sola parola del revisore.

## Richiesta di chiarimento pronta, non inviata

Per una conferma sul caso specifico serve una risposta scritta da OpenAI che descriva esattamente l'uso ammesso. Il canale ufficiale è il supporto dal sito Help Center. Una risposta generica su “uso personale” non chiarirebbe il punto dell'estrazione automatica. [Come contattare il supporto](https://help.openai.com/en/articles/6614161-how-can-i-contact-support)

Testo proposto:

> Sto sviluppando GiviLoop, un progetto MIT gratuito eseguito localmente. Ogni utilizzatore usa il proprio account ChatGPT, senza condivisione di credenziali o servizio centralizzato. Il tool prepara contesto di codice e può usare Playwright per compilare/inviare una richiesta nella chat web, attendere la risposta e salvarne il testo in un file locale. Non intendo aggirare limiti o verifiche di accesso. Potete confermare per iscritto se questo uso è consentito, considerando la clausola sull'estrazione automatica di output? Cambia la risposta se il tool si limita alla precompilazione e l'utente invia e copia manualmente? In alternativa, è consentito distribuire un'integrazione locale che invoca la CLI ufficiale `codex exec`, autenticata individualmente con ChatGPT? Indicate eventuali condizioni o la procedura per ottenere una specifica autorizzazione.

Finché manca una conferma specifica, la direzione che consiglierei per l'adozione è packaging/export/import manuale per ChatGPT web e valutazione di un adapter locale ufficialmente documentato. L'obiettivo del risparmio resta sensato, con quote e costi dichiarati e risultati misurabili.
