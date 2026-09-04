# AI Provider Benchmark V1.4

## Obiettivo

Confrontare modelli AI registrati in Lepefy AI Core senza cambiare le policy di produzione.
Il caso d'uso iniziale resta `nala_semantic_enrichment / classification`, dove costo e latenza contano solo dopo affidabilità tecnica e qualità semantica.

Il candidato predefinito corrente è `gemini-3-1-flash-lite`. GPT-OSS 20B via Hugging Face/Fireworks non è più nella shortlist predefinita dopo i run con errori provider; l'infrastruttura benchmark resta generica e permette di inserire manualmente altri `ai_models.key` registrati.

## Sicurezza e isolamento

Il benchmark è manual-only e non modifica:

- `nala_interactions`;
- policy `nala_semantic_enrichment / classification`;
- checkout, ordini o pagamenti;
- schema Supabase.

La route interna `/api/internal/ai-provider-benchmark` usa lo stesso bearer service-role degli altri job interni. I candidati vengono eseguiti singolarmente tramite AI Gateway con consumer telemetry dedicato `platform_ai_benchmark`; non esiste fallback tra candidati durante il benchmark.

Il report non restituisce message/reply raw. Usa interazioni recenti già arricchite come baseline e restituisce soltanto metriche aggregate e failure code normalizzati a bassa cardinalità.

## Registrazione candidati

Ogni candidato deve essere presente e attivo in `/admin/platform/ai-routing`, con capability compatibili con il workload benchmark. Il benchmark non richiede che il modello sia collegato a una policy production.

### Gemini 3.1 Flash-Lite

Riutilizzare il provider Gemini esistente:

```text
key: gemini-3-1-flash-lite
display_name: Gemini 3.1 Flash-Lite
provider_model_id: gemini-3.1-flash-lite
enabled: true
capabilities: chat, structured_output, classification
```

Inserire in `input_cost_per_million` e `output_cost_per_million` il pricing corrente verificato del provider. Il benchmark non hardcoda prezzi esterni: se i metadata costo sono nulli, `estimatedCostUsd` sarà null.

## Structured output configurabile

L'adapter OpenAI-compatible mantiene `json_object` come comportamento di default, quindi i modelli esistenti non cambiano comportamento.

Un modello può optare esplicitamente per:

```json
{"responseFormat":"json_schema"}
```

In quel caso Lepefy invia `response_format.type = json_schema` con schema normalizzato e `strict = true`. Questa capacità resta disponibile per futuri candidati anche se GPT-OSS non è più un default del benchmark.

## Esecuzione

GitHub Actions → `AI provider benchmark` → `Run workflow`.

Default corrente:

```text
model_keys: gemini-3-1-flash-lite
sample_size: 12
```

`model_keys` può contenere più chiavi separate da virgola per confronti controllati. Il sample resta limitato a 12 interazioni per run; per aumentare la confidenza si eseguono più run in momenti diversi invece di promuovere un modello dopo un campione microscopico, sport molto praticato nell'industria AI.

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
- `failureCodes` normalizzati;
- `schemaSuccessRatePct`;
- agreement su `intent`, `demandStatus`, `retrievalQuality`, `knowledgeStatus`, `requestedProductText`;
- agreement complessivo sui cinque campi;
- latenza media;
- input/output tokens;
- costo stimato, solo se i metadata costo del modello sono configurati.

I failure code non includono eccezioni raw, prompt, message, reply o provider response body.

L'agreement confronta il candidato con l'enrichment production già persistito. Non è ground truth umana e non deve essere presentato come accuracy assoluta. Le percentuali vanno lette insieme a `schemaSuccessRatePct` e `failureCodes`.

## Decisione di promozione

Non cambiare la policy production dopo un singolo run. Il percorso consigliato resta:

1. almeno 3-5 run su campioni da 12;
2. structured-output success vicino al 100%;
3. agreement intent alto e nessuna regressione evidente sulle classi commerce critiche;
4. costo e latenza inferiori in modo consistente;
5. se i candidati divergono ancora molto dalla baseline, costruire un gold set umano separato;
6. solo allora promuovere il candidato nella policy desiderata mantenendo un fallback adeguato.

Per Nala chat (`nala / structured_chat`) la decisione va valutata separatamente: classificazione batch e conversazione commerce non sono lo stesso workload.

Con Response Memory V1, il benchmark provider diventa inoltre una metrica secondaria rispetto all'autonomia: prima si misura quante richieste Lepefy riesce a risolvere senza provider esterno, poi si ottimizza il provider residuo.
