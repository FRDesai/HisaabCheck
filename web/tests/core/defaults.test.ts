import { describe, it, expect } from 'vitest';
import { CLOUD_COST_PER_CALL_USD } from '../../src/core/config/defaults';

describe('defaults', () => {
  // The dashboard treats estCostUsd > 0 as "an image was sent to the cloud".
  it('a cloud call has a positive estimated cost', () => expect(CLOUD_COST_PER_CALL_USD).toBeGreaterThan(0));
});
