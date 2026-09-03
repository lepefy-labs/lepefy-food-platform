# AI Provider Benchmark V1.3

## Obiettivo

Confrontare modelli AI registrati in Lepefy AI Core senza cambiare le policy di produzione.
Il caso d'uso iniziale è `nala_semantic_enrichment / classification`, dove il costo può essere ridotto usando un modello più economico solo se mantiene qualità e affidabilità sufficienti.

V1.3 confronta in particolare:

- Gemini 3.1 Flash-Lite;
- GPT-OSS 20B tramite Hugging Face Inference Providers con provider Fireworks AI fissato e structured output `json_schema`.

DeepSeek resta deliberatamente fuori scope finché pricing e provider strategy non sono stati chiariti.

## Sicurezza e isolamento

Il benchmark è manual-only e non modifica:

- `nala_interactions`;
- policy `nala_semantic_enrichment / classification`;
- checkout, ordini o pagamenti;
- schema Supabase.

La route interna `/api/internal/ai-provider-benchmark` usa lo stesso bearer service-role degli altri job interni. I candidati vengono eseguiti singolarmente tramite AI Gateway con consumer telemetry dedicato `platform_ai_benchmark`; non esiste fallback tra candidati durante il benchmark.

Il report non restituisce message/reply raw. Usa interazioni recenti già arricchite come baseline e restituisce solo metriche aggregate e failure code normalizzati a bassa cardinalità.

## Perché un modello HF separato

Il modello production `hf-gpt-oss-20b` può restare invariato e collegato alle policy esistenti. Il benchmark usa un record separato per evitare di cambiare provider o response format del fallback production.

Hugging Face raccomanda di fissare provider e modello per gli structured outputs, perché la compatibilità può variare fra provider. Il router HF permette di selezionare il provider con un suffisso nel model id.

## Registrazione modelli

Prima del benchmark entrambi i candidati devono essere presenti e attivi in `/admin/platform/ai-routing`.

### Gemini 3.1 Flash-Lite

Riutilizzare il provider Gemini esistente.

```text
key: gemini-3-1-flash-lite
display_name: Gemini 3.1 Flash-Lite
provider_model_id: gemini-3.1-flash-lite
enabled: true
capabilities: chat, structured_output, classification
```

Inserire in `input_cost_per_million` e `output_cost_per_million` il pricing corrente verificato del provider. Il benchmark non hardcoda prezzi esterni: se i metadata costo sono nulli, `estimatedCostUsd` sarà null.

### GPT-OSS 20B · Hugging Face · Fireworks

Creare un record benchmark-only separato dal modello HF già usato nelle policy production:

```text
key: hf-gpt-oss-20b-fireworks
display_name: GPT-OSS 20B · HF · Fireworks
provider_model_id: openai/gpt-oss-20b:fireworks-ai
enabled: true
capabilities: chat, structured_output, classification
config: {"responseFormat":"json_schema"}
```

Riutilizzare il provider Hugging Face esistente:

```text
provider_type: openai_compatible
base_url: https://router.huggingface.co/v1
credential_ref: HUGGINGFACE_API_KEY
```

`https://router.huggingface.co` deve essere presente in `LEPEFY_AI_ALLOWED_ORIGINS` e `HUGGINGFACE_API_KEY` deve essere configurata server-side.

Non aggiungere `hf-gpt-oss-20b-fireworks` a una policy production durante la fase benchmark.

## Structured output configurabile

L'adapter OpenAI-compatible mantiene `json_object` come comportamento di default, quindi i modelli production esistenti non cambiano comportamento.

Solo i modelli con:

```json
{"responseFormat":"json_schema"}
```

usano:

```text
response_format.type = json_schema
strict = true
```

Lo schema Lepefy viene normalizzato in JSON Schema, incluse le proprietà nullable e `additionalProperties: false` sugli oggetti.

## Esecuzione

GitHub Actions → `AI provider benchmark` → `Run workflow`.

Default V1.3:

```text
model_keys: gemini-3-1-flash-lite,hf-gpt-oss-20b-fireworks
sample_size: 12
```

Il sample resta limitato a 12 interazioni per run. Per aumentare confidenza eseguire più run in momenti diversi invece di cambiare produzione dopo un singolo campione minuscolo, una pratica sorprendentemente popolare nel mondo AI.

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
- `failureCodes`, inclusi `provider_http_400`, `provider_http_401`, `provider_http_403`, `provider_http_404`, `provider_http_5xx`, `rate_limit`, `invalid_structured_output`, `provider_timeout`;
- `schemaSuccessRatePct`;
- agreement su `intent`, `demandStatus`, `retrievalQuality`, `knowledgeStatus`, `requestedProductText`;
- agreement complessivo sui cinque campi;
- latenza media;
- input/output tokens;
- costo stimato, solo se i metadata costo del modello sono configurati.

I failure code non includono eccezioni raw, prompt, message, reply o provider response body.

L'agreement confronta il candidato con l'enrichment production già persistito. Non è ground truth umana e non deve essere presentato come accuracy assoluta. Le percentuali di agreement sono calcolate sulle sole richieste riuscite, quindi vanno sempre lette insieme a `schemaSuccessRatePct` e `failureCodes`.

## Decisione di promozione

Non cambiare la policy production dopo un singolo run. Il percorso consigliato è:

1. almeno 3-5 run su campioni da 12;
2. structured-output success vicino al 100%;
3. agreement intent alto e nessuna regressione evidente sulle classi commerce critiche;
4. costo e latenza inferiori in modo consistente;
5. se i candidati divergono ancora molto dalla baseline, costruire un gold set umano separato prima della promozione;
6. solo allora promuovere il candidato a priority 1 della policy `nala_semantic_enrichment / classification`, mantenendo un modello più forte come fallback.

Un gold set persistente richiede una decisione separata sul data model e non fa parte di V1.3.

Per Nala chat (`nala / structured_chat`) la decisione va valutata separatamente: classificazione batch e conversazione commerce non sono lo stesso workload.
