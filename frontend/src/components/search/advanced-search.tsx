'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  Filter,
  Clock,
  User,
  Users,
  FileText,
  MessageSquare,
  Tag,
  Calendar,
  Building,
  ChevronDown,
  Sparkles,
  Hash,
  TrendingUp,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { searchAPI, SearchParser, searchUtils } from '@/lib/api/search';
import type {
  SearchQuery,
  SearchResult,
  SearchFilters,
  AutocompleteSuggestion,
  AutocompleteRequest,
} from '@/lib/api/workspace-types';

interface AdvancedSearchProps {
  onResultSelect?: (result: SearchResult) => void;
  placeholder?: string;
  className?: string;
  workspaceId?: string;
  teamId?: string;
}

export function AdvancedSearch({
  onResultSelect,
  placeholder = 'Search everything... Try @username, #tag, or /command',
  className,
  workspaceId,
  teamId,
}: AdvancedSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [parsedQuery, setParsedQuery] = useState<ReturnType<typeof SearchParser.parse> | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load recent searches on mount
  useEffect(() => {
    const loadRecent = async () => {
      try {
        const recent = await searchAPI.getRecentSearches(5);
        setRecentSearches(recent);
      } catch (error) {
        console.error('Failed to load recent searches:', error);
      }
    };
    loadRecent();
  }, []);

  // Detect @ mentions in the input
  const detectMention = useCallback((text: string, cursor: number) => {
    const beforeCursor = text.slice(0, cursor);
    const match = beforeCursor.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, []);

  // Parse query for intelligent search syntax
  useEffect(() => {
    if (query.trim()) {
      const parsed = SearchParser.parse(query);
      setParsedQuery(parsed);
      
      // Merge parsed filters with manual filters
      setFilters(prev => ({ ...prev, ...parsed.filters }));
    } else {
      setParsedQuery(null);
    }
  }, [query]);

  // Auto-complete suggestions for @mentions
  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['autocomplete', mentionQuery, workspaceId, teamId],
    queryFn: async () => {
      if (mentionQuery === null) return [];
      
      const request: AutocompleteRequest = {
        query: mentionQuery,
        context: 'mention',
        workspace_id: workspaceId,
        team_id: teamId,
        limit: 10,
        filters: {
          include_teams: true,
          include_roles: true,
          only_team_members: !!teamId,
        },
      };

      return await searchAPI.autocomplete(request);
    },
    enabled: mentionQuery !== null,
  });

  // Main search query with intelligent parsing
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['search', query, filters, workspaceId],
    queryFn: async () => {
      if (!query.trim()) return null;

      const searchQuery: SearchQuery = parsedQuery
        ? SearchParser.buildQuery(parsedQuery)
        : {
            query,
            filters,
            sort: { field: 'relevance', order: 'desc' },
            pagination: { page: 1, limit: 20 },
          };

      const response = await searchAPI.search(searchQuery);
      
      // Save to search history
      if (query.length > 2) {
        await searchAPI.saveSearch(query);
      }
      
      return response;
    },
    enabled: query.trim().length > 0 && mentionQuery === null,
  });

  // Handle input change and detect mentions
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart || 0;
    
    setQuery(value);
    setCursorPosition(cursor);
    
    const mention = detectMention(value, cursor);
    setMentionQuery(mention);
    setIsOpen(true);
  };

  // Insert mention into input
  const insertMention = (suggestion: AutocompleteSuggestion) => {
    if (!inputRef.current) return;

    const beforeCursor = query.slice(0, cursorPosition);
    const afterCursor = query.slice(cursorPosition);
    
    const beforeMention = beforeCursor.replace(/@\w*$/, '');
    const newQuery = `${beforeMention}@${suggestion.handle} ${afterCursor}`;
    
    setQuery(newQuery);
    setMentionQuery(null);
    inputRef.current.focus();
    
    // Set cursor after the inserted mention
    setTimeout(() => {
      const newPosition = beforeMention.length + suggestion.handle.length + 2;
      inputRef.current?.setSelectionRange(newPosition, newPosition);
    }, 0);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setMentionQuery(null);
    }
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const entityIcons = {
    task: FileText,
    user: User,
    team: Users,
    document: FileText,
    comment: MessageSquare,
  };

  return (
    <div className={cn('relative w-full', className)}>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="h-14 w-full rounded-3xl border border-slate-200 bg-white/90 pl-12 pr-24 text-sm text-slate-900 shadow-lg outline-none backdrop-blur-xl transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
        />

        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'rounded-2xl',
              showFilters && 'bg-sky-100 text-sky-600'
            )}
          >
            <Filter className="h-4 w-4" />
          </Button>
          
          {query && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
              }}
              className="rounded-2xl"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Advanced Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-0 right-0 top-full z-50 mt-2"
          >
            <Card className="border border-slate-200 bg-white p-4 shadow-2xl">
              <SearchFiltersPanel
                filters={filters}
                onChange={setFilters}
                workspaceId={workspaceId}
              />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Results / Autocomplete Dropdown */}
      <AnimatePresence>
        {isOpen && (mentionQuery !== null || query.trim()) && (
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[500px] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl"
          >
            {/* Autocomplete Suggestions for @mentions */}
            {mentionQuery !== null && (
              <div className="p-2">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Mention someone
                  </p>
                </div>
                {suggestionsLoading ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Loading suggestions...
                  </div>
                ) : suggestions && suggestions.length > 0 ? (
                  <div className="space-y-1">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        onClick={() => insertMention(suggestion)}
                        className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-slate-50"
                      >
                        {suggestion.type === 'user' ? (
                          <Avatar className="h-8 w-8">
                            {suggestion.avatar_url && <AvatarImage src={suggestion.avatar_url} alt={suggestion.display_name} />}
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-emerald-400 text-xs text-white">
                              {suggestion.display_name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100">
                            <Users className="h-4 w-4 text-sky-600" />
                          </div>
                        )}
                        
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">
                            {suggestion.display_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            @{suggestion.handle}
                            {suggestion.metadata?.title && ` · ${suggestion.metadata.title}`}
                            {suggestion.metadata?.team_name && ` · ${suggestion.metadata.team_name}`}
                          </p>
                        </div>
                        
                        <Badge variant="outline" className="rounded-full text-xs">
                          {suggestion.type}
                        </Badge>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No matches found
                  </div>
                )}
              </div>
            )}

            {/* Search Results */}
            {mentionQuery === null && query.trim() && (
              <div className="p-2">
                {searchLoading ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Searching...
                  </div>
                ) : searchResults && searchResults.results.length > 0 ? (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {searchResults.total} results · {searchResults.took_ms}ms
                      </p>
                    </div>
                    <div className="space-y-1">
                      {searchResults.results.map((result) => {
                        const Icon = entityIcons[result.type] || FileText;
                        return (
                          <button
                            key={result.id}
                            onClick={() => {
                              onResultSelect?.(result);
                              setIsOpen(false);
                            }}
                            className="flex w-full items-start gap-3 rounded-2xl p-3 text-left transition hover:bg-slate-50"
                          >
                            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-100 to-emerald-100">
                              <Icon className="h-4 w-4 text-blue-600" />
                            </div>
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-slate-900">
                                  {result.title}
                                </p>
                                <Badge variant="outline" className="rounded-full text-xs">
                                  {result.type}
                                </Badge>
                              </div>
                              
                              {result.description && (
                                <p className="mt-1 text-sm text-slate-600 line-clamp-2">
                                  {result.description}
                                </p>
                              )}
                              
                              {result.highlights && result.highlights.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {result.highlights.map((highlight, i) => (
                                    <Badge
                                      key={i}
                                      variant="secondary"
                                      className="rounded-full bg-yellow-100 text-yellow-800"
                                    >
                                      <Sparkles className="mr-1 h-3 w-3" />
                                      {highlight}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              
                              {result.breadcrumb && (
                                <p className="mt-2 text-xs text-slate-400">
                                  {result.breadcrumb.join(' / ')}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center">
                    <p className="text-sm font-semibold text-slate-900">No results found</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Try different keywords or use @ to mention users
                    </p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Filters Panel Component
function SearchFiltersPanel({
  filters,
  onChange,
  workspaceId,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  workspaceId?: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Entity Types
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['task', 'user', 'team', 'document'] as const).map((type) => (
            <Button
              key={type}
              variant={filters.entity_types?.includes(type) ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                const current = filters.entity_types || [];
                onChange({
                  ...filters,
                  entity_types: current.includes(type)
                    ? current.filter((t) => t !== type)
                    : [...current, type],
                });
              }}
              className="rounded-2xl capitalize"
            >
              {type}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Created After
          </label>
          <input
            type="date"
            value={filters.created_after || ''}
            onChange={(e) => onChange({ ...filters, created_after: e.target.value })}
            className="mt-2 h-10 w-full rounded-2xl border border-slate-200 px-3 text-sm"
            aria-label="Created After"
          />
        </div>
        
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Created Before
          </label>
          <input
            type="date"
            value={filters.created_before || ''}
            onChange={(e) => onChange({ ...filters, created_before: e.target.value })}
            className="mt-2 h-10 w-full rounded-2xl border border-slate-200 px-3 text-sm"
            aria-label="Created Before"
          />
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({})}
        className="w-full rounded-2xl"
      >
        Clear All Filters
      </Button>
    </div>
  );
}

// Mock functions (replace with actual API calls)
function mockAutocompleteSuggestions(
  request: AutocompleteRequest
): AutocompleteSuggestion[] {
  return [
    {
      type: 'user',
      id: '1',
      display_name: 'John Doe',
      handle: 'johndoe',
      avatar_url: undefined,
      metadata: { title: 'Senior Developer', department: 'Engineering' },
      relevance_score: 1.0,
    },
    {
      type: 'team',
      id: '2',
      display_name: 'Engineering Team',
      handle: 'engineering',
      metadata: { team_name: 'Engineering', member_count: 15 },
      relevance_score: 0.9,
    },
  ];
}

function mockSearchResults(query: SearchQuery): any {
  return {
    results: [
      {
        type: 'task',
        id: '1',
        title: 'Implement advanced search feature',
        description: 'Add @mention support and autocomplete',
        highlights: ['search', 'mention'],
        metadata: {},
        relevance_score: 1.0,
        breadcrumb: ['Engineering', 'Frontend', 'Features'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    took_ms: 45,
  };
}
