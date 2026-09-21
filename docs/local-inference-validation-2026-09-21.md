# GiviLoop 0.2.0-rc.1: inferenza locale e verifica del login

Rapporto storico. La [validazione 0.3.0-rc.1](production-validation-2026-09-21.md) aggiunge altri runtime, prove native DwarfStar e gestione della verifica umana nel browser.

Prove del 21 settembre 2026 su macOS arm64, Apple M5 Pro con 24 GiB di memoria. Ollama e DwarfStar sono stati implementati da due agenti distinti e integrati nella CLI e nel server MCP. Il ciclo automatico con **Ollama e pesi reali è riuscito**. DwarfStar è compilato e verificato a livello di protocollo; mancano le prove con pesi reali su hardware adeguato. L'accesso autenticato a ChatGPT è stato recuperato, ma le successive navigazioni automatiche hanno ricevuto HTTP 403.

La versione resta una release candidate: questi risultati non giustificano una dichiarazione di produzione stabile per tutti i percorsi. Il pacchetto è installabile e il percorso locale Ollama è disponibile per prove della community, entro i limiti misurati sotto.

## Funzioni consegnate

- CLI: `ask` e `send` con `--send ollama|dwarfstar`; `models` e `doctor --provider` per verificare il runtime.
- MCP: `givi_local_models`, `givi_ask_local_llm`, `givi_send_to_local_llm`, oltre ai sette strumenti esistenti.
- Scelta esplicita del modello, budget di contesto/generazione, reasoning e deadline; nessun download o fallback verso un provider remoto automatico.
- Connessioni dirette a loopback, rifiuto di redirect e credenziali negli URL, verifica dei metadati Ollama per rifiutare modelli cloud prima dell'invio del codice.
- Stesso formato di run, contesto selezionato e review marcata come contenuto esterno non fidato. I runtime locali accettano testo, non allegati ZIP.
- Lock condiviso tra browser e runtime locali, cancellazione da CLI/MCP, conservazione della risposta precedente se la nuova generazione fallisce o risulta incompleta.
- Stato, durata, modello e token comunicati dal runtime in `local-status.json` e `local-usage.json`. Gli hash di richiesta e risposta permettono di verificare l'associazione con il testo salvato; una scrittura su disco fallita non vale come completamento.

## Verifiche automatiche

| Verifica | Risultato e copertura |
| --- | --- |
| Suite unità e integrazione, Node 20.20.2 / 22.21.1 / 24.21.0 | **87 test passati** per versione su macOS. Include CLI e client/server MCP reali con endpoint HTTP locali controllati. |
| Browser reale su pagine controllate | **9 test passati**: ciclo CLI/MCP, upload, modello richiesto, fallback dichiarato, risposta incompleta e persistenza dei cookie nel portachiavi nativo. |
| TypeScript | Compilazione e controllo aggiuntivo di simboli/parametri inutilizzati riusciti. |
| DwarfStar upstream | Compilazione Metal di `ds4-server` e `ds4_test`; `./ds4_test --server` riuscito. |
| Distribuzione | `npm run test:package -- --browser` installa il tarball in un progetto vuoto ed esegue nuovamente le suite sul `dist` installato. Il rapporto di questa esecuzione, inclusi SHA-256, file, conteggi e audit, è in `.giviloop/releases/release-checks.json`. |

Le suite verificano anche timeout durante la lettura HTTP, cancellazione, risposte troncate, limite del corpo, URL remoti, redirect, metadati di modello incoerenti, mancata pubblicazione di reasoning separato e associazione della review alla run corretta. Non misurano la qualità generale dei modelli. La matrice CI Linux/macOS è configurata; nessuna esecuzione remota è attestata da questo rapporto.

## Ollama: prove con inferenza reale

Runtime **Ollama 0.34.2**, server locale con cloud disabilitato. Per la configurazione raccomandata in questa prova: `qwen3:4b`, `--reasoning on`, contesto 16.384, output massimo 8.192, deadline 300.000 ms e sampling predefinito del modello.

| Percorso | Durata completa | Input / output riportati | Esito |
| --- | --- | --- | --- |
| CLI `ask`, file `sum.ts` sintetico | 27,113 s | 201 / 2.173 | Individuato il `reduce` senza valore iniziale; proposta la correzione con zero. Risposta e uso salvati. |
| MCP `givi_ask_local_llm`, file `tail.ts` sintetico | 45,794 s | 211 / 3.586 | Individuato `slice(-0)` e proposto il caso esplicito `count === 0`. Review restituita all'agente e salvata. |
| Adapter, richiesta GiviLoop completa sui due file | 73,505 s | 278 / 5.367 | Entrambi i difetti individuati e correzioni minime corrette. |

I due difetti sono stati riprodotti indipendentemente; le correzioni delle prove CLI/MCP hanno superato **otto casi**. Il codice sorgente sottoposto a review è rimasto invariato. Un limite concreto della risposta: i confronti tra array erano scritti con `===` e letterali array, quindi non erano test JavaScript eseguibili corretti. I valori attesi sono stati verificati usando `assert.deepEqual`. Una review corretta sul difetto richiede comunque controllo delle patch e dei test suggeriti.

Le prove precedenti con `qwen2.5-coder:3b` hanno completato il trasporto ma mancato il bug `slice(-0)`. `qwen3:1.7b` ha trovato quel bug in un prompt diretto breve, ma ha esaurito il budget di generazione su richieste GiviLoop più complete, anche con 8.192 token. Quegli output incompleti sono stati rifiutati. È stato rimosso il forcing di temperatura zero: si conservano i default del modello, coerentemente con le [indicazioni Qwen sulla generazione thinking](https://huggingface.co/Qwen/Qwen3-1.7B#best-practices).

Questi sono piccoli casi noti, non un benchmark di equivalenza con modelli web avanzati. I contatori provengono dal runtime; non è stato inventato un conteggio separato del reasoning quando assente. Non sono stati misurati consumi energetici, risparmio economico o riduzione dei token dell'agente cloud che riceve la review.

Evidenze locali: `.giviloop/diagnostics/local-inference/local-live-roundtrips.json`, `local-live-quality.json`, `cli-live-response.md`, `mcp-live-response.md` e `ollama-wrapped-4b-default-sampling.json`.

## DwarfStar: cosa è stato verificato

Upstream ufficiale [antirez/ds4](https://github.com/antirez/ds4), commit `0aaea5a238fb41a35106a551e73c8409dfb751ac`. Compilazione Metal e test del server upstream riusciti; **17 test dell'adapter** e i flussi CLI/MCP con server HTTP controllati coprono il protocollo, la selezione del modello realmente caricato, i budget e gli errori.

Non è stata completata inferenza con pesi reali. I GGUF distribuiti e documentati sono molto più grandi dei modelli piccoli usati con Ollama: DeepSeek Flash Q2 occupa circa 81 GiB su disco e la configurazione SSD documentata parte da 64 GB; Qwen3.8 Flash Next Q2 richiede 41,73 GiB di pesi residenti, con file da 137,10 GiB e senza SSD streaming Qwen; GLM 5.3 Flash Q2 è circa 90 GiB. Il modello “mini” nel codice Qwen è una fixture sintetica, non un piccolo checkpoint addestrato. Fonti: [modelli](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/MODELS.md), [Qwen](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/QWEN38_FLASH_NEXT.md), [SSD streaming](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/SSD_STREAMING.md).

Non è dimostrata l'impossibilità fisica di qualsiasi esperimento GLM con streaming su 24 GiB; manca però una configurazione verificata che permetta di dichiarare il supporto live su questa macchina. Non sono stati scaricati quei pesi né disabilitati i controlli di memoria. Per chiudere questa verifica serve un host adeguato con un GGUF supportato e una review reale con correzione controllata. [Setup e limiti](dwarfstar.md).

## ChatGPT: login corretto, accesso automatico ancora negato

Sono stati corretti due problemi distinti:

1. `browser login` ora richiede una finestra nuova e massimizzata; su macOS usa LaunchServices e rileva errori immediati dell'avvio.
2. L'automazione usa il portachiavi nativo di Chrome, come il login normale. I precedenti default Playwright `--use-mock-keychain` e `--password-store=basic` rendevano il cookie di sessione illeggibile. Un test con cookie sintetico ha riprodotto la perdita con i vecchi default e confermato la persistenza con la correzione.

La verifica reale dopo il login ha trovato la sessione leggibile, il pulsante di login assente e la cronologia disponibile. Non sono stati acquisiti nei report valori di cookie o contenuti della cronologia. **Il login dell'utente è riuscito.**

Le successive navigazioni automatiche in modalità background, headless e visibile hanno però ricevuto **HTTP 403 prima dell'invio**. La prova visibile delle 19:37 UTC conferma che il problema non è limitato a headless. GiviLoop si è fermato senza inviare la richiesta. Non sono state applicate tecniche per nascondere l'automazione o aggirare la risposta del provider.

Per questo non sono validati il selettore reale dei modelli dell'abbonamento, una generazione autenticata con modello richiesto e il reasoning web lungo. Le precedenti prove anonime riuscite sono conservate nel [rapporto 0.1.0](release-readiness-2026-09-21.md), senza attribuirle ai modelli dell'abbonamento. Evidenze aggiornate: `chatgpt-native-keychain.json`, `keychain-regression.json`, `chatgpt-visible-check.json` nella directory diagnostica locale.

Il chiarimento contrattuale è un requisito separato: una prova tecnica, una licenza MIT o una dichiarazione di responsabilità individuale non stabiliscono l'autorizzazione del provider. Non è stata ottenuta una conferma scritta. I percorsi Ollama/DwarfStar non accedono al sito ChatGPT; restano applicabili le rispettive licenze e condizioni. [Nota sull'accesso](accesso-provider.md).

## Stato lasciato sulla macchina

Ollama è disponibile su `http://127.0.0.1:11434` con cloud disabilitato. Sono stati scaricati `qwen2.5-coder:3b`, `qwen3:1.7b` e `qwen3:4b`, per circa 5,79 GB, in `~/.giviloop/runtimes/ollama/models`. Non è stato configurato un avvio automatico al login. Per riavviare lo stesso runtime dopo un arresto:

```sh
OLLAMA_MODELS="$HOME/.giviloop/runtimes/ollama/models" \
  OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 ollama serve
```

Il sorgente e i binari DwarfStar compilati restano in `.giviloop/diagnostics/local-inference/dwarfstar-upstream`; nessun server DwarfStar con pesi è in esecuzione. Il profilo Chrome dedicato e il backup precedente sono conservati. Il tarball è `.giviloop/releases/giviloop-0.2.0-rc.1.tgz`; pesi, profili, cookie, diagnostica e checkout upstream sono esclusi dal pacchetto. Non è stata pubblicata una release npm/GitHub.

Per promuovere tutti i percorsi a stabili restano verifiche concrete: CI remota sui sistemi supportati, inferenza DwarfStar su hardware adeguato e accesso web autorizzato e funzionante con modello/reasoning autenticati. Intanto il valore già utilizzabile è una seconda review locale automatica, con contesto limitato, risultati verificabili e consumo misurato dal runtime.
