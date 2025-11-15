# Intelligent Universal Search System

## Overview

This system implements a comprehensive, intelligent search functionality across the entire application with advanced syntax parsing, @mentions, filters, and real-time autocomplete.

## Features

### 1. **Universal Search Bar** (Header)
- Global search accessible from any page
- Real-time autocomplete with @mentions
- Entity type filtering (tasks, users, teams, documents, comments)
- Navigate directly to results from dropdown
- Recent searches history

### 2. **Intelligent Search Syntax**

#### Basic Search
```
Design review meeting
```
Searches for text in titles and descriptions.

#### @Mentions (User/Team Search)
```
@john
@engineering
```
- Searches for users by name or username
- Searches for teams
- Provides autocomplete suggestions
- Scoped to current workspace/team for security

#### #Tags
```
#urgent
#bug #feature
```
- Searches for tasks with specific tags/labels
- Multiple tags supported

#### Advanced Filters

**Assignee Filter:**
```
assignee:john
assigned:jane
```

**Status Filter:**
```
status:in_progress
status:todo status:done
```
Supported values: `todo`, `in_progress`, `done`

**Priority Filter:**
```
priority:urgent
priority:high priority:medium
```
Supported values: `low`, `medium`, `high`, `urgent`

**Team Filter:**
```
team:engineering
team:design
```

**Label/Tag Filter:**
```
label:urgent
tag:bug
```

**Date Filters:**

Relative dates:
```
created:>7d          # Created more than 7 days ago
created:<30d         # Created less than 30 days ago
updated:>1w          # Updated more than 1 week ago
due:<3d              # Due in less than 3 days
```

Absolute dates:
```
created:>2024-01-01  # Created after Jan 1, 2024
created:<2024-12-31  # Created before Dec 31, 2024
```

Special keywords:
```
created:today
created:yesterday
created:this-week
created:this-month
```

**Special Flags:**
```
is:archived          # Show archived items
is:unread            # Show unread items
```

#### Combined Syntax
```
@john #urgent priority:high status:in_progress created:>7d
```
This searches for:
- Tasks assigned to John
- Tagged with #urgent
- High priority
- Currently in progress
- Created in the last 7 days

### 3. **Task Creation with Intelligent Assignment**

The task creation modal includes:
- **Smart user selector** with autocomplete
- Search by name, username, or email
- @mention syntax support
- Multi-select with visual pills
- Team-based filtering
- Maximum selection limits

### 4. **Tasks Page Intelligent Filtering**

The tasks page implements:
- Realtime search with syntax parsing
- Visual badges showing active smart filters
- Advanced filter panel with:
  - Assignee selector (multi-select)
  - Tag filters (quick badges)
  - Priority filters
  - Status filters
- Search query preserved in URL params
- Debounced search (300ms)

## Architecture

### Core Files

#### `/src/lib/api/search.ts`
Main search service with:
- `searchAPI`: REST API client for all search endpoints
- `SearchParser`: Intelligent query parser for special syntax
- `searchUtils`: Helper functions (highlighting, debouncing, formatting)
- `useIntelligentSearch`: React hook for components

**Key Functions:**
- `searchAPI.search(query)` - Universal search across all entities
- `searchAPI.autocomplete(request)` - @mention autocomplete
- `searchAPI.searchUsers(query, filters)` - User-specific search
- `searchAPI.searchTeams(query, filters)` - Team-specific search
- `SearchParser.parse(query)` - Extract mentions, tags, filters from text
- `SearchParser.buildQuery(components)` - Build SearchQuery object from parsed components

#### `/src/components/common/user-selector.tsx`
Reusable user/team selector component with:
- Real-time search with 300ms debounce
- @mention detection
- Multi-select with visual pills
- Team filtering support
- Workspace/team scoping
- Max selection limits
- Avatar display
- Click-outside-to-close

#### `/src/components/search/advanced-search.tsx`
Global search component with:
- Real-time @mention autocomplete
- Entity type filters
- Advanced filters panel (dates, status, priority)
- Recent searches
- Search suggestions
- Result navigation
- Keyboard shortcuts (Escape to close)

#### `/src/app/tasks/page.tsx`
Enhanced with:
- Intelligent search parsing integration
- Visual smart filter badges
- Advanced filter panel toggle
- User selector for assignee filtering
- Tag-based filtering
- Search syntax help hints

## Search Syntax Parsing Logic

The `SearchParser` class uses regex patterns to extract:

1. **@Mentions**: `/@(\w+)/g`
2. **#Tags**: `/#(\w+)/g`
3. **Key:Value Filters**: `/(\w+):([^\s]+)/g`

Then intelligently maps filter keys:
- `assignee` or `assigned` → `assigned_to`
- `creator` or `created-by` → `created_by`
- `status` → `status` (uppercase)
- `priority` → `priority` (uppercase)
- `team` → `teams`
- `label` or `tag` → `labels`
- `created`, `updated`, `due` → date filters with parsing

### Date Filter Parser

Supports three formats:

**1. Relative:**
- `>7d` - More than 7 days ago
- `<2w` - Less than 2 weeks ago
- Units: `d` (days), `w` (weeks), `m` (months), `y` (years)

**2. Absolute:**
- `>2024-01-01` - After date
- `<2024-12-31` - Before date

**3. Keywords:**
- `today` - Current day
- `yesterday` - Previous day
- `this-week` - Current week
- `this-month` - Current month

## Security & Privacy

### Workspace Scoping
- @mentions only show users/teams within current workspace
- Search results filtered by user permissions
- Team privacy respected (open/closed/secret)

### Permission-Based Results
- Users only see results they have access to
- Organization members auto-join based on email domain
- Private workspaces require explicit invites

## Backend API Endpoints

### Search Endpoints
```typescript
POST /api/search
Body: SearchQuery
Response: SearchResponse

GET /api/autocomplete?q=john&context=mention&workspace_id=123
Response: AutocompleteSuggestion[]

GET /api/users/search?q=john&workspace_id=123
Response: { users: UserProfile[] }

GET /api/teams/search?q=engineering&organization_id=456
Response: { teams: Team[] }

GET /api/search/suggestions?q=urgent
Response: { suggestions: string[] }

GET /api/search/recent?limit=5
Response: { searches: string[] }

POST /api/search/history
Body: { query: string }
Response: void
```

### Required Database Indexes

For optimal performance, create these indexes:

```sql
-- Tasks full-text search
CREATE INDEX idx_tasks_search ON tasks USING GIN(to_tsvector('english', title || ' ' || description));

-- User search
CREATE INDEX idx_users_search ON users USING GIN(to_tsvector('english', name || ' ' || username || ' ' || email));

-- Team search
CREATE INDEX idx_teams_search ON teams USING GIN(to_tsvector('english', name || ' ' || description));

-- Date range filters
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);

-- Status and priority filters
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);

-- Assignee lookups
CREATE INDEX idx_task_assignments_user_id ON task_assignments(user_id);
CREATE INDEX idx_task_assignments_task_id ON task_assignments(task_id);

-- Tag lookups
CREATE INDEX idx_task_tags_tag ON task_tags(tag);
```

## Elasticsearch Integration (Optional)

For large-scale deployments, integrate Elasticsearch:

### Index Mapping
```json
{
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "english" },
      "description": { "type": "text", "analyzer": "english" },
      "status": { "type": "keyword" },
      "priority": { "type": "keyword" },
      "assigned_to": { "type": "keyword" },
      "tags": { "type": "keyword" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" },
      "due_date": { "type": "date" },
      "workspace_id": { "type": "keyword" },
      "team_id": { "type": "keyword" },
      "organization_id": { "type": "keyword" }
    }
  }
}
```

### Query Builder
```typescript
const buildElasticsearchQuery = (parsed: ParsedSearch) => {
  const must: any[] = [];
  
  if (parsed.cleanQuery) {
    must.push({
      multi_match: {
        query: parsed.cleanQuery,
        fields: ['title^2', 'description'],
        type: 'best_fields',
      },
    });
  }
  
  if (parsed.mentions.length) {
    must.push({
      terms: { assigned_to: parsed.mentions },
    });
  }
  
  if (parsed.tags.length) {
    must.push({
      terms: { tags: parsed.tags },
    });
  }
  
  const filter: any[] = [];
  
  if (parsed.filters.status) {
    filter.push({ terms: { status: parsed.filters.status } });
  }
  
  if (parsed.filters.priority) {
    filter.push({ terms: { priority: parsed.filters.priority } });
  }
  
  if (parsed.filters.created_after) {
    filter.push({ range: { created_at: { gte: parsed.filters.created_after } } });
  }
  
  return {
    query: {
      bool: { must, filter },
    },
    highlight: {
      fields: {
        title: {},
        description: {},
      },
    },
  };
};
```

## Usage Examples

### Component Integration

```typescript
import { useIntelligentSearch } from '@/lib/api/search';

function MyComponent() {
  const { search, autocomplete, parse } = useIntelligentSearch();
  const [query, setQuery] = useState('');
  
  const handleSearch = async () => {
    const parsed = parse(query);
    const searchQuery = SearchParser.buildQuery(parsed);
    const results = await search(searchQuery);
    // Handle results...
  };
  
  const handleAutocomplete = async (mention: string) => {
    const suggestions = await autocomplete({
      query: mention,
      context: 'mention',
      workspace_id: currentWorkspace,
    });
    // Show suggestions...
  };
}
```

### UserSelector Integration

```typescript
import UserSelector from '@/components/common/user-selector';

function TaskForm() {
  const [assignees, setAssignees] = useState<string[]>([]);
  
  return (
    <UserSelector
      value={assignees}
      onChange={setAssignees}
      placeholder="Search and assign users..."
      multiple={true}
      includeTeams={true}
      workspace_id={currentWorkspace}
      maxSelections={5}
    />
  );
}
```

## Performance Optimization

1. **Debouncing**: 300ms delay prevents excessive API calls
2. **Caching**: React Query caches search results
3. **Pagination**: Limit 20 results per page
4. **Lazy Loading**: Load more results on scroll
5. **Indexes**: Database indexes for common queries
6. **CDN**: Cache static autocomplete data
7. **WebSocket**: Real-time updates for mentions

## Future Enhancements

1. **Saved Searches**: Save frequently used search queries
2. **Search Templates**: Pre-built search queries for common tasks
3. **Natural Language**: "Show me urgent tasks from last week"
4. **Voice Search**: Speech-to-text search input
5. **Search Analytics**: Track popular searches
6. **Spell Check**: Suggest corrections for typos
7. **Synonyms**: Handle variations (urgent = critical)
8. **Faceted Search**: Dynamic filter suggestions based on results
9. **Search Sharing**: Share search URLs with team
10. **Export Results**: Export search results to CSV/PDF

## Testing

### Unit Tests
```typescript
describe('SearchParser', () => {
  it('parses @mentions correctly', () => {
    const result = SearchParser.parse('@john design');
    expect(result.mentions).toEqual(['john']);
    expect(result.cleanQuery).toBe('design');
  });
  
  it('parses date filters', () => {
    const result = SearchParser.parse('created:>7d');
    expect(result.filters.created_after).toBeDefined();
  });
  
  it('handles combined syntax', () => {
    const result = SearchParser.parse('@john #urgent priority:high');
    expect(result.mentions).toEqual(['john']);
    expect(result.tags).toEqual(['urgent']);
    expect(result.filters.priority).toEqual(['HIGH']);
  });
});
```

### Integration Tests
- Test search API endpoints
- Test autocomplete with real database
- Test permission filtering
- Test date range queries

## Troubleshooting

**Search not working:**
- Check backend API is running
- Verify database indexes exist
- Check network requests in dev tools
- Verify user has workspace access

**Autocomplete not showing:**
- Check workspace_id is set
- Verify user has permission to see team members
- Check debounce delay (300ms)
- Verify backend returns suggestions

**Slow performance:**
- Add database indexes
- Reduce result limit
- Enable Elasticsearch
- Add CDN caching
- Optimize regex patterns

