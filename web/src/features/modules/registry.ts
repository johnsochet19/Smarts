import type { ModuleConfig } from './types';

// Status palettes reused across modules.
const C = {
  draft: 'var(--slate-500)',
  open: 'var(--blue-500)',
  in_progress: 'var(--amber-500)',
  in_review: 'var(--violet-500)',
  closed: 'var(--green-500)',
  approved: 'var(--green-500)',
  rejected: 'var(--red-500)',
  revise: 'var(--amber-500)',
  submitted: 'var(--blue-500)',
};

// ── Ported modules (rendered in the new design via the engine) ──────────────
const RFIS: ModuleConfig = {
  slug: 'rfis', title: 'RFIs', icon: 'alert', group: 'Quality & Safety', ported: true,
  resource: 'rfis', projectScoped: true, titleKey: 'subject', numberKey: 'rfi_number',
  hint: 'Requests for information. Create a draft, then open it to route for response.',
  columns: [
    { key: 'rfi_number', label: 'RFI #', kind: 'mono' },
    { key: 'subject', label: 'Subject', grow: true },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'location', label: 'Location' },
    { key: 'due_date', label: 'Due', kind: 'date' },
  ],
  statusMap: { draft: C.draft, open: C.open, in_review: C.in_review, closed: C.closed },
  createFields: [
    { key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Short summary of the question' },
    { key: 'question', label: 'Question', type: 'textarea', placeholder: 'Describe what you need clarified' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'draft', label: 'Draft' }, { value: 'open', label: 'Open' }] },
    { key: 'drawing_number', label: 'Drawing #', type: 'text' },
    { key: 'spec_section', label: 'Spec section', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'due_date', label: 'Due date', type: 'date' },
  ],
};

const SUBMITTALS: ModuleConfig = {
  slug: 'submittals', title: 'Submittals', icon: 'list', group: 'Quality & Safety', ported: true,
  resource: 'submittals', projectScoped: true, titleKey: 'title', numberKey: 'submittal_number',
  hint: 'Shop drawings, product data and samples routed for approval.',
  columns: [
    { key: 'submittal_number', label: '#', kind: 'mono' },
    { key: 'title', label: 'Title', grow: true },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'type', label: 'Type' },
    { key: 'due_date', label: 'Due', kind: 'date' },
  ],
  statusMap: { draft: C.draft, submitted: C.submitted, in_review: C.in_review, approved: C.approved, revise: C.revise, rejected: C.rejected, closed: C.closed },
  createFields: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Curtain wall shop drawings' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'type', label: 'Type', type: 'select', options: [
      { value: 'shop_drawing', label: 'Shop drawing' }, { value: 'product_data', label: 'Product data' },
      { value: 'sample', label: 'Sample' }, { value: 'mock_up', label: 'Mock-up' }, { value: 'other', label: 'Other' },
    ] },
    { key: 'division', label: 'CSI division', type: 'text' },
    { key: 'spec_section', label: 'Spec section', type: 'text' },
    { key: 'due_date', label: 'Due date', type: 'date' },
  ],
};

const DAILY_LOGS: ModuleConfig = {
  slug: 'daily-logs', title: 'Daily Logs', icon: 'calendar', group: 'Field', ported: true,
  resource: 'daily-logs', projectScoped: true, titleKey: 'log_date', numberKey: undefined,
  hint: 'A daily record of weather, crews and site activity.',
  columns: [
    { key: 'log_date', label: 'Date', kind: 'date' },
    { key: 'weather', label: 'Weather', grow: true },
    { key: 'temperature_high', label: 'High °', kind: 'number' },
    { key: 'temperature_low', label: 'Low °', kind: 'number' },
    { key: 'created_by_name', label: 'By' },
  ],
  createFields: [
    { key: 'log_date', label: 'Log date', type: 'date', required: true },
    { key: 'weather', label: 'Weather', type: 'text', placeholder: 'e.g. Sunny, light wind' },
    { key: 'temperature_high', label: 'Temp high (°)', type: 'number' },
    { key: 'temperature_low', label: 'Temp low (°)', type: 'number' },
    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Crews on site, deliveries, activity…' },
  ],
};

// ── Classic-only modules (preserved; open in the existing app until ported) ──
function classic(slug: string, title: string, icon: ModuleConfig['icon'], group: string, classicPath: string): ModuleConfig {
  return { slug, title, icon, group, ported: false, classicPath };
}

export const MODULES: ModuleConfig[] = [
  RFIS, SUBMITTALS, DAILY_LOGS,
  // Field
  // Inspections is a bespoke page (routed in App.tsx before the module map).
  { slug: 'inspections', title: 'Inspections', icon: 'check', group: 'Field', ported: true },
  {
    slug: 'observations', title: 'Observations', icon: 'alert', group: 'Field', ported: true,
    resource: 'observations', projectScoped: true, titleKey: 'title',
    hint: 'Safety and quality observations from the field.',
    columns: [
      { key: 'title', label: 'Observation', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'priority', label: 'Priority', kind: 'status' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'location', label: 'Location' },
      { key: 'due_date', label: 'Due', kind: 'date' },
    ],
    createFields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'What did you observe?' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'type', label: 'Type', type: 'select', options: [{ value: 'safety', label: 'Safety' }, { value: 'quality', label: 'Quality' }, { value: 'environmental', label: 'Environmental' }, { value: 'positive', label: 'Positive' }] },
      { key: 'priority', label: 'Priority', type: 'select', options: [{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }] },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'due_date', label: 'Due date', type: 'date' },
    ],
  },
  // Photos & Documents are served by the bespoke Files page (routed in App.tsx).
  { slug: 'photos', title: 'Photos', icon: 'camera', group: 'Field', ported: true },
  // Documents
  { slug: 'documents', title: 'Documents', icon: 'list', group: 'Documents', ported: true },
  {
    slug: 'drawings', title: 'Drawings', icon: 'grid', group: 'Documents', ported: true,
    resource: 'drawings', projectScoped: true, titleKey: 'title', numberKey: 'number',
    hint: 'Drawing sets and sheets by discipline and revision.',
    columns: [
      { key: 'number', label: 'No.', kind: 'mono' },
      { key: 'title', label: 'Title', grow: true },
      { key: 'discipline', label: 'Discipline' },
      { key: 'revision', label: 'Rev' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'publish_date', label: 'Published', kind: 'date' },
    ],
    createFields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Level 3 Reflected Ceiling Plan' },
      { key: 'number', label: 'Drawing number', type: 'text', placeholder: 'e.g. A-301' },
      { key: 'revision', label: 'Revision', type: 'text', placeholder: 'e.g. 2' },
      { key: 'publish_date', label: 'Publish date', type: 'date' },
    ],
  },
  {
    slug: 'specifications', title: 'Specifications', icon: 'list', group: 'Documents', ported: true,
    resource: 'specifications', projectScoped: true, titleKey: 'section_title', numberKey: 'section_number',
    hint: 'Spec divisions and sections (CSI format).',
    columns: [
      { key: 'section_number', label: 'Section', kind: 'mono' },
      { key: 'section_title', label: 'Title', grow: true },
      { key: 'division_name', label: 'Division' },
      { key: 'revision_date', label: 'Revised', kind: 'date' },
    ],
    createFields: [
      { key: 'section_title', label: 'Section title', type: 'text', required: true, placeholder: 'e.g. Cast-in-Place Concrete' },
      { key: 'section_number', label: 'Section number', type: 'text', placeholder: 'e.g. 03 30 00' },
      { key: 'division_number', label: 'Division number', type: 'text', placeholder: 'e.g. 03' },
      { key: 'division_name', label: 'Division name', type: 'text', placeholder: 'e.g. Concrete' },
      { key: 'revision_date', label: 'Revision date', type: 'date' },
    ],
  },
  // Project Controls
  // Schedule is rendered by the bespoke Gantt page (routed in App.tsx before
  // this map), so it is marked ported to drop the "classic" tag in the nav.
  { slug: 'schedule', title: 'Schedule & Gantt', icon: 'calendar', group: 'Project Controls', ported: true },
  // Cost Management is a bespoke page (routed in App.tsx before the module map).
  { slug: 'cost', title: 'Cost Management', icon: 'dashboard', group: 'Project Controls', ported: true },
  // Budget is a bespoke page (routed in App.tsx before the module map).
  { slug: 'budget', title: 'Budget', icon: 'dashboard', group: 'Project Controls', ported: true },
  // Timesheets is a bespoke page (routed in App.tsx before the module map).
  { slug: 'timesheets', title: 'Timesheets', icon: 'clock', group: 'Project Controls', ported: true },
  {
    slug: 'meetings', title: 'Meetings', icon: 'calendar', group: 'Project Controls', ported: true,
    resource: 'meetings', projectScoped: true, titleKey: 'title', numberKey: 'meeting_number',
    hint: 'Owner, OAC, safety and subcontractor meetings with minutes.',
    columns: [
      { key: 'meeting_number', label: '#', kind: 'mono' },
      { key: 'title', label: 'Title', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'meeting_date', label: 'Date', kind: 'date' },
      { key: 'location', label: 'Location' },
    ],
    statusMap: { scheduled: C.open, in_progress: C.in_progress, completed: C.closed, cancelled: C.rejected },
    createFields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Weekly OAC meeting' },
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: 'owner_meeting', label: 'Owner meeting' }, { value: 'oac', label: 'OAC' }, { value: 'subcontractor', label: 'Subcontractor' },
        { value: 'safety', label: 'Safety' }, { value: 'design_review', label: 'Design review' }, { value: 'kickoff', label: 'Kickoff' },
        { value: 'closeout', label: 'Closeout' }, { value: 'other', label: 'Other' },
      ] },
      { key: 'status', label: 'Status', type: 'select', options: [
        { value: 'scheduled', label: 'Scheduled' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' },
      ] },
      { key: 'meeting_date', label: 'Date', type: 'date' },
      { key: 'start_time', label: 'Start time', type: 'text', placeholder: 'e.g. 09:00' },
      { key: 'end_time', label: 'End time', type: 'text', placeholder: 'e.g. 10:00' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'virtual_link', label: 'Virtual link', type: 'text', placeholder: 'e.g. Zoom / Teams URL' },
    ],
  },
  {
    slug: 'incidents', title: 'Incidents', icon: 'alert', group: 'Project Controls', ported: true,
    resource: 'incidents', projectScoped: true, titleKey: 'description', numberKey: 'incident_number',
    hint: 'Safety incidents, near-misses and OSHA-recordable events.',
    columns: [
      { key: 'incident_number', label: '#', kind: 'mono' },
      { key: 'description', label: 'Description', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'incident_date', label: 'Date', kind: 'date' },
      { key: 'location', label: 'Location' },
    ],
    statusMap: { draft: C.draft, under_investigation: C.in_progress, corrective_action: C.in_review, closed: C.closed },
    createFields: [
      { key: 'incident_date', label: 'Incident date', type: 'date', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'What happened?' },
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: 'near_miss', label: 'Near miss' }, { value: 'first_aid', label: 'First aid' }, { value: 'recordable', label: 'Recordable' },
        { value: 'lost_time', label: 'Lost time' }, { value: 'fatality', label: 'Fatality' }, { value: 'property_damage', label: 'Property damage' }, { value: 'environmental', label: 'Environmental' },
      ] },
      { key: 'status', label: 'Status', type: 'select', options: [
        { value: 'draft', label: 'Draft' }, { value: 'under_investigation', label: 'Under investigation' }, { value: 'corrective_action', label: 'Corrective action' }, { value: 'closed', label: 'Closed' },
      ] },
      { key: 'incident_time', label: 'Time', type: 'text', placeholder: 'e.g. 14:30' },
      { key: 'location', label: 'Location', type: 'text' },
    ],
  },
  {
    slug: 'permits', title: 'Permits', icon: 'check', group: 'Project Controls', ported: true,
    resource: 'permits', projectScoped: true, titleKey: 'title', numberKey: 'permit_number',
    hint: 'Building, trade and inspection permits with expirations.',
    columns: [
      { key: 'permit_number', label: '#', kind: 'mono' },
      { key: 'title', label: 'Title', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'issuing_authority', label: 'Authority' },
      { key: 'expiration_date', label: 'Expires', kind: 'date' },
    ],
    statusMap: { pending: C.draft, submitted: C.submitted, under_review: C.in_review, approved: C.approved, rejected: C.rejected, expired: C.rejected, renewed: C.open, closed: C.closed },
    createFields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Building permit — Phase 1' },
      { key: 'permit_number', label: 'Permit number', type: 'text' },
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: 'building', label: 'Building' }, { value: 'electrical', label: 'Electrical' }, { value: 'plumbing', label: 'Plumbing' }, { value: 'mechanical', label: 'Mechanical' },
        { value: 'demolition', label: 'Demolition' }, { value: 'fire', label: 'Fire' }, { value: 'elevator', label: 'Elevator' }, { value: 'zoning', label: 'Zoning' }, { value: 'other', label: 'Other' },
      ] },
      { key: 'status', label: 'Status', type: 'select', options: [
        { value: 'pending', label: 'Pending' }, { value: 'submitted', label: 'Submitted' }, { value: 'under_review', label: 'Under review' }, { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' }, { value: 'expired', label: 'Expired' }, { value: 'renewed', label: 'Renewed' }, { value: 'closed', label: 'Closed' },
      ] },
      { key: 'issuing_authority', label: 'Issuing authority', type: 'text' },
      { key: 'applied_date', label: 'Applied date', type: 'date' },
      { key: 'expiration_date', label: 'Expiration date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  // Directory
  {
    slug: 'companies', title: 'Companies', icon: 'user', group: 'Directory', ported: true,
    resource: 'companies', projectScoped: false, titleKey: 'name',
    hint: 'Subcontractors, vendors and consultants in your directory.',
    columns: [
      { key: 'name', label: 'Company', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
    ],
    createFields: [
      { key: 'name', label: 'Company name', type: 'text', required: true },
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: 'subcontractor', label: 'Subcontractor' }, { value: 'vendor', label: 'Vendor' }, { value: 'consultant', label: 'Consultant' },
        { value: 'owner', label: 'Owner' }, { value: 'gc', label: 'General contractor' }, { value: 'other', label: 'Other' },
      ] },
      { key: 'license_number', label: 'License number', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'zip', label: 'ZIP', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'website', label: 'Website', type: 'text' },
    ],
  },
  classic('contractors', 'Contractors', 'user', 'Directory', '/contractors'),
  {
    slug: 'equipment', title: 'Equipment', icon: 'grid', group: 'Directory', ported: true,
    resource: 'equipment', projectScoped: false, titleKey: 'name',
    hint: 'Owned and rented equipment with assignment and status.',
    columns: [
      { key: 'name', label: 'Equipment', grow: true },
      { key: 'equipment_type', label: 'Type' },
      { key: 'make', label: 'Make' },
      { key: 'model', label: 'Model' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'assigned_operator', label: 'Operator' },
    ],
    // Keys cover both the seeder's lowercase convention and any capitalized legacy values.
    statusMap: {
      available: C.closed, Active: C.closed, active: C.closed,
      in_use: C.open, 'In Use': C.open,
      maintenance: C.in_progress, Maintenance: C.in_progress,
      idle: C.draft, Idle: C.draft,
      retired: C.rejected, Retired: C.rejected,
    },
    createFields: [
      { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Excavator 320' },
      { key: 'equipment_type', label: 'Type', type: 'text', placeholder: 'e.g. Excavator' },
      { key: 'make', label: 'Make', type: 'text' },
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'serial_number', label: 'Serial number', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: [
        { value: 'available', label: 'Available' }, { value: 'in_use', label: 'In use' }, { value: 'maintenance', label: 'Maintenance' }, { value: 'idle', label: 'Idle' }, { value: 'retired', label: 'Retired' },
      ] },
      { key: 'assigned_operator', label: 'Assigned operator', type: 'text' },
    ],
  },
  // More
  classic('email', 'Email', 'bell', 'More', '/gmail'),
  classic('bidding', 'Bidding', 'dashboard', 'More', '/bidding'),
  // Reports is a bespoke page (routed in App.tsx before the module map).
  { slug: 'reports', title: 'Reports', icon: 'dashboard', group: 'More', ported: true },
  // Search is a bespoke page (routed in App.tsx before the module map).
  { slug: 'search', title: 'Search', icon: 'search', group: 'More', ported: true },
  // Admin — Users & Audit Log are bespoke pages (routed in App.tsx before the module map).
  { slug: 'users', title: 'Users', icon: 'user', group: 'Admin', ported: true },
  { slug: 'audit-log', title: 'Audit Log', icon: 'list', group: 'Admin', ported: true },
  // Settings is a bespoke page (routed in App.tsx before the module map).
  { slug: 'settings', title: 'Settings', icon: 'more', group: 'Admin', ported: true },
];

export const MODULE_BY_SLUG: Record<string, ModuleConfig> = Object.fromEntries(MODULES.map((m) => [m.slug, m]));

export const GROUP_ORDER = ['Overview', 'Automate', 'Field', 'Quality & Safety', 'Documents', 'Project Controls', 'Directory', 'More', 'Admin'];
