import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { TraceController } from './trace.controller';

describe('TraceController', () => {
  const service = {
    record: jest.fn(),
    replay: jest.fn(),
    compare: jest.fn(),
  };
  const controller = new TraceController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('starts recording through the trace service', async () => {
    await controller.record({ output: 'trace.json', hours: 2 });
    expect(service.record).toHaveBeenCalledWith({
      output: 'trace.json',
      hours: 2,
    });
  });

  it('replays and compares a trace through HTTP payloads', async () => {
    await controller.replay({
      tracePath: 'trace.json',
      policy: 'fixed',
      budget: 10,
    });
    await controller.compare({ tracePath: 'trace.json' });
    expect(service.replay).toHaveBeenCalledWith({
      tracePath: 'trace.json',
      policy: 'fixed',
      budget: 10,
    });
    expect(service.compare).toHaveBeenCalledWith({ tracePath: 'trace.json' });
  });

  it('rejects an unknown replay policy', () => {
    expect(() =>
      controller.replay({ tracePath: 'trace.json', policy: 'other' }),
    ).toThrow(BadRequestException);
  });
});
