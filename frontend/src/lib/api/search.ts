import type {
  SearchQuery,
  SearchResponse,
  SearchResult,
  AutocompleteRequest,
  AutocompleteSuggestion,
  UserProfile,
  Team,
} from './workspace-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ==================== UNIVERSAL SEARCH API ====================

export const searchAPI = {
  /**
   * Universal search - searches across all entities
   */
  search: async (query: SearchQuery): Promise<SearchResponse> => {
    const response = await fetch(`${API_BASE_URL}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      throw new Error('Search failed');
    }

    return response.json();
  },

  /**
   * Autocomplete for @mentions and smart suggestions
   */
  autocomplete: async (request: AutocompleteRequest): Promise<AutocompleteSuggestion[]> => {
    const params = new URLSearchParams({
      q: request.query,
      context: request.context,
      limit: String(request.limit || 10),
    });

    if (request.workspace_id) params.append('workspace_id', request.workspace_id);
    if (request.team_id) params.append('team_id', request.team_id);
    if (request.filters?.only_team_members) params.append('only_team_members', 'true');
    if (request.filters?.include_teams) params.append('include_teams', 'true');

    const response = await fetch(`${API_BASE_URL}/api/autocomplete?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Autocomplete failed');
    }

    return response.json();
  },

  /**
   * Search users - for assignment, tagging, mentions
   */
  searchUsers: async (query: string, filters?: {
    workspace_id?: string;
    team_id?: string;
    exclude_ids?: string[];
    roles?: string[];
    limit?: number;
  }): Promise<UserProfile[]> => {
    const params = new URLSearchParams({ q: query });
    
    if (filters?.workspace_id) params.append('workspace_id', filters.workspace_id);
    if (filters?.team_id) params.append('team_id', filters.team_id);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.exclude_ids?.length) {
      params.append('exclude_ids', filters.exclude_ids.join(','));
    }
    if (filters?.roles?.length) {
      params.append('roles', filters.roles.join(','));
    }

    const response = await fetch(`${API_BASE_URL}/api/users/search?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('User search failed');
    }

    const data = await response.json();
    return data.users || [];
  },

  /**
   * Search teams - for filters, mentions, navigation
   */
  searchTeams: async (query: string, filters?: {
    organization_id?: string;
    workspace_id?: string;
    privacy?: ('open' | 'closed' | 'secret')[];
    limit?: number;
  }): Promise<Team[]> => {
    const params = new URLSearchParams({ q: query });
    
    if (filters?.organization_id) params.append('organization_id', filters.organization_id);
    if (filters?.workspace_id) params.append('workspace_id', filters.workspace_id);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.privacy?.length) {
      params.append('privacy', filters.privacy.join(','));
    }

    const response = await fetch(`${API_BASE_URL}/api/teams/search?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Team search failed');
    }

    const data = await response.json();
    return data.teams || [];
  },

  /**
   * Get search suggestions based on user's context
   */
  getSuggestions: async (query: string): Promise<string[]> => {
    const response = await fetch(
      `${API_BASE_URL}/api/search/suggestions?q=${encodeURIComponent(query)}`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.suggestions || [];
  },

  /**
   * Get recent searches for the current user
   */
  getRecentSearches: async (limit: number = 5): Promise<string[]> => {
    const response = await fetch(
      `${API_BASE_URL}/api/search/recent?limit=${limit}`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.searches || [];
  },

  /**
   * Save search to history
   */
  saveSearch: async (query: string): Promise<void> => {
    await fetch(`${API_BASE_URL}/api/search/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ query }),
    });
  },
};

// ==================== INTELLIGENT SEARCH PARSER ====================

export class SearchParser {
  /**
   * Parse search query and extract special syntax
   * Examples:
   * - "@john smith" -> mention/user search
   * - "#urgent" -> tag/label search
   * - "assignee:john" -> filter syntax
   * - "created:>2024-01-01" -> date filter
   */
  static parse(query: string): {
    cleanQuery: string;
    mentions: string[];
    tags: string[];
    filters: Record<string, any>;
    hasSpecialSyntax: boolean;
  } {
    let cleanQuery = query;
    const mentions: string[] = [];
    const tags: string[] = [];
    const filters: Record<string, any> = {};

    // Extract @mentions
    const mentionRegex = /@(\w+)/g;
    let match;
    while ((match = mentionRegex.exec(query)) !== null) {
      mentions.push(match[1]);
    }
    cleanQuery = cleanQuery.replace(mentionRegex, '').trim();

    // Extract #tags
    const tagRegex = /#(\w+)/g;
    while ((match = tagRegex.exec(query)) !== null) {
      tags.push(match[1]);
    }
    cleanQuery = cleanQuery.replace(tagRegex, '').trim();

    // Extract key:value filters
    const filterRegex = /(\w+):([^\s]+)/g;
    while ((match = filterRegex.exec(query)) !== null) {
      const key = match[1];
      const value = match[2];

      // Parse different filter types
      if (key === 'assignee' || key === 'assigned') {
        filters.assigned_to = filters.assigned_to || [];
        filters.assigned_to.push(value);
      } else if (key === 'creator' || key === 'created-by') {
        filters.created_by = filters.created_by || [];
        filters.created_by.push(value);
      } else if (key === 'status') {
        filters.status = filters.status || [];
        filters.status.push(value.toUpperCase());
      } else if (key === 'priority') {
        filters.priority = filters.priority || [];
        filters.priority.push(value.toUpperCase());
      } else if (key === 'team') {
        filters.teams = filters.teams || [];
        filters.teams.push(value);
      } else if (key === 'label' || key === 'tag') {
        filters.labels = filters.labels || [];
        filters.labels.push(value);
      } else if (key === 'created') {
        this.parseDateFilter(value, 'created', filters);
      } else if (key === 'updated') {
        this.parseDateFilter(value, 'updated', filters);
      } else if (key === 'due') {
        this.parseDateFilter(value, 'due', filters);
      } else if (key === 'is') {
        // Special flags: is:archived, is:unread, etc.
        if (value === 'archived') filters.is_archived = true;
        if (value === 'unread') filters.is_read = false;
      }
    }
    cleanQuery = cleanQuery.replace(filterRegex, '').trim();

    const hasSpecialSyntax = mentions.length > 0 || tags.length > 0 || Object.keys(filters).length > 0;

    return { cleanQuery, mentions, tags, filters, hasSpecialSyntax };
  }

  /**
   * Parse date filters with relative and absolute dates
   * Examples: >2024-01-01, <7d, >1w, today, yesterday
   */
  private static parseDateFilter(value: string, field: 'created' | 'updated' | 'due', filters: Record<string, any>) {
    const now = new Date();
    
    // Relative dates
    if (value.match(/^[<>]\d+[dwmy]$/)) {
      const operator = value[0];
      const amount = parseInt(value.slice(1, -1));
      const unit = value.slice(-1);
      
      let date = new Date(now);
      if (unit === 'd') date.setDate(date.getDate() - amount);
      if (unit === 'w') date.setDate(date.getDate() - amount * 7);
      if (unit === 'm') date.setMonth(date.getMonth() - amount);
      if (unit === 'y') date.setFullYear(date.getFullYear() - amount);
      
      const isoDate = date.toISOString().split('T')[0];
      if (operator === '>') {
        filters[`${field}_after`] = isoDate;
      } else {
        filters[`${field}_before`] = isoDate;
      }
    }
    // Absolute dates
    else if (value.match(/^[<>]\d{4}-\d{2}-\d{2}$/)) {
      const operator = value[0];
      const date = value.slice(1);
      
      if (operator === '>') {
        filters[`${field}_after`] = date;
      } else {
        filters[`${field}_before`] = date;
      }
    }
    // Special keywords
    else if (value === 'today') {
      const today = now.toISOString().split('T')[0];
      filters[`${field}_after`] = today;
      filters[`${field}_before`] = today;
    }
    else if (value === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const date = yesterday.toISOString().split('T')[0];
      filters[`${field}_after`] = date;
      filters[`${field}_before`] = date;
    }
    else if (value === 'this-week') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      filters[`${field}_after`] = startOfWeek.toISOString().split('T')[0];
    }
    else if (value === 'this-month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      filters[`${field}_after`] = startOfMonth.toISOString().split('T')[0];
    }
  }

  /**
   * Build search query from parsed components
   */
  static buildQuery(components: ReturnType<typeof SearchParser.parse>): SearchQuery {
    const filters = { ...components.filters };

    // Add tags to filters
    if (components.tags.length > 0) {
      filters.labels = [...(filters.labels || []), ...components.tags];
    }

    return {
      query: components.cleanQuery,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      sort: { field: 'relevance', order: 'desc' },
      pagination: { page: 1, limit: 20 },
    };
  }
}

// ==================== SEARCH UTILITIES ====================

export const searchUtils = {
  /**
   * Highlight matching text in search results
   */
  highlightMatches: (text: string, query: string): string => {
    if (!query) return text;
    
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  },

  /**
   * Debounce search input
   */
  debounce: <T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  /**
   * Format search result preview
   */
  formatPreview: (text: string, maxLength: number = 150): string => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + '...';
  },

  /**
   * Build breadcrumb path for result
   */
  buildBreadcrumb: (result: SearchResult): string[] => {
    const breadcrumb: string[] = [];
    
    if (result.metadata?.organization_name) {
      breadcrumb.push(result.metadata.organization_name);
    }
    if (result.metadata?.workspace_name) {
      breadcrumb.push(result.metadata.workspace_name);
    }
    if (result.metadata?.team_name) {
      breadcrumb.push(result.metadata.team_name);
    }
    
    return breadcrumb;
  },

  /**
   * Get entity icon name
   */
  getEntityIcon: (type: SearchResult['type']): string => {
    const icons: Record<SearchResult['type'], string> = {
      task: 'FileText',
      user: 'User',
      team: 'Users',
      document: 'File',
      comment: 'MessageSquare',
    };
    return icons[type] || 'File';
  },
};

// ==================== SEARCH HOOKS ====================

/**
 * Custom hook for intelligent search with caching
 */
export const useIntelligentSearch = () => {
  // This will be used in components for smart search functionality
  return {
    search: searchAPI.search,
    autocomplete: searchAPI.autocomplete,
    searchUsers: searchAPI.searchUsers,
    searchTeams: searchAPI.searchTeams,
    parse: SearchParser.parse,
    buildQuery: SearchParser.buildQuery,
  };
};
