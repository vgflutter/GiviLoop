# GiviLoop: capacità, prove reali e valore — 22 settembre 2026

GiviLoop ha un valore concreto come ponte CLI/MCP per ottenere una seconda review, conservarla nel repository e farne verificare i rilievi all'agente. Le prove di oggi confermano il percorso ChatGPT **con e senza login**, quando il sito concede l'accesso, e quattro motori locali. Questo giustifica un piccolo pilot open source; non dimostra ancora risparmio totale di token, superiorità rispetto alla review dell'agente o affidabilità universale delle chat web.

Ambiente: macOS arm64, Node 22.21.1, Chrome installato, checkout sorgente. Le richieste live contengono solo fixture sintetiche. I profili anonimi sono nuovi e separati dal profilo autenticato: nessuna disconnessione, copia di cookie o modifica delle credenziali. Non sono stati selezionati modelli web specifici. L'accesso a un campo di testo, una risposta completata e una review corretta sono tre verifiche diverse.

## Cosa può fare oggi

Nei comandi sotto, dal checkout sostituire `givi` con `npm run givi --`.

| Funzione | Come usarla | Confine attuale |
| --- | --- | --- |
| Review di file selezionati | `givi ask --repo PATH --file FILE --question "..."` | Aggiungere `--send` per inviare; altrimenti prepara soltanto. |
| Review delle modifiche Git | `givi prepare --repo PATH --goal "..."`, poi `givi send` | Diff rispetto a `HEAD` e file non tracciati inclusi; non è una review automatica dell'intero branch rispetto al merge-base. |
| Archivio sorgente | `givi archive --repo PATH --goal "..." --no-untracked` | Produce ZIP e manifest; gli adapter locali ricevono testo, non ZIP. |
| ChatGPT automatico | `--send chatgpt-web --mode auto --background` | Login facoltativo solo quando lo consente il sito; eventuale verifica umana resta manuale. |
| ChatGPT parzialmente assistito | `--mode prefill` oppure `--mode submit` | Lascia Chrome visibile: rispettivamente compila soltanto oppure invia senza recuperare la risposta. |
| ChatGPT/Claude manuale | `--target-provider chatgpt-chat` o `claude-chat`, poi `copy --open` e `ingest` | L'utente incolla, invia e copia la risposta sul sito. Claude automatico non è implementato. |
| Review locale | `--send ollama\|llama-cpp\|lmstudio\|mlx\|dwarfstar --model NAME` | Runtime già avviato, modello esplicito, endpoint loopback; nessun download o fallback cloud automatico. |
| Discovery e diagnostica | `models --provider NAME`, `doctor`, `browser check` | `doctor` non verifica il login; `browser check` non prova una generazione completa. |
| Uso dall'agente | Server stdio `node /path/GiviLoop/dist/mcp-server.js` | Va configurato nel client MCP; compilare o avviare manualmente il file non registra il server nel client. |
| Double Check | Preparazione → secondo revisore → `givi_read_external_review` → verifica dell'agente | Non esiste ancora un comando `double-check`, un verificatore incorporato o un registro strutturato dei rilievi. |
| Conservazione e costi osservabili | `.giviloop/runs/<id>/` | Richiesta, risposta, stato; token effettivi dei runtime locali quando comunicati. Token web e dell'agente non misurati. |

## Accesso web: risultati osservati

| Prova reale | Risultato | Cosa dimostra |
| --- | --- | --- |
| ChatGPT autenticato, Chrome normale/background | **Completata, 23,5 s** | MCP prepara un diff, invia, salva e rilegge la stessa risposta; sorgente invariato. |
| ChatGPT anonimo, profilo nuovo | **Completata, 17,2 s** | Stesso percorso MCP, nessun cookie di sessione al controllo iniziale, pulsante login visibile. Nessuna verifica umana richiesta. |
| ChatGPT autenticato, headless | **Bloccato: `ACCESS_CHALLENGE`** | Nessun prompt inviato. Il login non rende disponibile headless. |
| ChatGPT anonimo, headless | **Bloccato: `ACCESS_CHALLENGE`** | Nessun prompt inviato. Non usare questa modalità per le review live attuali. |
| Claude anonimo | **Redirect a `claude.ai/login`** | Campo email e pulsanti di autenticazione; nessun composer o prompt inviato. |
| Claude autenticato | **Non verificato live** | Nessun profilo Claude autenticato disponibile per questa prova. Il percorso manuale del tool è coperto da fixture CLI/MCP; manca l'adapter automatico. |

`--background` minimizza una normale finestra: può comparire all'avvio e durante il caricamento degli allegati ZIP. Non equivale a headless e non promette invisibilità. I risultati sopra descrivono questa macchina/sessione, non tutti gli account o i paesi. La documentazione OpenAI descrive l'accesso anonimo come disponibile in modo non uniforme e riporta restrizioni geografiche; la prova qui è riuscita, ma non consente una promessa generale. [Documentazione ufficiale ChatGPT](https://help.openai.com/en/articles/9125172).

Claude distingue l'accesso tramite account e le condizioni per gli strumenti di terze parti. Il suo piano gratuito non equivale a una chat senza login. [Documentazione ufficiale Claude](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account).

### Upload ZIP

La prima prova reale è fallita dopo **137,5 s**, con `ATTACHMENT_UNCONFIRMED` e `submitted: false`: nessuna review spacciata per completata. L'interfaccia espone più input file, compresi foto/video. Il precedente fallback selezionava l'ultimo input, incompatibile con ZIP. La selezione ora verifica che il campo sia abilitato e accetti gli allegati; i campi disabilitati o riservati a media non devono riceverli. Una seconda prova ha mostrato che il campo generale può apparire prima che siano pronti i suoi eventi. La correzione completa attende una risposta del menu allegati prima di caricare e mostra temporaneamente Chrome durante l'upload, quindi lo minimizza prima di inviare. Un upload dall'esito incerto non viene ripetuto automaticamente.

Esito dopo la correzione completa: **review live completata in 29,6 s**, ZIP caricato, risposta salvata e sorgente invariato. Il browser è stato minimizzato di nuovo prima dell'invio. È verificato un piccolo archivio autenticato; non è una certificazione di archivi grandi o upload anonimi.

## Motori locali: prove complete tramite MCP

Ogni riga comprende discovery, richiesta, risposta finale salvata, rilettura MCP e controllo che il sorgente sia rimasto invariato. Sono tempi di una singola esecuzione, non un benchmark comparabile tra runtime.

| Runtime e modello | Tempo | Token input/output riportati | Esito della valutazione |
| --- | --- | --- | --- |
| Ollama — `qwen3:4b`, reasoning on | 17,5 s | 210 / 1.393 | Bug sull'array vuoto e correzione individuati. |
| llama.cpp — `giviloop-qwen3-4b` | 15,9 s | 210 / 1.351 | Bug e correzione individuati; generalizzazione eccessiva sulla conservazione di ogni comportamento. |
| LM Studio — `giviloop-qwen3-4b` | 29,8 s | 210 / 2.255, inclusi 2.078 di reasoning | Correzione giusta, spiegazione falsa: afferma che `reduce` su `[]` restituisce `undefined`. |
| MLX — `mlx-community/Qwen3-4B-4bit` | 9,6 s | 208 / 587 | Bug e correzione individuati; obiezione sul carattere non idiomatico della correzione non supportata. |
| DwarfStar | Nessuna review live | Non disponibili | Server non attivo; test nativo `ds4_test --server` passato. Adapter coperto dai test HTTP. Nessuna inferenza con pesi addestrati certificata su questo Mac da 24 GB. |

DwarfStar era già stato compilato e verificato con una fixture GPU sintetica: non è una prova della qualità di un modello. I requisiti dei pesi supportati e il limite hardware sono documentati nella [guida DwarfStar](dwarfstar.md).

## Qualità: cosa abbiamo davvero verificato

- **Somma:** riprodotto il `TypeError` dell'array vuoto e verificata la correzione nota su quattro casi. Nessun codice generato dal revisore è stato eseguito. La spiegazione di LM Studio è quindi smentita, pur essendo utile la patch proposta.
- **Affermazioni troppo ampie:** aggiungere uno zero iniziale non preserva ogni dettaglio degli array non vuoti: su `[-0]` cambia il segno dello zero, verificato con `Object.is`. Questo non invalida la correzione per il contratto di esempio, ma smentisce una garanzia assoluta sul comportamento.
- **Diff `takeLast`:** entrambi i percorsi ChatGPT hanno trovato la regressione `slice(-0)`, proponendo di ripristinare il controllo `count === 0`. Verificati sette casi della correzione nota, inclusi zero, conteggi positivi e negativi.
- **Controllo positivo e negativo:** due file neutrali, stesso contratto per uno sconto facoltativo. `a.ts` usa `percent || 10` e sbaglia con sconto zero; `b.ts` usa `percent ?? 10` e rispetta i cinque casi provati. Sia ChatGPT anonimo (19,6 s) sia Ollama (31,0 s, 357/2.458 token) hanno trovato il bug in A e non ne hanno inventato uno in B. La frase di Ollama secondo cui `??` sarebbe più sicuro per input non numerici non è dimostrata né pertinente al contratto.

Questi esempi dimostrano il funzionamento del trasferimento e la necessità di verificare le spiegazioni. Sono pochi casi sintetici; non misurano un tasso affidabile di falsi positivi, difetti sconosciuti scoperti in produzione o superiorità rispetto alla sola review dell'agente. La verifica è stata eseguita dall'agente/script esterno: GiviLoop non l'ha fatta automaticamente.

## Risparmio token: messaggio utilizzabile

**“Usa una seconda review senza aggiungere una chiamata API a consumo: chat web disponibile o modello locale, con la risposta riportata al tuo agente.”**

Se l'alternativa era pagare quella review tramite API, il percorso web ne evita i token API fatturati separatamente. Non rende gratuita l'inferenza: restano quote della chat, eventuale abbonamento, lavoro dell'agente e tempo. Una seconda opinione può aumentare i token totali. Non abbiamo misurato token web, consumo dell'abbonamento o denaro risparmiato; non va pubblicata una percentuale.

L'accesso anonimo non risolve le condizioni contrattuali. I termini europei di OpenAI includono il divieto di estrazione automatica degli output e si applicano anche all'uso personale non commerciale. Non esiste una conferma del provider che autorizzi l'adapter automatico di GiviLoop. [Termini ufficiali](https://openai.com/policies/eu-terms-of-use/) e [analisi dei costi/accessi](costs-and-access.md).

## Cosa manca o resta fragile

1. **Chat web:** DOM, disponibilità e challenge possono cambiare; headless non utilizzabile nelle prove. L'accesso anonimo non garantisce modelli, upload o quote dell'abbonamento.
2. **Claude:** supporto manuale, nessun trasferimento automatico. Lo schema MCP è stato corretto per non proporre `claude-web` tra i provider automatici disponibili.
3. **Modelli web specifici e reasoning lungo:** i test di selezione/fallimento sono coperti da fixture; questo audit non certifica un modello dell'abbonamento specifico o una generazione lunga.
4. **DwarfStar:** manca una review con un modello addestrato su hardware adeguato.
5. **Esperienza terminale:** dopo `Created ...` si vede poco avanzamento fino al risultato; gli stati sono sul disco ma mancano messaggi di progresso utili al nuovo utente.
6. **Double Check strutturato:** conferme/smentite sono ancora un workflow dell'agente, non un formato validato dal tool. L'accordo tra modelli non prova la correttezza.
7. **Misure di utilità:** mancano una base di confronto su diff reali, tempo umano risparmiato e riutilizzo da parte di sviluppatori esterni.

## Test riproducibili e copertura

Il controllo finale del pacchetto installato è passato: **145 test unitari, 21 test browser**, esempio di verifica riuscito e **zero vulnerabilità segnalate** nell'audit delle dipendenze di produzione. Le prove live hanno completato **nove review**: due diff web, quattro review locali della somma, due confronti dei file dello sconto e un archivio ZIP. La [CI](https://github.com/vgflutter/GiviLoop/actions/workflows/test.yml) verifica Node 20/22/24 su Linux/macOS e il pacchetto con browser su Linux; i suoi risultati sono separati dalle prove live dei provider.

Le prove automatiche coprono CLI/MCP, preparazione Git e archivi, associazione richiesta/risposta, trasferimento manuale con clipboard simulata, limiti del contesto, redazione dei segreti, percorsi/symlink, adapter HTTP locali, reasoning e output incompleti, cancellazione, profili occupati, chiusura Chrome, challenge ripetute e selezione del modello. I nuovi casi browser verificano chat anonima con pulsante login, login wall, campi media incompatibili e invio singolo dopo upload confermato. La simulazione del sito non certifica l'accesso al servizio reale.

La prima CI con i nuovi test background ha rilevato un requisito dell'ambiente Linux: Xvfb da solo non gestisce la minimizzazione delle finestre. Due casi sono falliti con `BACKGROUND_UNAVAILABLE`. Il workflow ora installa Openbox e verifica che il gestore finestre sia pronto; i test e i controlli di minimizzazione restano attivi.

```sh
npm run test:package -- --browser
node scripts/live-e2e.mjs --web --output .giviloop/diagnostics/my-authenticated-test
node scripts/live-e2e.mjs --web \
  --browser-profile "$HOME/.giviloop/browser-profiles/chatgpt-anonymous" \
  --output .giviloop/diagnostics/my-anonymous-test
node scripts/live-e2e.mjs --local --output .giviloop/diagnostics/my-local-test
```

I comandi live inviano codice sintetico e consumano le normali quote/risorse. Quello locale richiede i quattro runtime/modelli della tabella. Il profilo anonimo deve essere nuovo o comunque privo di login; il nome della cartella non forza il logout. Le evidenze di questa esecuzione sono in `.giviloop/diagnostics/capabilities-2026-09-22/`, escluse da Git e dal pacchetto.

## Ha valore? Come proporlo alla community

**Valutazione: sì a un pilot mirato, non ancora a promesse di automazione universale o risparmio percentuale.** Il valore oggi è ridurre i passaggi di contesto e tenere richiesta/review/stato associati, lasciando scegliere un revisore web o locale. La sola “review con un altro modello” non basta a distinguerlo: strumenti come [CodeRabbit CLI](https://docs.coderabbit.ai/cli) già offrono review locali e passaggio dei risultati agli agenti. La differenza da dimostrare è un workflow piccolo, ispezionabile, con runtime scelto dall'utente e prove dei rilievi accettati o scartati.

Proposta di messaggio: **“GiviLoop: una seconda opinione sul tuo codice, riportata al tuo agente per verificarla. CLI/MCP open source, modelli locali e flussi web, senza una nuova chiamata API a consumo.”** Accompagnarlo con la distinzione tra web manuale, adapter sperimentale e condizioni del provider.

Prima azione proposta: coinvolgere 5–10 sviluppatori che già usano un agente, chiedere una prova su un loro diff e osservare chi torna per una seconda review. Confrontare almeno dieci modifiche, includendo casi corretti, con il workflow abituale e con copia/incolla manuale. Raccogliere tempo attivo, problemi di installazione, bug confermati, falsi positivi, costi osservabili e ragioni del riutilizzo; sorgenti privati e credenziali restano fuori dal report.

Poi una demo di circa un minuto con un rilievo confermato e una spiegazione sbagliata smentita, una pagina di risultati e un invito a contribuire con esperienze riproducibili. Un eventuale Show HN deve presentare qualcosa che si possa provare davvero, secondo le [linee guida ufficiali](https://news.ycombinator.com/showhn.html). Nessun annuncio, messaggio o campagna è stato pubblicato da questo audit.
