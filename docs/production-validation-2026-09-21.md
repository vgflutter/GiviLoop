# GiviLoop 0.3.0-rc.1: motori locali e verifica del browser

**Aggiornamento successivo:** [0.3.0-rc.2 risolve il 403 osservato con Chrome nativo](chatgpt-403-resolution-2026-09-21.md), con due review CLI/MCP autenticate e complete. Il rapporto seguente conserva i risultati precedenti; headless e validazione di modelli web specifici rimangono separati.

Verifica del 21 settembre 2026, macOS arm64 su M5 Pro con 24 GiB. Questa versione aggiunge **llama.cpp, LM Studio e MLX** a Ollama e DwarfStar, con CLI/MCP, discovery del modello e verifiche specifiche per ogni runtime. La distinzione tra trasporto riuscito e review corretta è stata mantenuta in tutte le prove.

Il core e i percorsi locali hanno un pacchetto installabile e prove automatiche ripetibili. Il rilascio complessivo resta **0.3.0-rc.1**: l'automazione ChatGPT è ancora bloccata dal sito nella sessione reale; MLX dichiara il proprio server sperimentale; DwarfStar non è stato verificato con pesi addestrati su questo hardware. Non è stata pubblicata una versione stabile npm/GitHub.

## Il 403 e il tap umano

La causa immediata osservata è una pagina Cloudflare, identificata dall'header `cf-mitigated: challenge`. Il login rimane leggibile. L'utente ha completato il tap, ma il sito ha continuato a presentare verifiche. Dopo la chiusura e riapertura, il cookie `cf_clearance` è presente e leggibile, con scadenza futura; il sito continua comunque a rispondere con una challenge.

È stata provata anche una configurazione minimale dei flag Chrome, mantenendo dichiarata l'automazione e senza alterare user agent o navigator: la challenge è rimasta. Nessun prompt è stato inviato nelle prove bloccate. Nessun valore di cookie, token o contenuto della cronologia è stato incluso nei report.

Queste evidenze escludono che basti conservare il cookie per garantire «un solo tap per sempre» in questa sessione. Il sito decide se accettare il browser; la scadenza del cookie non attesta accesso garantito. [Identificazione delle challenge](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/), [persistenza e accettazione della verifica](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/challenge-passage/).

La gestione nel prodotto ora comprende:

- `givi browser check`: controllo del profilo e dell'accesso senza preparare o inviare una review; distingue sessione, cookie della verifica e compositore utilizzabile.
- Attesa del tap nella stessa finestra e nella stessa richiesta, fino a tre minuti per default. `--verification-wait-ms` / MCP `verificationWaitMs` consente 0–900.000 ms; headless accetta solo zero.
- Una review in background mostra temporaneamente la finestra e la minimizza di nuovo dopo la verifica. Nessun clic di verifica è eseguito automaticamente.
- Riconoscimento sia dell'header sia della challenge nel DOM. Dopo tre documenti nuovamente sottoposti a challenge durante l'attesa, `ACCESS_CHALLENGE_LOOP` interrompe il ciclo senza ripetere invii.
- Sandbox Chrome attiva: eliminato il flag predefinito Playwright `--no-sandbox` visto nello screenshot. Conservato il portachiavi nativo, corretto nella versione precedente.
- Controllo dell'origine dopo la navigazione e prima di trasferire testo/allegati o premere Invio. Una pagina estranea non riceve il contesto della review.
- Cancellazione della richiesta MCP con chiusura del contesto posseduto, stato persistito e rilascio del lock. Il timeout del client MCP deve consentire l'attesa prevista, altrimenti annulla la richiesta.

La ripresa dopo verifica è stata validata con un browser reale e pagine controllate. Questo verifica il codice; non dimostra che Cloudflare abbia accettato la sessione reale. Modelli dell'abbonamento e reasoning web lungo restano da verificare dopo il ripristino dell'accesso da parte del provider. Il tema contrattuale resta distinto e [documentato](accesso-provider.md).

Evidenze locali: `.giviloop/diagnostics/production/web-access-probe.json`, `web-standard-flags-probe.json`, `web-after-user-tap.json`, `web-sandbox-check.json`. Nessun profilo viene resettato o cancellato automaticamente.

Il marker Chrome `Crashed` è stato isolato su profili temporanei: una prima chiusura cooperativa salva `Normal`; dopo un arresto forzato intenzionale del solo processo di prova, il marker resta `Crashed` anche dopo tre riaperture e chiusure con exit code zero. La diagnosi chiarisce quindi che la preferenza può riferirsi a un crash precedente. Non è stata falsificata o riscritta per nascondere il problema. Il test browser del cookie controlla anche `Normal` su un profilo nuovo; evidenze in `browser-shutdown-comparison.json` e `browser-crash-marker-repro.json`.

## Review reali tramite i nuovi motori

Per ogni motore è stato eseguito un `ask` CLI su `sum.ts` e un `givi_ask_local_llm` MCP su `tail.ts`, usando i contratti `sum([]) = 0` e `takeLast([1,2,3],0) = []`. Richieste e risposte sono state salvate nelle run; i sorgenti sono rimasti invariati. Le correzioni sono state controllate indipendentemente.

| Motore e configurazione | CLI: secondi, input/output | MCP: secondi, input/output | Qualità osservata |
| --- | --- | --- | --- |
| llama.cpp 0.4.1, Qwen3 4B GGUF, thinking del modello | 39,96 s; 201/3.138 | 48,29 s; 212/3.705 | Entrambi i difetti e le correzioni corretti. |
| LM Studio headless, llmster 0.0.25-1, runtime llama.cpp 2.41.0, stesso GGUF | 38,74 s; 201/1.977 | 63,13 s; 212/3.346 | Entrambi i difetti e le correzioni corretti. Token reasoning separati comunicati: 1.668 e 2.896. |
| MLX-LM 0.31.3, Qwen3 4B 4bit, thinking disattivato | 7,36 s; 203/302 | 5,54 s; 214/349 | **Entrambe le review errate**, nonostante il completamento tecnico. |
| MLX-LM 0.31.3, stesso modello, thinking attivo e sampling Qwen | 10,35 s; 199/832 | 16,08 s; 210/1.360 | Entrambi i difetti e le correzioni corretti; alcune raccomandazioni accessorie errate. |

Budget: contesto 16.384; output massimo 8.192 per i profili con thinking, 4.096 per la prova MLX senza thinking; deadline 180 s. Per MLX il contesto è un budget conservativo del client, non una capienza server attestata dall'API. Le prove sono sequenziali. I tempi non sono un benchmark controllato di prestazioni: token generati, formato dei pesi e configurazioni differiscono.

I test suggeriti dai modelli non erano sempre adeguati: llama.cpp ha trovato `slice(-0)` ma proposto casi che passavano anche sul codice difettoso; è stata aggiunta la regressione su array non vuoto e `count=0`. MLX ha proposto avvertenze non giustificate e una scorciatoia con `Math.max` che non risolve il bug. Per questo una risposta completa resta un consiglio da valutare, non una patch automaticamente certificata.

La prova MLX senza thinking è conservata, non rimossa dai risultati: il profilo lasciato per la prova usa thinking attivo, temperatura 0,6, top-p 0,95 e top-k 20. Il campo separato di reasoning non viene inserito nella review. Il server MLX upstream si dichiara **non raccomandato per produzione**: la compatibilità funziona, il suo stato sperimentale resta esplicito. [Guida dei tre motori](local-engines.md).

Ollama rimane disponibile, con le precedenti prove reali di CLI/MCP descritte nel [rapporto 0.2](local-inference-validation-2026-09-21.md). Non è stato misurato un risparmio economico o energetico, né dimostrata equivalenza con modelli web avanzati.

Evidenze: `.giviloop/diagnostics/production/engine-roundtrips-summary.json` e directory `llama-cpp-roundtrip`, `lmstudio-roundtrip`, `mlx-roundtrip`, `mlx-thinking-roundtrip`, con risposte finali, metriche e verifiche indipendenti.

## Un difetto trovato provando codice GiviLoop reale

Una review aggiuntiva su `src/run-lock.ts` ha rivelato un problema nella preparazione del contesto: la vecchia redazione trattava `const token = randomUUID()` come un segreto e alterava anche `.token === token`. Il modello riceveva codice modificato e segnalava un token hardcoded inesistente. Il completamento dell'inferenza era riuscito, ma il rilievo era falso.

CLI e MCP ora condividono la stessa redazione, con il percorso del file disponibile. Le espressioni e i confronti del codice sono preservati; i literal sensibili e i valori scalari nei formati di configurazione continuano a essere mascherati. Test mirati controllano sia il testo preparato sia la conservazione dei sorgenti originali. Rimane una protezione euristica, non uno scanner completo di segreti. L'evidenza della review iniziale è conservata in `.giviloop/diagnostics/production/mlx-real-code-review`.

La stessa review è stata ripetuta con MLX dopo aver verificato che il request contenesse il sorgente byte per byte: 45,67 s di chiamata, 562 token di input e 3.542 di output. Il falso rilievo sul token hardcoded è scomparso. La risposta riconosce creazione esclusiva e controllo UUID, ma contiene ancora affermazioni accessorie inesatte sul rilascio di un lock con token diverso. Nessuna patch suggerita è stata applicata automaticamente. Risposta, hash e verifiche sono in `.giviloop/diagnostics/production/mlx-real-code-review-after-redaction`.

## DwarfStar: prova nativa sul Mac

Il binario originale del commit `0aaea5a238fb41a35106a551e73c8409dfb751ac`, compilato con Metal, è stato avviato con un GGUF sintetico da 144 MB nella forma mini esplicitamente supportata dal codice upstream. Sono stati eseguiti caricamento dei pesi, GPU, HTTP e adapter GiviLoop reali.

Una fixture è stata progettata per produrre `SYNTHETIC_TEST_ONLY` seguito da EOS: l'adapter ha completato in 49 ms con 55 token di input e un token di output. Una variante terminata per limite è stata rifiutata. **Il testo era progettato nella fixture: non è un modello addestrato né una review.** La prova chiude il controllo del percorso nativo su questo Mac, non quello della qualità di inferenza DwarfStar.

I modelli addestrati documentati richiedono risorse superiori a una configurazione verificata sui 24 GiB disponibili. Nessun download enorme o disattivazione dei controlli di memoria è stato effettuato. Il server sintetico è stato fermato per non lasciarlo disponibile come revisore. Generatore, manifest, comandi ed evidenze restano in `.giviloop/diagnostics/production/dwarfstar-synthetic-*` e `make-dwarfstar-synthetic.py`. [Dettagli e requisiti](dwarfstar.md).

## Verifiche ripetibili e distribuzione

Le suite coprono tutti e cinque i provider con endpoint HTTP controllati e processi CLI/MCP reali: identità del modello, budget, reasoning supportato, risposte incomplete, timeout/cancellazione, rifiuto di endpoint remoti/redirect, lock, associazione della risposta e conservazione di un risultato precedente. I test browser includono cookie nativi, sandbox, challenge, ripresa della stessa richiesta, invio singolo e cancellazione MCP.

I conteggi finali sul pacchetto installato, il risultato di `npm audit`, la piattaforma, l'elenco dei file e lo SHA-256 sono registrati da `npm run test:package -- --browser` in `.giviloop/releases/release-checks.json`; i TAP sono accanto al rapporto. La suite viene eseguita anche con Node 20/22/24 sul Mac. La CI Linux/macOS è configurata; i test headed Linux usano Xvfb e Chrome con sandbox. Nessuna esecuzione remota è attestata qui.

Tarball: `.giviloop/releases/giviloop-0.3.0-rc.1.tgz`. Il controllo di packaging impone la presenza delle guide distribuite e rifiuta file estranei. Profili, cookie, GGUF, cache dei modelli, diagnostica e codice upstream sono esclusi.

## Installazioni lasciate disponibili

- Ollama: `127.0.0.1:11434`, modello `qwen3:4b`, cloud disabilitato.
- llama.cpp: `127.0.0.1:8080`, alias `giviloop-qwen3-4b`, un solo slot, contesto 16.384, offline e senza context shift.
- LM Studio headless: `127.0.0.1:1234`, istanza `giviloop-qwen3-4b`, contesto 16.384, LM Link disabilitato. Il modello usa un link al GGUF esistente.
- MLX-LM: `127.0.0.1:8081`, modello `mlx-community/Qwen3-4B-4bit`, cache completa e `HF_HUB_OFFLINE=1`. Download aggiuntivo circa 2,28 GB; venv isolato in `~/.giviloop/runtimes/mlx/venv`.

I due runner GGUF riutilizzano il blob Ollama originale senza modificarlo o duplicarlo. Nessun avvio automatico al login è stato configurato. I comandi e i PID di questa sessione sono nei file `*-runtime.json` della diagnostica; non sono identificatori persistenti dopo un riavvio.

Per l'adozione della community, il percorso concretamente verificato è una review locale con modello esplicito, contesto selezionato e controllo delle correzioni. La promozione globale a stabile richiede ancora CI remota, una review DwarfStar con pesi addestrati su hardware adeguato e accesso web accettato/autorizzato per i test dell'abbonamento. L'aggiunta di motori non rende automaticamente stabili queste dipendenze esterne.
