import { getGenerativeModel, InferenceMode, InferenceSource, type GenerativeModel } from 'firebase/ai';
import { ai } from '../firebase';
import type { Availability, CloudModel, DeviceModel, ImageInput } from '../core/types';

/** Chrome built-in Prompt API global (Chrome 138+). Used for availability + download only. */
declare global {
  // eslint-disable-next-line no-var
  var LanguageModel: undefined | {
    availability(opts: object): Promise<Availability>;
    create(opts: object): Promise<{ destroy(): void }>;
  };
}
const DEVICE_OPTS = { expectedInputs: [{ type: 'text' as const, languages: ['en'] }, { type: 'image' as const }], expectedOutputs: [{ type: 'text' as const, languages: ['en'] }] };

async function toPart(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { inlineData: { data: btoa(bin), mimeType: blob.type || 'image/jpeg' } };
}

let deviceGen: GenerativeModel | null = null;
export const deviceModel: DeviceModel = {
  async availability() {
    if (typeof globalThis.LanguageModel === 'undefined') return 'unavailable';
    try { return await globalThis.LanguageModel.availability(DEVICE_OPTS); } catch { return 'unavailable'; }
  },
  async download(onProgress) {
    if (!globalThis.LanguageModel) return;
    const s = await globalThis.LanguageModel.create({
      ...DEVICE_OPTS,
      monitor(m: EventTarget) { m.addEventListener('downloadprogress', (e) => onProgress((e as ProgressEvent).loaded)); },
    });
    s.destroy();
  },
  async extract(image: ImageInput, prompt: string) {
    // Fail closed: without the Prompt API the SDK would silently fall back to the cloud.
    if (typeof globalThis.LanguageModel === 'undefined') throw new Error('on-device model unavailable');
    deviceGen ??= getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: DEVICE_OPTS },
    });
    const res = await deviceGen.generateContent([prompt, await toPart(image.blob)]);
    // Correctness backstop only, NOT the privacy guard: this runs AFTER the call, so it cannot stop data leaving the device.
    // The privacy guard is the LanguageModel check above, before the call (plus ONLY_ON_DEVICE mode).
    if (res.response.inferenceSource !== InferenceSource.ON_DEVICE) throw new Error('on-device model unavailable: response not from device');
    return res.response.text();
  },
};

const cloudGens = new Map<string, GenerativeModel>();
export const cloudModel: CloudModel = {
  async extract(redacted: ImageInput, prompt: string, model: string) {
    let g = cloudGens.get(model);
    if (!g) {
      g = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model, generationConfig: { responseMimeType: 'application/json', temperature: 0 } },
      });
      cloudGens.set(model, g);
    }
    const res = await g.generateContent([prompt, await toPart(redacted.blob)]);
    return res.response.text();
  },
};
