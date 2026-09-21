# GiviLoop: utilità, evoluzione e promozione

Analisi del 21 settembre 2026, svolta con Astra su richiesta dell'autore. Base: codice e README del repository, a partire dal commit `3f0ca2a`, e documentazione ufficiale consultata nella stessa data. Non sono stati eseguiti confronti sperimentali tra modelli né raccolti dati da utenti: i numeri proposti sotto sono criteri per esperimenti, non risultati o stime di mercato.

Obiettivo chiarito successivamente dall'autore: un progetto open source gratuito che trovi adozione, senza costruire un'attività commerciale. Il vantaggio economico cercato è per l'utilizzatore: meno lavoro ripetuto e, dove consentito, uso del reasoning già incluso nei propri abbonamenti. La strategia qui sotto è stata aggiornata a questo obiettivo; approfondimento contrattuale e prove reali sono nel [resoconto di validazione](validazione-web-e-costi-2026-09-21.md).

La modifica headless è stata implementata in parallelo: `--headless` nella CLI e nel playground, `headless: true` nei tool MCP, con modalità `auto`. Verificati build, 10 test esistenti, passaggio dei parametri CLI/MCP e un flusso con Chrome reale su una pagina locale, inclusa chiusura e indicazioni di recupero in assenza del campo di input. Le prove successive contro ChatGPT web e tramite Codex CLI sono documentate nel resoconto collegato sopra; includono una correzione al timeout e due ulteriori test.

Aggiornamento dell'implementazione: la versione 0.2.0-rc.1 aggiunge Ollama e DwarfStar via CLI/MCP, diagnostica, lock delle run e contatori del runtime. Il ciclo locale Ollama è stato provato con pesi reali; DwarfStar richiede ancora una prova su hardware adeguato. Le osservazioni sotto descrivono lo stato iniziale dell'analisi. Risultati aggiornati nella [validazione locale](local-inference-validation-2026-09-21.md). La proposta da sperimentare con la community diventa quindi «un secondo parere locale automatico, verificabile dal tuo agente»; il risparmio va misurato sul lavoro completo e non dedotto dalla sola assenza di una chiamata API a pagamento.

## La decisione

**GiviLoop ha senso come strumento personale e merita una validazione breve come progetto open source per sviluppatori. L'obiettivo è dimostrare un'utilità ripetuta e rendere la manutenzione sostenibile.**

Il problema iniziale è credibile: durante il lavoro con un agente, chiedere un secondo parere richiede preparare contesto, spostarlo altrove, recuperare la risposta e decidere quali osservazioni seguire. Il codice automatizza buona parte di questo percorso. Il punto debole è che anche i concorrenti restituiscono già revisioni locali agli agenti: non basta promettere di eliminare il copia e incolla.

L'opportunità più interessante è diventare **il ciclo locale e portabile per ottenere un secondo parere, verificarlo e conservare le decisioni**, scegliendo il revisore senza cambiare agente di sviluppo. È una direzione da costruire: oggi l'automazione è legata a ChatGPT web, mentre Claude è manuale.

La raccomandazione è dedicare il prossimo mese a un ciclo affidabile e a 10 utilizzatori reali. Prima di aggiungere altri browser o investire in pubblicità, misurare se il secondo parere produce abbastanza valore da far tornare le persone.

## Cosa esiste davvero

| Evidenza nel repository | Valore e limite |
| --- | --- |
| CLI `prepare`, `ask`, `archive`, `send`, `copy`, `ingest`; server MCP con sette strumenti | Si può usare dal terminale e richiamare dall'agente. La creazione dell'archivio è ancora solo nella CLI. |
| Run in `.giviloop/runs`, richieste e risposte Markdown, metadati e hash della richiesta; manifest e hash per gli archivi | Buona base per ricostruire che cosa è stato chiesto. Non equivale ancora a un registro completo di esecuzione e decisioni. |
| Modalità MCP `analyze-only` e `act`, risposta marcata come contenuto esterno non attendibile | Corretta separazione fra consiglio e decisione. Il comportamento viene richiesto all'agente tramite istruzioni; GiviLoop non applica né verifica direttamente le correzioni. |
| ChatGPT web tramite Playwright e profilo persistente; prompt Claude e fallback manuale | Funziona come ponte, ma non esiste ancora un insieme di provider automatici intercambiabili. |
| Omissioni, redazione di alcune forme di segreti, controlli sui percorsi, allowlist opzionale | Sono protezioni concrete, con test. Gli archivi non subiscono redazione del contenuto; l'allowlist non impostata consente il trasferimento. |
| Il diff è raccolto rispetto a `HEAD`; budget predefiniti di 40 KB per file e 400 KB complessivi; archivio di 2 MB prima della compressione | Adatto a cambiamenti contenuti. Non è ancora una revisione esplicita dell'intera branch rispetto alla sua base. Parti rilevanti possono essere escluse per budget. |
| Conservazione delle ultime 10 run | Utile per uso personale; insufficiente come storico durevole di decisioni di un team. |

Riferimenti locali: [README](../README.md), [CLI](../src/cli.ts), [MCP](../src/mcp-server.ts), [provider web](../src/providers/chatgpt-web.ts), [controllo trasferimenti](../src/providers/external-transfer.ts), [test esistenti](../test/cli-security.test.mjs). Non era presente una directory `.giviloop` locale da cui ricavare analisi precedenti o metriche d'uso.

Tre benefici restano ipotesi: risparmio complessivo di token, riduzione dei bug e maggiore qualità dovuta al modello esterno. Il packaging evita di far riscrivere tutto all'agente, ma il revisore deve comunque consumare quel contesto e il primo agente deve leggere il feedback. Un modello diverso non garantisce errori indipendenti; un'altra sessione dello stesso modello può già essere una baseline utile.

## Concorrenza: lo spazio è più stretto di quanto sembri

| Alternativa verificata | Cosa copre già | Conseguenza per GiviLoop |
| --- | --- | --- |
| Codex | `/review` avvia un revisore dedicato; permette revisioni rispetto a una branch base o su modifiche non committate. [Documentazione ufficiale](https://learn.chatgpt.com/docs/code-review) | Per chi usa già Codex, una review separata non richiede necessariamente un altro strumento. Bisogna dimostrare il valore aggiunto del revisore scelto e del percorso completo. |
| GitHub Copilot | Revisioni di PR, selezioni di codice e modifiche locali non committate, con suggerimenti applicabili nell'IDE. [Documentazione ufficiale](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review) | «Trova problemi prima del commit» non distingue GiviLoop. |
| CodeRabbit CLI | Review locali, output per agenti, risultati salvati e integrazioni con agenti di sviluppo. [Documentazione ufficiale](https://docs.coderabbit.ai/cli) | È il concorrente più vicino al ciclo review → agente → fix. Anche MCP, CLI e persistenza dei risultati non sono un vantaggio esclusivo. |
| Cursor Bugbot | Revisione delle PR e analisi dell'attività e dei risultati delle review. [Documentazione ufficiale](https://cursor.com/docs/bugbot) | Un bot generalista per PR richiederebbe competere su integrazione, qualità e affidabilità con un prodotto già articolato. |
| Copia/incolla o un piccolo script | Permettono già un secondo parere occasionale con uno sforzo di configurazione limitato | La semplicità iniziale e la frequenza reale d'uso contano più del numero di funzioni. Questa è una valutazione di prodotto, non un confronto misurato. |

**La differenziazione plausibile combina scelta del revisore, controllo del contesto e tracciabilità della decisione.** Nessun singolo elemento costituisce oggi una barriera forte alla concorrenza. Una raccolta pubblica di casi riproducibili, integrazioni curate e fiducia nella gestione del codice sarebbero più difendibili di un insieme di selettori del browser.

Il confronto non dimostra che un concorrente sia più preciso: le pagine ufficiali descrivono funzionalità, non risultati comparabili sullo stesso campione.

## Browser silente e sostenibilità dei provider

Headless è un miglioramento di comodità: elimina la finestra durante l'automazione. Non rende l'esecuzione un servizio affidabile in background e non cambia le autorizzazioni del provider. Login scaduto, selezione del modello, upload, interfaccia variabile e rilevamento del termine della generazione rimangono dipendenze operative. Il primo accesso può richiedere il browser visibile; le modalità che attendono l'intervento dell'utente vanno distinte dall'esecuzione automatica.

Esiste inoltre un vincolo concreto di distribuzione. I termini OpenAI per Europa, Svizzera e Regno Unito vietano l'estrazione automatica o programmatica di dati/output; servizi business e API hanno accordi distinti. Il salvataggio automatico delle risposte web è quindi una base da non presumere autorizzata per il prodotto. [Termini ufficiali OpenAI](https://openai.com/policies/eu-terms-of-use/)

I termini consumer Anthropic vietano l'accesso automatico salvo API key o autorizzazione esplicita. Per questo aggiungere Claude web non dovrebbe essere la prossima priorità. L'applicabilità concreta dipende dal servizio e dall'accordo dell'account: il README non può risolverla con una nota generica. [Termini ufficiali Anthropic](https://www.anthropic.com/legal/consumer-terms)

La scelta di prodotto consigliata è mantenere export/import manuale e sviluppare prima un trasporto documentato: API con credenziali dell'utente oppure una CLI ufficiale, rispettandone autenticazione, limiti e modalità d'uso. Per esempio `codex exec` documenta esecuzione non interattiva, output strutturato e riutilizzo dell'autenticazione CLI. Ciò ne fa un candidato tecnico per un adapter; non implica equivalenza con i modelli o le funzioni della chat web, né assenza di costi o limiti. [OpenAI Docs: esecuzione non interattiva](https://learn.chatgpt.com/docs/non-interactive-mode)

Non costruire il messaggio promozionale su «API gratis tramite abbonamento» o su automazione invisibile al provider. La promessa deve essere la qualità del percorso di revisione, con un accesso supportato e sostenibile.

## Evoluzione tecnica che serve al prodotto

**1. Rendere affidabile il significato di “review completata”.** Nel codice inizialmente esaminato `waitForFinalAssistantResponse` restituiva l'ultimo testo al timeout anche se la risposta non era terminata; il chiamante lo salvava come risposta ordinaria. Questo falso successo è stato riprodotto e corretto nelle prove successive: ora il timeout genera un errore. Restano proposti esiti espliciti `completed`, `partial`, `failed`, `needs-auth`, durata ed errore, e la conservazione separata del testo parziale senza presentarlo come revisione conclusa.

**2. Legare il feedback al codice effettivamente analizzato.** Registrare base commit, hash del diff e dei file inclusi, versione del prompt, provider, modello richiesto e modello confermato quando verificabile. Prima di proporre l'applicazione, confrontare lo stato corrente con lo snapshot. Lo stesso `HEAD` non basta se il working tree è cambiato. La modifica può richiedere una nuova review o una rivalutazione mirata, senza dichiarare attuale un parere vecchio.

**3. Scegliere un percorso principale piccolo.** Per l'uso frequente: domanda o diff mirato, con i test e le definizioni necessarie. L'archivio completo resta utile per analisi di architettura e onboarding, ma non dovrebbe essere la via ordinaria per ogni correzione. Aggiungere una base Git esplicita e mostrare subito i file esclusi. Non promettere di aver controllato “il repository” quando ne è stato inviato un sottoinsieme.

**4. Conservare le decisioni, non soltanto il testo.** Ogni finding dovrebbe avere posizione, scenario che fallisce, evidenza, impatto, eventuale contesto mancante e stato `accepted/rejected/deferred`. La confidenza del modello può aiutare a ordinare, ma non è una probabilità calibrata. Alla chiusura registrare motivazione, fix e verifica effettuata. Sostituire il verdetto generale `safe` con “nessun problema rilevato nel contesto esaminato”: una review non certifica il software.

**5. Unificare il motore condiviso e introdurre un solo adapter supportato.** Packaging, budget, prompt e run sono in parte duplicati fra CLI e MCP. Portarli in moduli comuni riduce la possibilità di comportamenti differenti. Separare raccolta del contesto, trasporto e gestione del risultato; poi aggiungere un provider e verificarlo. Non costruire subito un framework per dieci provider.

**6. Rendere semplice un uso quotidiano controllato.** Proporre comandi futuri `doctor`, `status`, `review --base ...` e una configurazione per repository. Rendere visibili destinazione, contenuti e omissioni, ricordando la configurazione già scelta senza introdurre conferme ripetitive. Servono inoltre un lock sul profilo browser, selezione esplicita della run e conservazione configurabile prima di supportare più esecuzioni concorrenti. Valutare uno scanner locale dei segreti; non chiamare “privato” un flusso che invia sorgenti a un provider esterno.

Questi sono interventi proposti, non funzionalità già implementate. Il contenuto esterno deve continuare a essere trattato come dato non attendibile; il feedback non deve poter ampliare autonomamente lo scope delle modifiche o autorizzare altri trasferimenti.

## Pubblico iniziale e proposta

Il primo pubblico da cercare è composto da sviluppatori indipendenti e piccoli team che usano già un agente ogni giorno, chiedono già secondi pareri e vogliono scegliere un revisore diverso o conservare meglio le decisioni. È un segmento da verificare attraverso interviste e uso osservato, non una domanda già dimostrata.

Una formulazione utile per il prodotto attuale:

> GiviLoop prepara il contesto del tuo codice, lo porta a un revisore esterno e restituisce il parere al tuo agente, con richiesta e risposta salvate localmente.

Per la direzione futura, dopo averla implementata:

> Un secondo parere sul codice del tuo agente. Scegli il revisore, verifica i rilievi e conserva perché hai accettato o scartato ogni correzione.

Il caso dimostrativo migliore è concreto: l'agente implementa un rimborso; la review individua un caso di doppia esecuzione; l'agente riproduce il problema, accetta un suggerimento e ne scarta uno non pertinente; un test conferma la correzione. Un esempio preparato va dichiarato come tale. Solo un caso reale e verificato giustifica la frase “ha trovato un bug sfuggito al primo passaggio”.

Non partire da grandi aziende, audit regolamentati o promesse di sicurezza: richiedono controlli, contratti e affidabilità che la V0 non offre. Anche chi usa già con soddisfazione una review integrata può semplicemente non avere bisogno di GiviLoop.

## Come promuoverlo, concretamente

Prima creare tre materiali: una demo di 60–90 secondi che mostri l'intero ciclo, un quickstart provato da una persona esterna e un caso con diff iniziale, risultato, decisioni e test finale. Le due demo già nel README sono una buona base; verificarne chiarezza e durata con i primi tester.

| Canale/azione proposta | Contenuto da portare | Segnale da misurare |
| --- | --- | --- |
| Rete personale e comunità di sviluppatori | Invito individuale a provare una review su un task vero; autore chiaramente dichiarato | Quanti completano una prima run e tornano su un altro task |
| Repository GitHub | README breve, un percorso principale, esempio dei risultati, limiti chiari, installazione riproducibile | Passaggio da visita o installazione a prima review utile; le stelle sono secondarie |
| Comunità di agenti/MCP, post tecnici e video | Caso riproducibile con un finding utile e uno respinto; spiegazione del costo di configurazione | Richieste concrete, utilizzo successivo e problemi ricorrenti |
| Show HN o lancio più ampio | Demo verificabile, spiegazione franca del confronto con review native e CodeRabbit | Utenti attivati e ritorno dopo due settimane |
| Piccoli team pilota | Due settimane su un flusso esistente, con obiettivi concordati | Tempo netto risparmiato, ritorno spontaneo e problemi riproducibili segnalati |

Sono canali da sperimentare, non affermazioni sulla loro conversione attuale. Prima di pubblicare, verificare le regole del canale. Nessun messaggio o lancio è stato effettuato nell'ambito di questa analisi.

Non investire ora in annunci: senza dati di attivazione e ritorno pagheresti soprattutto per scoprire problemi di onboarding. Un eventuale test pubblicitario successivo può avere un budget massimo prefissato e una metrica di costo per utilizzatore ricorrente, non per clic.

## Adozione open source e manutenzione

Mantenere il progetto MIT, eseguibile localmente e con l'accesso al provider gestito dall'utilizzatore. Non servono un servizio centrale, una fatturazione dell'inferenza o funzionalità riservate a clienti paganti. Servono installazione riproducibile, pochi percorsi affidabili, esempi utili e limiti documentati.

Misurare prima review completate, ritorno spontaneo, tempo attivo risparmiato e qualità dei rilievi verificati. Poi cercare contributori che portino casi riproducibili, correzioni ai provider e documentazione. Le stelle GitHub possono aiutare la scoperta, ma non dimostrano uso reale.

La promessa di risparmio va verificata sul percorso completo: una review esterna consuma comunque contesto e reasoning, e l'agente iniziale deve leggere il risultato. Il beneficio può essere una minore spesa marginale o meno lavoro dell'agente principale; non è automaticamente una riduzione dei token totali. La modalità headless cambia la visibilità del browser, senza modificare questo bilancio. Accesso incluso nell'abbonamento e autorizzazione all'automazione sono due verifiche distinte.

## Validazione e priorità 30/60/90 giorni

Misurare separatamente il vantaggio del modello e quello del prodotto. Su circa 20 cambiamenti rappresentativi confrontare: review nativa dell'agente; stesso secondo revisore usato manualmente; stesso revisore tramite GiviLoop. Mantenere comparabile il contesto e alternare l'ordine dei casi. Separare bug realmente noti, casi sintetici dichiarati e codice senza un problema noto. Il confronto è esplorativo, non una dimostrazione statistica di superiorità.

Per ogni run registrare completamento, interventi manuali, minuti attivi dell'utente, latenza totale, costo osservabile, finding verificati, falsi positivi e decisioni. Un suggerimento accettato non è automaticamente corretto: cercare un test, una riproduzione o una valutazione tecnica motivata. Misurare anche i casi in cui la review non aggiunge valore.

| Periodo | Lavoro prioritario | Criterio di decisione proposto |
| --- | --- | --- |
| Giorni 1–30 | Headless come comodità; esiti completi/parziali; un percorso principale; 10 tester; baseline su 20 cambiamenti; scelta e prova di un trasporto supportato | Obiettivo iniziale: almeno 8 tester completano una run senza assistenza e almeno 5 tornano spontaneamente nella seconda settimana. Sono soglie interne da concordare, non benchmark di mercato. |
| Giorni 31–60 | Snapshot verificabili, finding e decisioni strutturati, moduli condivisi, adapter supportato; 2–3 team pilota | Puntare ad almeno il 95% di run completate senza interventi sul trasporto supportato, dichiarando campione e intervallo; trovare un vantaggio ripetuto rispetto alla review nativa in qualità oppure tempo attivo. |
| Giorni 61–90 | Pubblicare casi verificati, semplificare installazione, aggiungere guida ai contributi e promozione mirata | Proseguire con le funzionalità richieste da utilizzatori ricorrenti e cercare almeno un contributore esterno. Se il bisogno è sporadico, mantenere una piccola utility affidabile senza moltiplicare provider e manutenzione. |

La scelta più importante non è quanti provider aggiungere. È capire se gli utenti vogliono davvero un revisore separato e se GiviLoop rende quel passaggio abbastanza affidabile e utile da ripeterlo. Se la risposta è sì, il browser diventa uno dei trasporti; il prodotto diventa il percorso dal dubbio alla decisione verificata.
