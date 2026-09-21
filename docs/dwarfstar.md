# DwarfStar locale

GiviLoop supporta il server HTTP di [DwarfStar di antirez](https://github.com/antirez/ds4), repository ufficiale `antirez/ds4`. L'adapter usa `GET /v1/models` e `POST /v1/chat/completions`, su un indirizzo loopback. Non avvia un browser e non richiede un account ChatGPT.

L'integrazione è stata verificata sul codice upstream al commit `0aaea5a238fb41a35106a551e73c8409dfb751ac`, il 21 settembre 2026. Il server evolve rapidamente: upstream descrive il progetto come beta. La compatibilità verificata non equivale a certificare ogni futura versione o modello.

## Preparazione del server

DwarfStar richiede i GGUF supportati dal progetto: non è un runner generico per qualsiasi modello. Su Apple Silicon il percorso documentato parte da 64 GB con SSD streaming, oppure 96 GB per Flash Q2 residente. Flash Q2 occupa circa 81 GiB su disco; vanno aggiunte le risorse del runtime e del contesto. Consultare [requisiti Metal](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/METAL.md) e [modelli supportati](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/MODELS.md) prima di scaricare pesi.

Su una macchina adeguata, seguire il [setup ufficiale](https://github.com/antirez/ds4#start-here). Dopo compilazione e download del GGUF, avviare ad esempio:

```sh
./ds4-server -m /percorso/DeepSeek-V4-Flash.gguf --host 127.0.0.1 --port 8000 --ctx 32768
```

Il percorso del GGUF deve corrispondere al file realmente scaricato. Per un modello più grande della RAM, valutare `--ssd-streaming` seguendo la [guida upstream](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/SSD_STREAMING.md). Non disabilitare i controlli di memoria per forzare il caricamento.

GiviLoop non scarica automaticamente i pesi e non modifica il server. Sono accettati solo URL HTTP(S) su `localhost`, indirizzi `127.x.x.x` o `[::1]`, senza credenziali. I redirect sono rifiutati; non esiste fallback cloud. La configurazione e l'integrità del servizio locale restano sotto il controllo dell'utente.

## Scelta del modello e review

```sh
givi models --provider dwarfstar
givi doctor --provider dwarfstar
```

Se il server riporta `DeepSeek V4 Flash`, una review automatica può essere eseguita così:

```sh
givi prepare --repo /percorso/repository \
  --goal "Controlla il diff e proponi una correzione minima verificabile"
givi send --repo /percorso/repository \
  --send dwarfstar --model "DeepSeek V4 Flash" \
  --base-url http://127.0.0.1:8000 \
  --context-tokens 32768 --max-output-tokens 4096 --reasoning high
```

Usare sempre il nome restituito da `givi models`. DwarfStar espone alias compatibili, tra cui Flash e Pro, che possono puntare allo **stesso GGUF già caricato**. Se GiviLoop li trattasse come modelli distinti, potrebbe dichiarare una review Pro eseguita invece con Flash. L'adapter legge `name` dai metadati del server, richiede una corrispondenza esatta e omette `model` dalla richiesta di generazione: cambiare modello richiede riavviare `ds4-server` con un altro GGUF. Il nome identifica il modello secondo il runtime; non attesta hash o quantizzazione dei pesi. [API e alias upstream](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/SERVER.md)

`--base-url` può terminare alla radice del server oppure in `/v1`. La porta predefinita è `8000`.

## Contesto, reasoning e completamento

Il contesto è fissato dal `--ctx` del server. In GiviLoop, `--context-tokens N` verifica che il server abbia almeno quella capacità: non rialloca la memoria del processo DwarfStar. Il server controlla il contesto effettivo del prompt; GiviLoop rifiuta una risposta terminata per esaurimento del budget.

Il controllo `--reasoning` usa i parametri nativi:

| Valore | Richiesta |
| --- | --- |
| `off` | `think: false` |
| `on` | `think: true`, livello predefinito del server |
| `low`, `medium`, `high` | `think: true`, `reasoning_effort` corrispondente |
| omesso | predefinito di DwarfStar |

Il significato effettivo dei livelli dipende dal modello e dal runtime. Il campo separato `reasoning_content` non viene inserito nella review. Sono restituiti solo la risposta finale e i contatori comunicati dal server; non vengono inventati token di reasoning quando upstream non li misura separatamente. [Implementazione del protocollo](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/ds4_server.c)

L'adapter accetta esclusivamente risposte con `finish_reason: "stop"`, un testo finale non vuoto e nessuna richiesta di tool. Timeout, cancellazioni, risposta troncata o metadati incoerenti producono un errore senza trasformare un frammento in una review completata. La richiesta non viene reinviata automaticamente. Il limite della risposta HTTP è 8 MiB; il timeout predefinito è 10 minuti.

## Verifiche eseguite e limite hardware

Su questo Mac M5 Pro con 24 GB sono stati compilati `ds4-server` e `ds4_test` con Metal; `./ds4_test --server` è passato. I test GiviLoop verificano il protocollo con veri server HTTP locali controllati, compresi alias, budget, reasoning, output incompleto, timeout, cancellazione e redirect.

Non è stata eseguita una review con pesi DwarfStar reali: non erano installati e la macchina è sotto la configurazione minima documentata sopra. Non sono stati scaricati 81 GiB per tentare un caricamento non verificato. La compilazione e i test del protocollo **non dimostrano qualità o prestazioni di inferenza** su questa macchina.

Le evidenze locali sono in `.giviloop/diagnostics/local-inference/dwarfstar-validation.json`, `dwarfstar-build.log` e `dwarfstar-server-tests.log`. Per validare un'installazione con hardware adeguato, eseguire una review di un difetto noto, verificarne indipendentemente la correzione e registrare modello, budget, token e durata.

### Prova aggiuntiva con il server nativo e un GGUF sintetico

È stato eseguito anche il server DwarfStar originale con Metal e la forma `QWEN4_MINI` esplicitamente prevista nel codice upstream. Il GGUF di prova è stato generato localmente: circa 144 MB, 214 tensori sintetici, contesto di 512 token, nessun download di pesi e nessuna modifica ai controlli di memoria o al codice DwarfStar.

La prima fixture ha prodotto quattro caratteri `!` e `finish_reason: length`: l'adapter GiviLoop ha correttamente rifiutato la risposta incompleta. Una seconda fixture, costruita appositamente per emettere `SYNTHETIC_TEST_ONLY` seguito dal token di fine, ha completato il percorso server nativo → GPU → HTTP → adapter in 49 ms, con 55 token di input e un token di output riportati dal server.

**Questa è una prova dell'integrazione, non una review con un modello addestrato.** La risposta della fixture è progettata nei pesi; non misura capacità di reasoning, qualità o prestazioni di un vero Qwen/DeepSeek/GLM. Il limite hardware per i modelli reali rimane quello descritto sopra.

Generatore ed evidenze: `.giviloop/diagnostics/production/make-dwarfstar-synthetic.py`, `dwarfstar-synthetic-manifest.json`, `dwarfstar-synthetic-completion.json`, `dwarfstar-synthetic-adapter.json` e `dwarfstar-synthetic-completed.json`. Il commit upstream verificato è rimasto invariato.

La review viene elaborata localmente; se il risultato torna a un agente cloud, quel testo entra comunque nella conversazione di quell'agente. Le licenze del runtime e dei pesi rimangono applicabili.
