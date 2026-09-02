import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { AiAttemptError, type LepefyAiProviderAdapter, type StructuredSchema } from '../types';

function geminiSchema(schema: StructuredSchema): Schema {
  const types = { object: Type.OBJECT, array: Type.ARRAY, string: Type.STRING, number: Type.NUMBER, boolean: Type.BOOLEAN };
  return {
    type: types[schema.type], nullable: schema.nullable, enum: schema.enum, required: schema.required,
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, geminiSchema(v)])) } : {}),
    ...(schema.items ? { items: geminiSchema(schema.items) } : {}),
  };
}
export const geminiAdapter: LepefyAiProviderAdapter = {
  async generate(request) {
    if (!request.credential) throw new AiAttemptError('missing_credential');
    const client = new GoogleGenAI({ apiKey: request.credential });
    let response;
    try { response = await client.models.generateContent({
      model: request.model.provider_model_id,
      contents: request.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction: request.system, temperature: request.temperature ?? 0.4,
        maxOutputTokens: request.maxOutputTokens ?? 1200,
        ...(typeof request.model.config.thinkingBudget === 'number'
          ? { thinkingConfig: { thinkingBudget: request.model.config.thinkingBudget } } : {}),
        abortSignal: request.signal,
        responseMimeType: 'application/json', responseSchema: geminiSchema(request.responseSchema),
      },
    });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      throw new AiAttemptError(status === 429 ? 'rate_limit' : status === 404 ? 'model_unavailable' : 'provider_error');
    }
    return {
      text: response.text ?? '', inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  },
};
