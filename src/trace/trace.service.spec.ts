import { jest } from '@jest/globals';
import { TraceService } from './trace.service';

describe('TraceService', () => {
  it('loads trace mappings through the TypeORM repository', async () => {
    const find = jest.fn().mockResolvedValue([
      { cityId: 2, networkId: 'net-b' },
      { cityId: 1, networkId: 'net-a' },
    ]);
    const client = {} as never;
    const service = new TraceService(client, { find } as never);

    await expect(service.listMappings()).resolves.toEqual([
      { cityId: 2, networkId: 'net-b' },
      { cityId: 1, networkId: 'net-a' },
    ]);
    expect(find).toHaveBeenCalledWith({
      select: { cityId: true, networkId: true },
      order: { cityId: 'ASC', networkId: 'ASC' },
    });
  });
});
