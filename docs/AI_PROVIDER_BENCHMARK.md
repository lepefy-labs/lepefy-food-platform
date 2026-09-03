# AI Provider Benchmark V1

## Obiettivo

Confrontare modelli AI registrati in Lepefy AI Core senza cambiare le policy di produzione.
Il primo caso d'uso è `nala_semantic_enrichment / classification`, dove il costo può essere ridotto usando un modello più economico se mantiene qualità e affidabilità sufficienti.

V1 confronta in particolare:

- Gemini 2.5 Flash-Lite;
- GPT-OSS 20B tramite Hugging Face Inference Providers.

DeepSeek è deliberatamente fuori scope finché pricing e provider strategy non sono stati chiariti.

## Sicurezza e isolamento

Il benchmark è manual-only e non modifica:

- `nala_interactions`;
- policy `nala_semantic_enrichment / classification`;
- checkout, ordini o pagamenti;
- schema Supabase.

La route interna `/api/internal/ai-provider-benchmark` usa lo stesso bearer service-role degli altri job interni. I modelli candidati vengono eseguiti singolarmente tramite AI Gateway con consumer telemetry dedicato `platform_ai_benchmark`; non esiste fallback tra candidati durante il benchmark.

Il report non restituisce message/reply raw. Usa interazioni recenti già arricchite come baseline e restituisce solo metriche aggregate.

## Registrazione modelli

Prima del benchmark entrambi i modelli devono essere presenti e attivi in `/admin/platform/ai-routing`.

### Gemini 2.5 Flash-Lite

Riutilizzare il provider Gemini esistente.

Valori consigliati:

```text
key: gemini-flash-lite
display_name: Gemini 2.5 Flash-Lite
provider_model_id: gemini-2.5-flash-lite
enabled: true
capabilities: chat, structured_output, classification
```

Inserire in `input_cost_per_million` e `output_cost_per_million` il pricing corrente verificato del provider. Il benchmark non hardcoda prezzi esterni: se i metadata costo sono nulli, `estimatedCostUsd` sarà null.

### GPT-OSS 20B · Hugging Face

Configurazione prevista:

```text
key: hf-gpt-oss-20b
display_name: GPT-OSS 20B · Hugging Face
provider_model_id: openai/gpt-oss-20b:fastest
enabled: true
capabilities: chat, structured_output, classification
```

Provider:

```text
provider_type: openai_compatible
base_url: https://router.huggingface.co/v1
credential_ref: HUGGINGFACE_API_KEY
```

`https://router.huggingface.co` deve essere presente in `LEPEFY_AI_ALLOWED_ORIGINS` e `HUGGINGFACE_API_KEY` deve essere configurata server-side.

## Esecuzione

GitHub Actions → `AI provider benchmark` → `Run workflow`.

Default:

```text
model_keys: gemini-flash-lite,hf-gpt-oss-20b
sample_size: 8
```

Il sample è limitato a 12 interazioni per run per mantenere il job bounded. Per aumentare confidenza eseguire più run in momenti diversi, invece di trasformare un test economico in una piccola centrale elettrica.

Il workflow usa:

```text
AI_BENCHMARK_APP_URL
  -> fallback NALA_ENRICHMENT_APP_URL
  -> fallback EVENT_REPORTS_APP_URL
```

L'URL deve essere HTTPS. `SUPABASE_SERVICE_ROLE_KEY` resta secret GitHub.

## Metriche

Per ogni modello il report include:

- `attempted`, `succeeded`, `failed`;
- `schemaSuccessRatePct`;
- agreement su `intent`, `demandStatus`, `retrievalQuality`, `knowledgeStatus`, `requestedProductText`;
- agreement complessivo sui cinque campi;
- latenza media;
- input/output tokens;
- costo stimato, solo se i metadata costo del modello sono configurati.

L'agreement confronta il candidato con l'enrichment production già persistito. Non è ground truth umana e non deve essere presentato come accuracy assoluta.

## Decisione di promozione

Non cambiare la policy production dopo un singolo run. Il percorso consigliato è:

1. diversi run su campioni distinti;
2. nessun problema ripetuto di structured output;
3. agreement intent molto alto e nessuna regressione evidente sulle classi commerce critiche;
4. costo e latenza inferiori in modo consistente;
5. solo allora promuovere il candidato a priority 1 della policy `nala_semantic_enrichment / classification`, mantenendo un modello più forte come fallback.

Per Nala chat (`nala / structured_chat`) la decisione va valutata separatamente: classificazione batch e conversazione commerce non sono lo stesso workload.
