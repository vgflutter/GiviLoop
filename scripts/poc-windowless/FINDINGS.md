# GiviLoop: quattro strade per evitare finestre intrusive

**Aggiornamento successivo alla comparazione:** la strada offscreen è ora
integrata in GiviLoop. Chrome ordinario ha passato dieci riavvii e due review
ChatGPT reali attraverso MCP su macOS. Vedi la
[validazione attuale](../../docs/windowless-browser.md). La comparazione seguente
documenta i risultati e i limiti della fase iniziale, prima dell'integrazione.

Verifica locale del 24 settembre 2026. Il risultato concreto è che Docker non è
l'unica strada: tre prototipi hanno eseguito pagine interattive senza finestre
visibili rilevate; un quarto ha lavorato in schede inattive senza cambiare quelle
selezionate. Il vecchio fallimento del secondo avvio riguardava una particolare
sequenza di avvio di Chrome, non un'impossibilità generale.

Queste prove riguardano GiviLoop. Non sono modifiche a HOL Guard e non modificano
il trasporto usato attualmente dal prodotto.

## Risultati misurati

Ambiente: macOS 27.0 arm64, Node 22.21.1, Playwright 1.61.1. Le versioni dei
motori sono diverse: la tabella confronta fattibilità, non prestazioni o parità
di comportamento verso i siti. Nessun account o servizio di chat reale è stato
usato nelle fixture.

| Strada | Prova completata | Finestre e primo piano | Limite principale |
| --- | --- | --- | --- |
| Estensione offscreen + pagina Chrome nascosta | 10 avvii e chiusure con lo stesso profilo | 0 finestre del processo rilevate; 0 campioni in primo piano | Provata in Chrome for Testing 149; installazione su Chrome ordinario e API interna Playwright da validare |
| Electron con `show: false` | 10 avvii e chiusure con lo stesso profilo | Finestra nativa presente ma nascosta; 0 finestre visibili; 0 campioni in primo piano | Motore incorporato e autenticazione dei provider ancora da provare |
| Estensione con schede inattive | 20 operazioni in 2 sessioni del browser | Schede selezionate e insieme delle finestre invariati per ogni operazione; 0 campioni in primo piano | Richiede un browser già aperto; il suo avvio di preparazione ha mostrato una finestra |
| Carbonyl in terminale virtuale | 10 avvii e chiusure con lo stesso profilo | 0 finestre del processo rilevate; 0 campioni in primo piano | Pacchetto basato su Chromium 111; percorso Windows nativo non disponibile nella distribuzione npm provata |

Ogni prova positiva controlla cookie persistente sintetico, localStorage, testo
inserito, un solo invio, risposta asincrona e uscita senza terminazione forzata.
Le misure del desktop sono campionate: non garantiscono assenza assoluta di
flash fra due campioni o di finestre appartenenti ad altri processi. La presenza
di icone nel Dock o nella barra delle applicazioni non è misurata. Non abbiamo
ancora eseguito queste prove su Windows o Linux.

## 1. Estensione offscreen: la prima candidata da sviluppare

Il Chrome normale avviato senza finestra riusciva a creare la pagina nascosta
solo con un profilo nuovo. Dal secondo avvio restituiva:

```text
Hidden target can be created only when remote debugging is enabled
```

Il collegamento di debugging era già funzionante. Nel
[codice Chromium](https://chromium.googlesource.com/chromium/src/+/111ecbc657c45da1115a6bb97157721e11cbb82c/content/browser/devtools/protocol/target_handler.cc)
la creazione richiede anche la presenza di frame target. Nella sessione fallita
non ce n'erano; attendere dieci secondi non risolveva. Il comportamento è stato
riprodotto sia con Chrome 153 installato sia con Chrome for Testing 149.

L'estensione apre un piccolo documento locale offscreen, esegue realmente un
parsing DOM e lo mantiene disponibile. Il documento compare come
`background_page`; dopo questo passaggio la creazione della pagina nascosta
riesce anche al riavvio. Sullo stesso Chrome for Testing, il controllo senza
estensione fallisce al secondo avvio e quello con estensione passa dieci cicli.
Questo è un riscontro concreto a favore dell'ipotesi sul frame iniziale.

Il documento offscreen non contiene ChatGPT o altri siti: la pagina web rimane
un target separato di primo livello. Questo evita di basare la soluzione sulla
possibilità di incorporare quei siti in iframe. L'API ufficiale consente
[documenti locali non focalizzabili](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

Restano due dipendenze da risolvere prima del prodotto: un meccanismo supportato
per installare l'estensione su Chrome ordinario e la stabilità del collegamento
Playwright al target nascosto. Il caricamento da riga di comando usato nel PoC
è disponibile nella distribuzione di test; la
[documentazione Playwright](https://playwright.dev/docs/chrome-extensions)
segnala la rimozione di quel meccanismo da Chrome ed Edge ordinari.

La mia valutazione: è la candidata più interessante per mantenere un browser
completo vicino all'attuale architettura GiviLoop. Il passaggio successivo è
validarla in un profilo dedicato di Chrome ordinario con estensione installata
tramite il normale flusso del browser. L'esito positivo attuale non copre ancora
questa combinazione.

## 2. Electron: controllo diretto della visibilità

Electron 44.4.5, con Chromium 152.0.7977.130, ha mantenuto una finestra nascosta
fin dalla sua creazione e conservato i dati del profilo nei dieci riavvii. La
[API BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
offre direttamente `show: false`: il prototipo non deve inseguire la finestra e
minimizzarla dopo che appare.

L'integrazione può usare gran parte dell'automazione DOM esistente. Richiede però
distribuzione e aggiornamenti di un runtime aggiuntivo e un profilo proprio. Il
PoC non dimostra compatibilità con login, popup e controlli di accesso reali.
In particolare Google ha documentato
[restrizioni OAuth nei browser incorporati](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/):
non basta un cookie sintetico persistente per dichiarare funzionante un login.

La mia valutazione: seconda candidata, con un'API esplicita per la visibilità.
Il primo rischio da verificare è l'accesso effettivo ai provider, prima di
investire nel confezionamento dell'applicazione per tre sistemi operativi.

## 3. Scheda inattiva: utilizzare il browser che esiste già

L'estensione crea una scheda con `active: false` nella finestra già presente,
inserisce il testo, preme il pulsante e rimuove la scheda. Le venti operazioni
mantengono le schede selezionate inizialmente, anche quando al secondo avvio ci
sono più finestre ripristinate. Le API usate sono quelle ufficiali di
[tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) e scripting.

Questa soluzione soddisfa un'esperienza discreta durante l'uso del browser.
La scheda può comunque comparire nella barra e il browser deve già essere aperto.
Il PoC prepara questa condizione avviando un browser separato minimizzato:
l'osservatore ha rilevato una finestra visibile durante l'intera prova. Non va
quindi presentato come avvio completamente invisibile da browser chiuso.

Il prototipo prova il lavoro dell'estensione; il comando arriva ancora da CDP.
Per GiviLoop servirebbe un ponte
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
con installazione specifica per ciascun OS, permessi limitati ai siti scelti e
gestione delle operazioni concorrenti. L'esperimento non si è collegato al
browser personale né ne ha letto le sessioni.

Durante una ripetizione è emerso un errore di navigazione al dominio fittizio:
una scheda creata dall'estensione dopo il riavvio non ha ricevuto l'intercettazione
configurata sul contesto. Il test ora registra l'intercettazione anche sulla
singola pagina, prima della navigazione. Il report del tentativo fallito resta
conservato separatamente; non era una risposta HTTP 403 di un provider.

La mia valutazione: alternativa utile se accetti una scheda in background e
vuoi riusare il browser già aperto. Non sostituisce le prime due quando il
requisito è lavorare senza alcuna finestra del browser aperta.

## 4. Browser testuali: fattibili, con un motore completo sotto

Carbonyl è stato avviato dentro un terminale virtuale, senza aprire l'app
Terminale. Ho adattato la scoperta del suo endpoint locale e verificato le
normali operazioni Playwright, inclusi dieci riavvii con persistenza. Il pacchetto
testato, `0.0.2-next.bacf3db`, dichiara `Google Chrome/111.0.5511.1 (Carbonyl)`.

La [documentazione del progetto](https://github.com/fathyb/carbonyl) descrive un
runtime derivato da Chromium headless shell. Cambiare la visualizzazione in
testo non elimina quindi i problemi di accesso di un sito: il risultato positivo
locale non risolve automaticamente i vecchi 403. Inoltre, prima di usare account
reali, servirebbe un runtime aggiornato. L'implementazione del terminale virtuale
di questo PoC usa API POSIX; non certifica Windows nativo.

Browsh usa invece Firefox headless. Ho provato il Firefox già disponibile con
Playwright: ha fallito l'avvio, riportando un errore di sandbox extension del
processo contenuti e del framebuffer SWGL. Non ho disabilitato la sandbox.
Questo è un problema osservato con quel runtime su questo Mac, non una prova
di impossibilità di Browsh. Il test completo di Browsh rimane non eseguito.
Il suo [sito ufficiale](https://www.brow.sh/downloads/) indica inoltre il supporto
Windows come sperimentale.

Un browser classico come Lynx non ha il motore JavaScript necessario alle
interfacce chat moderne. Carbonyl e Browsh lo mantengono: il terminale cambia
l'interfaccia, non rende superfluo il browser sottostante.

La mia valutazione: Carbonyl dimostra la fattibilità tecnica dell'idea testuale,
ma aggiornamento del motore e distribuzione sui tre OS lo rendono una priorità
inferiore alle prime due strade.

## Confine della conclusione e prossima verifica

La conclusione dimostrata è: esistono alternative locali a Docker per eseguire
interazioni web senza finestre visibili rilevate su questo Mac. Non abbiamo
dimostrato che tutte funzionino con gli account dei provider, con le protezioni
dei loro siti o sui tre OS richiesti. Il comportamento di un login o di un 403
richiede prove separate; non si può dedurlo dalla sola modalità della finestra.

Il percorso proposto è approfondire l'estensione offscreen in Chrome ordinario,
con Electron come seconda candidata. Per ogni candidata: prima controllo del
provider senza invii, poi login esplicito quando necessario, una singola review
controllata, riavvio con la stessa sessione e verifica equivalente su Windows e
Linux. Un'eventuale richiesta di login o verifica deve restare visibile all'utente
come stato di attenzione; non deve provocare riaperture automatiche ripetute.

Codice e comandi riproducibili sono nel [README](README.md); i conteggi della
sessione sono in [results-2026-09-24.json](results-2026-09-24.json). La suite
ordinaria GiviLoop è passata con 225 test su 225. I prototipi rimangono locali e
separati dal trasporto di produzione.
