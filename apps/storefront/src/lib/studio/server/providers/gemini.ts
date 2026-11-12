import 'server-only';
import { GoogleGenAI, Modality } from '@google/genai';
import { httpStatusError, StudioProviderError, type ImageStudioProvider } from './types';

/**
 * Gemini image models (generateContent with IMAGE modality): the same call
 * edits a photo (image part + instruction) or creates from text alone.
 */
export const geminiImageProvider: ImageStudioProvider = {
  async run(request, model, credential) {
    const client = new GoogleGenAI({ apiKey: credential });
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (request.input) parts.push({ inlineData: { mimeType: request.input.mime, data: request.input.bytes.toString('base64') } });
    parts.push({ text: request.prompt });

    let response;
    try {
      response = await client.models.generateContent({
        model: model.providerModelId,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
          imageConfig: { aspectRatio: request.aspectRatio },
          abortSignal: request.signal,
        },
      });
    } catch (error) {
      if (request.signal.aborted) throw new StudioProviderError('provider_timeout');
      const status = (error as { status?: number })?.status;
      throw httpStatusError(status);
    }

    const candidate = response.candidates?.[0];
    const blocked = response.promptFeedback?.blockReason
      || (candidate?.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|RECITATION|IMAGE_SAFETY/.test(String(candidate.finishReason)));
    const image = candidate?.content?.parts?.find((part) => part.inlineData?.data);
    if (!image?.inlineData?.data) throw new StudioProviderError(blocked ? 'safety_blocked' : 'no_image');
    return {
      bytes: Buffer.from(image.inlineData.data, 'base64'),
      mime: image.inlineData.mimeType ?? 'image/png',
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      images: 1,
    };
  },
};
