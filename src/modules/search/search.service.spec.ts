import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import { SearchService } from './search.service';

const mockSearch = jest.fn();
const mockIndex = { search: mockSearch };
const mockClient = {
  index: jest.fn().mockReturnValue(mockIndex),
};

jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock('bad-words', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    clean: (query: string) => query,
  })),
}));

describe('SearchService', () => {
  let service: SearchService;
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) => defaultValue),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReset();
    mockClient.index.mockReturnValue(mockIndex);
    (MeiliSearch as jest.Mock).mockImplementation(() => mockClient);
    service = new SearchService(config);
  });

  it('delegates sanitized queries to the courses index', async () => {
    const hits = [{ id: 'course-1', title: 'Baking Basics' }];
    mockSearch.mockResolvedValue({ hits, estimatedTotalHits: 1 });

    const result = await service.search({ query: '  baking  ' });

    expect(mockClient.index).toHaveBeenCalledWith('courses');
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

    await expect(service.search({ query: 'baking' })).rejects.toBe(error);
  });
});
