import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { CacheService } from './cache.service';
import { HttpCacheInterceptor } from './cache.interceptor';

describe('HttpCacheInterceptor', () => {
  const key = 'cache:courses:courseId=1&page=2';
  const request = {
    method: 'GET',
    params: { courseId: '1' },
    query: { page: '2' },
  };
  const response = { setHeader: jest.fn() };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const cache = {
    buildKey: jest.fn().mockReturnValue(key),
    get: jest.fn(),
    set: jest.fn(),
  } as unknown as CacheService;
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  let interceptor: HttpCacheInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new HttpCacheInterceptor(cache, reflector);
    (reflector.getAllAndOverride as jest.Mock)
      .mockReturnValueOnce('courses')
      .mockReturnValueOnce(30);
  });

  it('returns cached values without invoking the handler', async () => {
    (cache.get as jest.Mock).mockResolvedValue({ items: ['cached'] });
    const next = { handle: jest.fn().mockReturnValue(of({ items: ['fresh'] })) };

    const result = await interceptor.intercept(context, next as CallHandler);

    await expect(firstValueFrom(result)).resolves.toEqual({ items: ['cached'] });
    expect(next.handle).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'HIT');
  });

  it('invokes and caches the handler response on a cache miss', async () => {
    (cache.get as jest.Mock).mockResolvedValue(null);
    const value = { items: ['fresh'] };
    const next = { handle: jest.fn().mockReturnValue(of(value)) };

    const result = await interceptor.intercept(context, next as CallHandler);

    await expect(firstValueFrom(result)).resolves.toEqual(value);
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(key, value, 30);
    expect(response.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'MISS');
  });
});
