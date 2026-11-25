import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import { SearchService } from './search.service';

// Minimal MeiliSearch mock
const mockGetRawInfo = jest.fn();
const mockCreateIndex = jest.fn();
const mockUpdateSettings = jest.fn();
const mockSearch = jest.fn();
const mockHealth = jest.fn();

jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn().mockImplementation(() => ({
    health: mockHealth,
    createIndex: mockCreateIndex,
    index: jest.fn().mockReturnValue({
      getRawInfo: mockGetRawInfo,
      updateSettings: mockUpdateSettings,
      search: mockSearch,
      addDocuments: jest.fn(),
      deleteDocument: jest.fn(),
      getDocument: jest.fn(),
    }),
  })),
}));

jest.mock('bad-words', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    clean: (query: string) => query,
  })),
}));

describe('SearchService (Meilisearch)', () => {
  let service: SearchService;

  const buildModule = async (): Promise<TestingModule> => {
    return Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def: string) => def),
          },
        },
      ],
    }).compile();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReset();
    (MeiliSearch as jest.Mock).mockImplementation(() => ({
      health: mockHealth,
      createIndex: mockCreateIndex,
      index: jest.fn().mockReturnValue({
        getRawInfo: mockGetRawInfo,
        updateSettings: mockUpdateSettings,
        search: mockSearch,
        addDocuments: jest.fn(),
        deleteDocument: jest.fn(),
        getDocument: jest.fn(),
      }),
    }));
  });

  it('sets indexReady to true after a successful ensureIndex', async () => {
    mockGetRawInfo.mockResolvedValue({});
    mockUpdateSettings.mockResolvedValue({});

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);
    await service.onModuleInit();

    expect(service.isIndexReady()).toBe(true);
  });

  it('leaves indexReady false after a rejected ensureIndex', async () => {
    mockGetRawInfo.mockRejectedValue(new Error('connection refused'));
    mockCreateIndex.mockRejectedValue(new Error('connection refused'));

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);
    await service.onModuleInit();

    expect(service.isIndexReady()).toBe(false);
  });

  it('sets indexReady to true after a successful retry', async () => {
    // First call fails, second succeeds
    mockGetRawInfo
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({});
    mockCreateIndex.mockRejectedValue(new Error('timeout'));
    mockUpdateSettings.mockResolvedValue({});

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);

    // Replace retryDelayMs behaviour by directly calling initialiseIndex again
    await service.onModuleInit(); // fails
    expect(service.isIndexReady()).toBe(false);

    // Simulate retry by calling the private method via re-init
    await (service as any).initialiseIndex(); // succeeds
    expect(service.isIndexReady()).toBe(true);
  });

  it('delegates sanitized queries to the courses index', async () => {
    const hits = [{ id: 'course-1', title: 'Baking Basics' }];
    mockSearch.mockResolvedValue({ hits, estimatedTotalHits: 1 });

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);

    const result = await service.search({ query: '  baking  ' });

    expect(mockSearch).toHaveBeenCalledWith(
      'baking',
      expect.objectContaining({
        filter: 'status = ACTIVE',
        limit: 20,
        offset: 0,
      }),
    );
    expect(result).toMatchObject({
      hits,
      estimatedTotalHits: 1,
      totalPages: 1,
      query: 'baking',
    });
  });

  it('returns an empty result without contacting Meilisearch for blank queries', async () => {
    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);

    const result = await service.search({ query: '   ', page: 2, limit: 5 });

    expect(result).toMatchObject({
      hits: [],
      estimatedTotalHits: 0,
      page: 2,
      limit: 5,
      totalPages: 0,
    });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('propagates Meilisearch errors instead of returning a success-shaped result', async () => {
    const error = new Error('Meilisearch unavailable');
    mockSearch.mockRejectedValue(error);

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);

    await expect(service.search({ query: 'baking' })).rejects.toBe(error);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
  });
});
