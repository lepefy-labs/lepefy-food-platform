# Lepefy AI Core — Configurare un nuovo provider

Guida operativa per aggiungere un provider/modello a **Lepefy AI Core** senza introdurre dipendenze dirette nei consumer applicativi.

> Source of truth runtime: `apps/storefront/src/lib/ai/core/` e `/admin/platform/ai-routing`.
> Le credenziali restano secret server-side. Non salvare API key raw nel database, nel codice o nei log.

## 1. Regola architetturale

I consumer Lepefy non chiamano direttamente Gemini, OpenAI, Anthropic o altri provider.

```text
Consumer Lepefy
  -> Lepefy AI Gateway
  -> routing policy
  -> provider adapter
  -> modello
```

Il provider è configurazione della piattaforma. Nala e gli altri consumer devono dipendere solo da AI Core.

## 2. Scegliere il tipo di provider

Tipi previsti dal registry:

- `gemini`: adapter Google Gemini dedicato;
- `openai_compatible`: endpoint HTTP compatibile con OpenAI Chat Completions;
- `openai`: tipo predisposto, adapter dedicato non ancora canonico;
- `anthropic`: tipo predisposto, adapter dedicato non ancora canonico;
- `lepefy`: riservato a futuri modelli/inference Lepefy.

Per modelli open-weight hosted o self-hosted, preferire `openai_compatible` quando l'endpoint espone un contratto compatibile.

## 3. Preparare la credential server-side

Creare la chiave presso il provider con il minimo privilegio necessario per inference.

Aggiungerla nelle Environment Variables del deployment Vercel con un nome che termini in `_API_KEY`, per esempio:

```text
HUGGINGFACE_API_KEY
OPENAI_API_KEY
MY_PROVIDER_API_KEY
```

Nel registry Lepefy si salva soltanto il nome della variabile:

```text
credential_ref = HUGGINGFACE_API_KEY
```

Mai il valore reale del token.

Dopo aver creato/modificato environment variables in Vercel, effettuare un nuovo deployment prima del test runtime.

## 4. Allowlist per provider OpenAI-compatible

Gli endpoint `openai_compatible` sono protetti contro SSRF.

L'origine HTTPS deve essere esplicitamente presente in:

```text
LEPEFY_AI_ALLOWED_ORIGINS
```

La variabile accetta origini separate da virgola.

Esempio:

```text
https://router.huggingface.co,https://inference.example.com
```

Inserire solo l'**origin**, senza path `/v1` o `/chat/completions`.

Corretto:

```text
https://router.huggingface.co
```

Errato:

```text
https://router.huggingface.co/v1
```

AI Core richiede HTTPS, rifiuta credenziali nell'URL, query/hash non previsti, origini non autorizzate e redirect.

## 5. Creare il provider in Admin

Accedere come Platform Owner a:

```text
/admin/platform/ai-routing
```

Aprire **Ajouter un provider**.

Campi:

```text
Clé
  identificatore stabile, lowercase/kebab semplice

Nom
  nome leggibile del provider

Type
  gemini | openai_compatible | openai | anthropic | lepefy

Référence credential
  nome della env server-side, mai il secret

URL de base HTTPS
  necessario per openai_compatible

Activé
  abilita/disabilita il provider globalmente
```

Per un provider OpenAI-compatible, il `base_url` deve essere la root API attesa dall'adapter. AI Core aggiunge `/chat/completions`.

Esempio Hugging Face:

```text
key: huggingface
name: Hugging Face Inference Providers
provider_type: openai_compatible
credential_ref: HUGGINGFACE_API_KEY
base_url: https://router.huggingface.co/v1
enabled: true
```

## 6. Creare il modello

Dopo il provider, aprire **Ajouter un modèle**.

Campi principali:

```text
Clé
  identificatore Lepefy stabile del modello

Nom affiché
  nome mostrato in Admin

Provider
  provider appena creato

ID modèle chez le provider
  model identifier richiesto dall'API esterna

Fenêtre de contexte
  metadata opzionale

Classe de coût
  metadata opzionale

Coût entrée / sortie
  metadata opzionale, non inventare valori

Thinking budget
  usare solo quando supportato dal relativo adapter/modello
```

### Capabilities

Abilitare solo capacità realmente supportate e validate.

Le capability correnti includono:

```text
chat
structured_output
classification
reasoning
vision
```

Per Nala `structured_chat` servono almeno:

```text
chat = true
structured_output = true
```

Esempio iniziale open-weight:

```text
key: hf-gpt-oss-20b
display_name: GPT-OSS 20B · Hugging Face
provider: Hugging Face Inference Providers
provider_model_id: openai/gpt-oss-20b:fastest
enabled: true

capabilities:
  chat: true
  structured_output: true
  classification: true
  reasoning: false
  vision: false
```

Lasciare vuoti costi/context metadata se non verificati.

## 7. Inserire il modello nella routing policy

Nella sezione **Policies**, individuare il consumer/capability interessato.

Per Nala:

```text
consumer: nala
capability: structured_chat
```

Aggiungere il nuovo modello alla chain.

La priorità numerica più bassa viene eseguita per prima.

Esempio rollout conservativo:

```text
1  Gemini Flash
2  GPT-OSS 20B · Hugging Face
```

Il secondo modello viene quindi usato come fallback quando il primo tentativo fallisce per una condizione gestita dal router.

### Timeout

Impostare un timeout coerente con il provider.

Per un nuovo provider esterno partire in modo prudente, per esempio:

```text
10000 ms
```

Poi ridurlo usando telemetry reale.

Il budget complessivo del gateway resta limitato dal runtime AI Core.

### Confidence minima

Lasciare vuoto `min_confidence` salvo che l'adapter restituisca una confidence significativa/calibrata.

Non usare self-confidence generata testualmente dal modello come misura affidabile.

## 8. Quando scatta il fallback

Il router può passare al modello successivo in casi come:

- timeout provider;
- errore provider;
- rate limit;
- credential mancante;
- modello/adaptor non disponibile;
- JSON non valido;
- structured output non conforme allo schema;
- confidence sotto soglia, solo se disponibile in modo significativo.

Non usare fallback per aggirare errori di business validation, tenant isolation, stock, prezzi, autorizzazioni o altre regole applicative.

## 9. Verifica dopo la configurazione

Non considerare il provider operativo solo perché le righe sono salvate nell'admin.

Verificare almeno:

1. env credential presente nel deployment corretto;
2. origin presente in `LEPEFY_AI_ALLOWED_ORIGINS` per `openai_compatible`;
3. nuovo deployment Vercel successivo alla modifica env;
4. provider enabled;
5. model enabled;
6. policy enabled;
7. policy-model enabled e priorità corretta;
8. risposta structured valida;
9. telemetry con provider/model atteso;
10. continuità del conversation context anche se cambia provider fra due turni.

Per Nala usare casi contestuali, non solo prompt isolati. Esempio:

```text
User: J’ai envie de quelque chose de camerounais
Nala: ...
User: Le ndolé me tente
User: Oui, prépare-moi le panier
```

Controllare che subject, intent, commerce mode e pending action restino coerenti.

## 10. Test controllato del fallback

Non sabotare il provider primario in produzione durante traffico reale.

Per un test controllato, scegliere una finestra operativa e modificare temporaneamente la routing policy da Admin, per esempio:

```text
1  nuovo modello
2  Gemini
```

oppure disabilitare temporaneamente il model entry primario nella singola policy.

Verificare il test e ripristinare immediatamente l'ordine desiderato.

Le modifiche routing possono richiedere fino a circa 30 secondi per propagarsi nella cache runtime.

## 11. Telemetry da controllare

AI Core registra tramite `logAiUsage` almeno, quando disponibili:

```text
consumer
capability
provider
model
status
latency
input/output tokens
fallback_used
fallback_reason
```

`health_status` del provider è osservazionale. Non è la source of truth permanente del routing.

## 12. Rollback

Il rollback di un nuovo provider non richiede deploy codice.

Da `/admin/platform/ai-routing`:

1. disabilitare il model nella policy oppure il model stesso;
2. se necessario disabilitare il provider;
3. verificare che la chain torni al provider stabile precedente.

Non cancellare subito env/registry durante un incidente. Prima ristabilire il routing stabile e raccogliere telemetry utile alla diagnosi.

## 13. Troubleshooting rapido

### `Origine HTTPS à autoriser...`

Controllare:

```text
LEPEFY_AI_ALLOWED_ORIGINS
```

e verificare che contenga l'origin esatto, non il path API.

Dopo la modifica env effettuare redeploy.

### Missing credential / provider skipped

Controllare che:

```text
credential_ref
```

corrisponda esattamente al nome della env in Vercel e che la variabile sia presente nel deployment/environment corretto.

### Output invalido

Il provider deve supportare una risposta JSON compatibile con il contratto richiesto. L'output viene validato localmente da Lepefy AI Core. Un HTTP 200 non implica una risposta accettabile.

### Timeout frequenti

Controllare telemetry prima di aumentare indiscriminatamente il timeout. Un provider molto lento può consumare il budget complessivo e peggiorare il fallback.

### Provider salvato ma mai usato

Controllare contemporaneamente:

```text
provider.enabled
model.enabled
policy.enabled
policy_model.enabled
priority
capabilities.chat
capabilities.structured_output
```

## 14. Checklist nuovo provider

```text
[ ] API token creato con minimo privilegio
[ ] secret configurato server-side in Vercel
[ ] credential_ref contiene solo il nome env
[ ] origin HTTPS aggiunto alla allowlist se necessario
[ ] redeploy eseguito dopo modifica env
[ ] provider creato in /admin/platform/ai-routing
[ ] modello creato e capability verificate
[ ] modello aggiunto alla policy corretta
[ ] priorità e timeout configurati
[ ] provider primario stabile preservato durante rollout iniziale
[ ] test structured output eseguito
[ ] test conversation context eseguito
[ ] telemetry provider/model verificata
[ ] fallback reale verificato in modo controllato
[ ] ordine production finale ripristinato/confermato
```

## 15. Riferimenti nel repository

```text
apps/storefront/src/lib/ai/core/aiGateway.ts
apps/storefront/src/lib/ai/core/router.ts
apps/storefront/src/lib/ai/core/providers/geminiAdapter.ts
apps/storefront/src/lib/ai/core/providers/openaiCompatibleAdapter.ts
apps/storefront/src/app/admin/(protected)/platform/ai-routing/
apps/storefront/src/app/api/admin/platform/ai-routing/route.ts
docs/LEPEFY_AI_CORE_V1.md
LEPEFY_PROJECT_CONTEXT.md
```

Questa guida descrive la procedura operativa. L'architettura canonica e i vincoli permanenti restano documentati in `LEPEFY_PROJECT_CONTEXT.md` e `docs/LEPEFY_AI_CORE_V1.md`.
