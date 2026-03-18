import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamicSampler } from '../src/sampler';

describe('DynamicSampler', () => {
  let sampler: DynamicSampler;

  beforeEach(() => {
    sampler = new DynamicSampler({
      baseSampleRate: 1.0,
      errorRateThreshold: 0.1,
      degradedSampleRate: 0.5,
      windowDuration: 60000,
      minWindowEvents: 5,
    });
  });

  describe('basic sampling', () => {
    it('should always sample error events', () => {
      for (let i = 0; i < 10; i++) {
        const decision = sampler.shouldSample('error');
        expect(decision.sampled).toBe(true);
        expect(decision.sampleRate).toBe(1.0);
        expect(decision.eventType).toBe('error');
      }
    });

    it('should sample at configured base rate', () => {
      const halfSampler = new DynamicSampler({ baseSampleRate: 0.5 });

      // Mock random to return exactly 0.4 (below 0.5)
      vi.spyOn(Math, 'random').mockReturnValue(0.4);
      const decision = halfSampler.shouldSample('performance');
      expect(decision.sampled).toBe(true);
      expect(decision.sampleRate).toBe(0.5);

      // Mock random to return exactly 0.6 (above 0.5)
      vi.spyOn(Math, 'random').mockReturnValue(0.6);
      const decision2 = halfSampler.shouldSample('performance');
      expect(decision2.sampled).toBe(false);

      vi.restoreAllMocks();
    });

    it('should respect type-specific rates', () => {
      const typedSampler = new DynamicSampler({
        baseSampleRate: 1.0,
        typeRates: {
          performance: 0.3,
          network: 0.8,
        },
      });

      expect(typedSampler.getSampleRate('performance')).toBe(0.3);
      expect(typedSampler.getSampleRate('network')).toBe(0.8);
      expect(typedSampler.getSampleRate('behavior')).toBe(1.0); // base rate
    });

    it('should return sample decision with event type', () => {
      const decision = sampler.shouldSample('network');
      expect(decision.eventType).toBe('network');
    });
  });

  describe('dynamic adjustment', () => {
    it('should degrade when error rate exceeds threshold', () => {
      // Generate events to exceed threshold (>10% errors)
      // Need minWindowEvents=5, so generate 5 error + 5 normal
      // But we need >10% error rate, so mostly errors
      for (let i = 0; i < 4; i++) {
        sampler.shouldSample('error'); // 4 errors
      }
      for (let i = 0; i < 1; i++) {
        sampler.shouldSample('network'); // 1 normal
      }
      // error rate = 4/5 = 80% > 10%

      expect(sampler.isDegraded()).toBe(true);
      expect(sampler.getSampleRate('performance')).toBeLessThanOrEqual(0.5);
      expect(sampler.getSampleRate('network')).toBeLessThanOrEqual(0.5);
    });

    it('should not degrade below threshold', () => {
      // All normal events
      for (let i = 0; i < 10; i++) {
        sampler.shouldSample('network');
      }

      expect(sampler.isDegraded()).toBe(false);
      expect(sampler.getSampleRate('performance')).toBe(1.0);
    });

    it('should not degrade with insufficient events', () => {
      // Only 3 events (below minWindowEvents=5)
      sampler.shouldSample('error');
      sampler.shouldSample('error');
      sampler.shouldSample('error');

      expect(sampler.isDegraded()).toBe(false);
    });

    it('should recover when error rate drops', () => {
      // First degrade
      for (let i = 0; i < 5; i++) {
        sampler.shouldSample('error');
      }
      expect(sampler.isDegraded()).toBe(true);

      // Add many normal events to bring error rate down
      for (let i = 0; i < 50; i++) {
        sampler.shouldSample('network');
      }

      // Error rate should be 5/55 ≈ 9% < 10%
      expect(sampler.isDegraded()).toBe(false);
      expect(sampler.getSampleRate('performance')).toBe(1.0);
    });

    it('should keep error sampling at 1.0 even when degraded', () => {
      // Degrade
      for (let i = 0; i < 5; i++) {
        sampler.shouldSample('error');
      }

      expect(sampler.getSampleRate('error')).toBe(1.0);
    });
  });

  describe('setSampleRate', () => {
    it('should manually set sample rate for a type', () => {
      sampler.setSampleRate('network', 0.3);
      expect(sampler.getSampleRate('network')).toBe(0.3);
    });

    it('should clamp rate to [0, 1]', () => {
      sampler.setSampleRate('network', -0.5);
      expect(sampler.getSampleRate('network')).toBe(0);

      sampler.setSampleRate('network', 1.5);
      expect(sampler.getSampleRate('network')).toBe(1);
    });
  });

  describe('getErrorRate', () => {
    it('should return 0 with no events', () => {
      expect(sampler.getErrorRate()).toBe(0);
    });

    it('should calculate correct error rate', () => {
      sampler.shouldSample('error');
      sampler.shouldSample('error');
      sampler.shouldSample('network');
      sampler.shouldSample('network');

      // 2 errors out of 4 events = 50%
      expect(sampler.getErrorRate()).toBe(0.5);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      sampler.shouldSample('error');
      sampler.shouldSample('network');

      const stats = sampler.getStats();
      expect(stats.errorRate).toBe(0.5);
      expect(stats.degraded).toBe(false);
      expect(stats.windowSize).toBe(2);
      expect(stats.rates).toBeDefined();
      expect(stats.rates.error).toBe(1.0);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      // Degrade first
      for (let i = 0; i < 5; i++) {
        sampler.shouldSample('error');
      }
      expect(sampler.isDegraded()).toBe(true);

      sampler.reset();

      expect(sampler.isDegraded()).toBe(false);
      expect(sampler.getErrorRate()).toBe(0);
      expect(sampler.getSampleRate('performance')).toBe(1.0);
    });
  });

  describe('sliding window', () => {
    it('should expire old events from window', () => {
      vi.useFakeTimers();

      // Add events
      for (let i = 0; i < 5; i++) {
        sampler.shouldSample('error');
      }
      expect(sampler.getErrorRate()).toBe(1.0);

      // Advance past window duration (60s)
      vi.advanceTimersByTime(61000);

      // Force cleanup by calling getErrorRate
      expect(sampler.getErrorRate()).toBe(0);

      vi.useRealTimers();
    });
  });
});
