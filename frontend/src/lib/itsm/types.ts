// Types for the service desk (ITSM) REST API served under /api/v2.

export interface UserBrief {
  id: string;
  name: string;
  email: string;
  is_agent: boolean;
  job_title?: string;
  active: boolean;
  avatar_url?: string;
}

export interface Ref {
  id: string;
  name: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface ApiFieldErrors {
  [field: string]: string;
}

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed' | string;
export type TicketType = 'incident' | 'service_request';
export type SLAState = 'none' | 'on_track' | 'due_soon' | 'overdue' | 'paused' | 'met' | 'violated';

export interface Ticket {
  id: string;
  number: number;
  display_id: string;
  type: TicketType;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: number;
  urgency: number;
  impact: number;
  source: string;
  requester_id: string;
  responder_id: string | null;
  group_id: string | null;
  department_id: string | null;
  category: string;
  sub_category: string;
  item_category: string;
  tags: string[];
  cc_emails: string[];
  custom_fields: Record<string, unknown>;
  due_by: string | null;
  fr_due_by: string | null;
  is_escalated: boolean;
  fr_escalated: boolean;
  first_responded_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  pending_since: string | null;
  parent_id: string | null;
  merged_into_id: string | null;
  resolution_notes: string;
  is_spam: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  requester: UserBrief | null;
  responder: UserBrief | null;
  group: Ref | null;
  department: Ref | null;
  sla_state: SLAState;
}

export interface Attachment {
  id: string;
  name: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  entity_type: string;
  entity_id: string;
  user_id: string;
  body: string;
  private: boolean;
  incoming: boolean;
  kind: 'reply' | 'note' | 'forward' | 'system';
  to_emails: string[];
  cc_emails: string[];
  attachments: Attachment[];
  author: UserBrief | null;
  created_at: string;
  updated_at: string;
}

export interface WorkTask {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'completed';
  due_date: string | null;
  agent_id: string | null;
  group_id: string | null;
  completed_at: string | null;
  agent: UserBrief | null;
  group: Ref | null;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  agent_id: string;
  note: string;
  billable: boolean;
  minutes: number;
  executed_at: string;
  timer_running: boolean;
  started_at: string | null;
  agent?: UserBrief | null;
}

export interface Activity {
  id: string;
  action: string;
  summary: string;
  changes: { field: string; from: unknown; to: unknown }[] | null;
  actor: UserBrief | null;
  created_at: string;
}

export interface Association {
  id: string;
  type: 'ticket' | 'problem' | 'change' | 'release' | 'asset' | 'work_item';
  display_id: string;
  project_id?: string;
  title: string;
  status: string;
  priority?: number;
  link_id: string;
  link_type: string;
  direction: 'incoming' | 'outgoing';
}

export interface Problem {
  id: string;
  number: number;
  display_id: string;
  subject: string;
  description: string;
  status: 'open' | 'change_requested' | 'closed';
  priority: number;
  impact: number;
  requester_id: string | null;
  agent_id: string | null;
  group_id: string | null;
  department_id: string | null;
  category: string;
  sub_category: string;
  item_category: string;
  business_impact: string;
  due_by: string | null;
  known_error: boolean;
  root_cause: string;
  impact_analysis: string;
  symptoms: string;
  workaround: string;
  tags: string[];
  agent: UserBrief | null;
  requester: UserBrief | null;
  group: Ref | null;
  department: Ref | null;
  incident_count: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Change {
  id: string;
  number: number;
  display_id: string;
  subject: string;
  description: string;
  status: string;
  /** minor | standard | major | emergency, or an admin-defined type. */
  change_type: string;
  priority: number;
  impact: number;
  risk: number;
  approval_status: 'not_requested' | 'requested' | 'approved' | 'rejected';
  requester_id: string | null;
  agent_id: string | null;
  group_id: string | null;
  department_id: string | null;
  category: string;
  sub_category: string;
  item_category: string;
  business_impact: string;
  planned_start: string | null;
  planned_end: string | null;
  reason: string;
  impact_plan: string;
  rollout_plan: string;
  backout_plan: string;
  release_id: string | null;
  tags: string[];
  agent: UserBrief | null;
  requester: UserBrief | null;
  group: Ref | null;
  department: Ref | null;
  release: Ref | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Release {
  id: string;
  number: number;
  display_id: string;
  subject: string;
  description: string;
  release_type: string;
  status: string;
  priority: number;
  agent_id: string | null;
  group_id: string | null;
  category: string;
  planned_start: string | null;
  planned_end: string | null;
  work_start: string | null;
  work_end: string | null;
  build_plan: string;
  test_plan: string;
  tags: string[];
  agent: UserBrief | null;
  group: Ref | null;
  change_count: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  entity_type: string;
  entity_id: string;
  approver_id: string;
  requested_by_id: string;
  status: 'requested' | 'approved' | 'rejected' | 'cancelled';
  remark: string;
  responded_at: string | null;
  approver: UserBrief | null;
  requested_by: UserBrief | null;
  record: { id: string; type: string; display_id: string; title: string; status: string } | null;
  created_at: string;
}

export interface AssetType {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  fields: { name: string; label: string; type: string; choices?: string[] }[];
  icon: string;
  visible: boolean;
  asset_count: number;
}

export interface Asset {
  id: string;
  number: number;
  display_id: string;
  name: string;
  asset_tag: string;
  asset_type_id: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  usage_type: 'permanent' | 'loaner';
  state: string;
  user_id: string | null;
  department_id: string | null;
  location_id: string | null;
  agent_id: string | null;
  group_id: string | null;
  assigned_on: string | null;
  product_id: string | null;
  vendor_id: string | null;
  cost: number;
  serial_number: string;
  acquisition_date: string | null;
  warranty_expiry: string | null;
  end_of_life: string | null;
  type_fields: Record<string, unknown>;
  tags: string[];
  asset_type: Ref | null;
  user: UserBrief | null;
  agent: UserBrief | null;
  group: Ref | null;
  department: Ref | null;
  location: Ref | null;
  product: Ref | null;
  vendor: Ref | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  description: string;
  contact_name: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  address: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  asset_type_id: string | null;
  manufacturer: string;
  status: string;
  procurement_mode: string;
  description: string;
}

export interface Contract {
  id: string;
  number: number;
  name: string;
  contract_type: string;
  status: string;
  vendor_id: string | null;
  approver_id: string | null;
  cost: number;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  renewal_notice_days: number;
  notify_to_ids: string[];
  description: string;
  license_type: string;
  license_count: number;
  billing_cycle: string;
  software_id: string | null;
  asset_ids: string[];
}

export interface POItem {
  id?: string;
  item_type: string;
  item_name: string;
  asset_type_id?: string;
  product_id?: string;
  description: string;
  cost: number;
  quantity: number;
  received?: number;
}

export interface PurchaseOrder {
  id: string;
  number: number;
  name: string;
  po_number: string;
  vendor_id: string | null;
  status: string;
  expected_delivery: string | null;
  shipping_address: string;
  billing_address: string;
  currency: string;
  tax_percent: number;
  shipping_cost: number;
  discount_percent: number;
  items: POItem[] | unknown;
  total: number;
  department_id: string | null;
  terms: string;
  created_at: string;
}

export interface Software {
  id: string;
  name: string;
  publisher: string;
  category: string;
  status: string;
  license_type: string;
  description: string;
  managed_by_id: string | null;
}

export interface CatalogField {
  name: string;
  label: string;
  type: 'text' | 'paragraph' | 'number' | 'dropdown' | 'checkbox' | 'date' | 'multi_select';
  required?: boolean;
  choices?: string[];
  placeholder?: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  position: number;
}

export interface CatalogItem {
  id: string;
  category_id: string | null;
  name: string;
  short_description: string;
  description: string;
  cost: number;
  delivery_hours: number;
  status: 'draft' | 'published';
  icon: string;
  quantity_enabled: boolean;
  fields: CatalogField[];
  approval_required: boolean;
  approver_type: string;
  approver_ids: string[];
  delivery_group_id: string | null;
  delivery_agent_id: string | null;
  allow_attachments: boolean;
  visibility: string;
  department_ids: string[];
  position: number;
}

export interface KBFolder {
  id: string;
  category_id: string;
  name: string;
  description: string;
  visibility: string;
  department_ids: string[];
  position: number;
  article_count: number;
}

export interface KBCategory {
  id: string;
  name: string;
  description: string;
  position: number;
  folders: KBFolder[];
}

export interface Article {
  id: string;
  folder_id: string;
  title: string;
  body: string;
  status: 'draft' | 'published';
  article_type: 'permanent' | 'workaround';
  tags: string[];
  keywords: string;
  author_id: string;
  author: UserBrief | null;
  folder: Ref | null;
  views: number;
  thumbs_up: number;
  thumbs_down: number;
  review_date: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  email: string;
  username: string;
  name: string;
  platform_role: string;
  is_account_admin: boolean;
  active: boolean;
  locked: boolean;
  has_logged_in: boolean;
  last_login: string | null;
  must_change_password: boolean;
  /** False until an invited person opens their activation link. */
  email_verified?: boolean;
  created_at: string;
  user_id: string;
  is_agent: boolean;
  agent_type: string;
  role_ids: string[];
  ticket_scope: string;
  job_title: string;
  job_role_id?: string | null;
  job_role?: JobRoleRef | null;
  phone: string;
  mobile: string;
  department_id: string | null;
  location_id: string | null;
  reporting_manager_id: string | null;
  time_zone: string;
  language: string;
  signature: string;
  address: string;
  background: string;
  vip: boolean;
  external_id: string;
  available: boolean;
  department: Ref | null;
  location: Ref | null;
  reporting_manager: UserBrief | null;
  roles: Ref[];
  groups: Ref[];
  observer_of: Ref[];
  avatar_url?: string;
  out_of_office: boolean;
  ooo_start: string | null;
  ooo_end: string | null;
  ooo_delegate_id: string | null;
  ooo_message: string;
  ooo_delegate: UserBrief | null;
}

/** Where a person sits in the organization. */
export interface OrgContext {
  unit_path: Ref[];
  manager_chain: UserBrief[];
  direct_reports: UserBrief[];
  teams: Ref[];
}

export interface AgentGroup {
  id: string;
  name: string;
  description: string;
  escalate_to_id: string | null;
  unassigned_for_minutes: number;
  business_hours_id: string | null;
  auto_assign: boolean;
  restricted: boolean;
  members: UserBrief[];
  observers: UserBrief[];
  member_ids: string[];
  observer_ids: string[];
  leader_id: string | null;
  leader: UserBrief | null;
  email: string;
  open_tickets: number;
  escalate_to: UserBrief | null;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  privileges: string[];
  is_default: boolean;
  agent_count: number;
}

export interface Privilege {
  key: string;
  label: string;
  group: string;
}

export type UnitKind = 'company' | 'division' | 'business_unit' | 'department' | 'unit';

/** An organizational unit (OU); the API still calls these departments. */
export interface Department {
  id: string;
  name: string;
  description: string;
  kind: UnitKind;
  code: string;
  cost_center: string;
  email: string;
  parent_id: string | null;
  head_user_id: string | null;
  prime_user_id: string | null;
  location_id: string | null;
  head: UserBrief | null;
  prime_user: UserBrief | null;
  location: Ref | null;
  domains: string[];
  path: Ref[];
  depth: number;
  child_count: number;
  member_count: number;
  total_members: number;
}

export interface TeamCondition {
  field: string;
  operator: string;
  value: string;
}

export interface TeamRules {
  match: 'all' | 'any';
  conditions: TeamCondition[];
}

export interface Team {
  id: string;
  name: string;
  description: string;
  kind: 'static' | 'dynamic';
  lead_user_id: string | null;
  unit_id: string | null;
  email: string;
  color: string;
  rules: TeamRules;
  lead: UserBrief | null;
  unit: Ref | null;
  member_count: number;
  preview: UserBrief[];
}

export interface NotificationPref {
  key: string;
  label: string;
  group: string;
  in_app: boolean;
  email: boolean;
  email_available: boolean;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  user_agent: string;
  ip: string;
  current: boolean;
}

export interface ImportRow {
  line: number;
  email: string;
  name: string;
  action: 'create' | 'update' | 'error';
  errors?: Record<string, string>;
  temporary_password?: string;
}

export interface Location {
  id: string;
  name: string;
  parent_id: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  zip: string;
  contact_name: string;
  email: string;
  phone: string;
}

export interface DaySpec {
  start: string;
  end: string;
}

export interface BusinessHours {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  time_zone: string;
  always_open: boolean;
  working_hours: Record<string, DaySpec[]>;
  holidays: { date: string; name: string }[];
}

export interface SLATarget {
  priority: number;
  respond_within_minutes: number;
  resolve_within_minutes: number;
  business_hours: boolean;
  escalation_enabled: boolean;
}

export interface SLAPolicy {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  active: boolean;
  position: number;
  conditions: {
    ticket_types?: string[];
    sources?: string[];
    group_ids?: string[];
    department_ids?: string[];
    categories?: string[];
  };
  targets: SLATarget[];
  escalations: Record<string, unknown>;
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface AutomationAction {
  type: string;
  value?: unknown;
  to?: string;
  subject?: string;
  body?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  module: string;
  event: string;
  active: boolean;
  position: number;
  conditions: { match: 'all' | 'any'; rules: RuleCondition[] };
  actions: AutomationAction[];
  stop_processing: boolean;
  execution_count: number;
  last_executed_at: string | null;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  actions: AutomationAction[];
  visibility: 'all' | 'groups' | 'me';
  group_ids: string[];
  created_by_id: string;
}

export interface CannedResponse {
  id: string;
  folder_id: string | null;
  title: string;
  content: string;
  visibility: 'all' | 'groups' | 'me';
  group_ids: string[];
  created_by_id: string;
}

export interface FormField {
  id: string;
  entity: string;
  name: string;
  label: string;
  label_for_requester: string;
  field_type: string;
  choices: ClassificationChoice[];
  required_for_agents: boolean;
  required_for_closure: boolean;
  required_for_requesters: boolean;
  displayed_to_requester: boolean;
  editable_by_requester: boolean;
  position: number;
  is_default: boolean;
  active: boolean;
}

export interface JobRoleRef {
  id: string;
  name: string;
  /** 1 is the most senior. */
  level: number;
}

export interface JobRole extends JobRoleRef {
  parent_id: string | null;
  description: string;
  position: number;
  people_count: number;
}

export interface OrgChartPerson {
  id: string;
  name: string;
  email: string;
  job_title: string;
  manager_id: string | null;
  is_agent: boolean;
  department: Ref | null;
  job_role: JobRoleRef | null;
  avatar_url?: string;
}

/** One entry of an admin-managed list (categories, business impact, change types). */
export interface ClassificationChoice {
  value: string;
  label?: string;
  description?: string;
  requires_approval?: boolean;
  system?: boolean;
  children?: ClassificationChoice[];
}

export interface Classification {
  entity: 'ticket' | 'problem' | 'change';
  name: string;
  label: string;
  field_type: 'nested' | 'dropdown';
  field_id: string | null;
  active: boolean;
  choices: ClassificationChoice[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  visibility: string;
  group_ids: string[];
  visible_from: string;
  visible_till: string | null;
  state: 'active' | 'scheduled' | 'expired';
}

export interface CustomStatus {
  key: string;
  label: string;
  customer_label: string;
  pause_sla: boolean;
}

export interface HelpdeskSettings {
  helpdesk_name: string;
  portal_name: string;
  portal_welcome: string;
  support_email: string;
  time_zone: string;
  date_format: string;
  language: string;
  primary_color: string;
  logo_url: string;
  auto_close_resolved_hours: number;
  allow_requester_signup: boolean;
  requester_can_close: boolean;
  requester_can_reopen: boolean;
  dept_head_sees_dept_tickets: boolean;
  csat_enabled: boolean;
  require_category_on_resolve: boolean;
  require_time_on_close: boolean;
  create_requester_from_email: boolean;
  inbound_email_key?: string;
  password_min_length: number;
  password_require_upper: boolean;
  password_require_number: boolean;
  password_require_special: boolean;
  session_timeout_minutes: number;
  prefix_incident: string;
  prefix_service_request: string;
  prefix_problem: string;
  prefix_change: string;
  prefix_release: string;
  custom_statuses?: CustomStatus[];
}

export interface Me {
  user: Person;
  org: OrgContext;
  is_agent: boolean;
  is_account_admin: boolean;
  privileges: string[];
  ticket_scope: string;
  group_ids: string[];
  organization: { id: string; name: string };
  has_security_questions: boolean;
  settings: {
    helpdesk_name: string;
    portal_name: string;
    portal_welcome: string;
    primary_color: string;
    logo_url: string;
    time_zone: string;
    csat_enabled: boolean;
    requester_can_close: boolean;
    requester_can_reopen: boolean;
    custom_statuses: CustomStatus[];
    password_min_length: number;
    password_require_upper: boolean;
    password_require_number: boolean;
    password_require_special: boolean;
    session_timeout_minutes: number;
    prefixes: Record<string, string>;
  };
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  metadata: Record<string, string>;
  created_at: string;
}

export interface SearchResult {
  type: string;
  id: string;
  display_id: string;
  title: string;
  subtitle: string;
  url: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// ---------------------------------------------------------------------------
// Projects and work items
// ---------------------------------------------------------------------------

export type WorkItemState = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type WorkItemPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  status: 'planned' | 'active' | 'on_hold' | 'completed';
  visibility: 'public' | 'private';
  lead_id: string | null;
  lead: UserBrief | null;
  member_ids: string[];
  members: UserBrief[];
  start_date: string | null;
  end_date: string | null;
  archived: boolean;
  counts: Partial<Record<WorkItemState, number>>;
  total_items: number;
  open_items: number;
  progress: number;
  can_edit: boolean;
  can_manage: boolean;
  is_member: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkItemBrief {
  id: string;
  display_id: string;
  title: string;
  state: WorkItemState;
}

export interface WorkItem {
  id: string;
  project_id: string;
  number: number;
  display_id: string;
  title: string;
  description: string;
  state: WorkItemState;
  priority: WorkItemPriority;
  assignee_id: string | null;
  assignee: UserBrief | null;
  reporter_id: string;
  reporter: UserBrief | null;
  parent_id: string | null;
  parent: WorkItemBrief | null;
  cycle_id: string | null;
  cycle: Ref | null;
  project: { id: string; key: string; name: string; color: string } | null;
  labels: string[];
  estimate: number | null;
  start_date: string | null;
  due_date: string | null;
  sort_order: number;
  completed_at: string | null;
  sub_items: number;
  sub_items_done: number;
  comments: number;
  links: number;
  module_ids?: string[];
  web_links?: WebLink[];
  can_edit?: boolean;
  /** Present on the detail endpoint. */
  modules?: Ref[];
  attachments?: Attachment[];
  relations?: WorkItemRelation[];
  tickets?: { id: string; display_id: string; subject: string; status: string; tracked: boolean }[];
  subscribed?: boolean;
  subscribers?: UserBrief[];
  created_at: string;
  updated_at: string;
}

export interface WebLink {
  url: string;
  title: string;
}

export type RelationType = 'blocks' | 'blocked_by' | 'relates_to' | 'duplicate_of' | 'duplicated_by';

export interface WorkItemRelation {
  link_id: string;
  type: RelationType;
  item: WorkItemBrief;
}

export interface ProjectModule {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: 'backlog' | 'planned' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
  lead_id: string | null;
  lead: UserBrief | null;
  start_date: string | null;
  target_date: string | null;
  total: number;
  done: number;
}

export interface TicketProjectLink {
  project: { id: string; key: string; name: string; color: string };
  work_item: WorkItemBrief;
  can_edit: boolean;
}

export interface Cycle {
  id: string;
  project_id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  status: 'draft' | 'upcoming' | 'current' | 'completed';
  total: number;
  done: number;
  progress: number;
}
