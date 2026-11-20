import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
const getGenerativeModel = vi.fn(() => ({ generateContent }));
vi.mock('firebase/ai', () => ({
  getGenerativeModel,
  InferenceMode: { ONLY_ON_DEVICE: 'only_on_device', ONLY_IN_CLOUD: 'only_in_cloud' },
  InferenceSource: { ON_DEVICE: 'on_device', IN_CLOUD: 'in_cloud' },
}));
vi.mock('../../src/firebase', () => ({ ai: {} }));

const image = { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), mimeType: 'image/jpeg' as const, width: 1, height: 1 };
const respond = (inferenceSource: string, text = 'hello') => ({ response: { text: () => text, inferenceSource } });
const g = globalThis as unknown as { LanguageModel?: unknown };

beforeEach(() => {
  vi.resetModules();
  generateContent.mockReset();
  getGenerativeModel.mockClear();
  delete g.LanguageModel;
});

describe('deviceModel.extract', () => {
  it('fails closed without LanguageModel and never touches the SDK', async () => {
    const { deviceModel } = await import('../../src/adapters/firebaseAi');
    await expect(deviceModel.extract(image, 'p')).rejects.toThrow('on-device model unavailable');
    expect(getGenerativeModel).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });
  it('rejects when the response came from the cloud', async () => {
    g.LanguageModel = {};
    generateContent.mockResolvedValue(respond('in_cloud'));
    const { deviceModel } = await import('../../src/adapters/firebaseAi');
    await expect(deviceModel.extract(image, 'p')).rejects.toThrow();
  });
  it('returns text when the response came from the device', async () => {
    g.LanguageModel = {};
    generateContent.mockResolvedValue(respond('on_device', 'ok'));
    const { deviceModel } = await import('../../src/adapters/firebaseAi');
    await expect(deviceModel.extract(image, 'p')).resolves.toBe('ok');
  });
});

describe('cloudModel.extract', () => {
  it('uses only-in-cloud mode with the given model', async () => {
    generateContent.mockResolvedValue(respond('in_cloud', 'c'));
    const { cloudModel } = await import('../../src/adapters/firebaseAi');
    await expect(cloudModel.extract(image, 'p', 'gemini-x')).resolves.toBe('c');
    expect(getGenerativeModel).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ mode: 'only_in_cloud', inCloudParams: expect.objectContaining({ model: 'gemini-x' }) }),
    );
  });
});
