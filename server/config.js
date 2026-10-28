/**
 * Trainer Desk settings. Rules and sheet names come from what Code.gs had in CONFIG;
 * anything that differs per server (IDs, secrets, addresses) comes from the environment (.env).
 */
const env = process.env;
const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const CONFIG = {
  APP_TITLE: 'Trainer Desk',
  TZ: env.SHEET_TZ || 'Asia/Kolkata',

  /* ---- people ---- */
  HEAD_EMAILS: ['gaurav.garg@nobroker.in'],                     // can open every trainer
  // Admins approve changes, remove/restore unclaimed candidates and run the OJT refresh.
  ADMIN_EMAILS: ['gaurav.garg@nobroker.in', 'geetansh.kumar@nobroker.in'],

  /* ---- Google Sheets (inputs; read into SQLite on a timer) ---- */
  TRACKER_ID: env.TRACKER_ID || '1cK-mgYle3alnlj6hLcQCR_zFwiOYZSRiKjDMKQr0G8E',
  DUMPS_ID: env.DUMPS_ID || '1nFnIh-OKXn9n4BcHX3T42viW6h6DZz7DQ9LoN8PGQAU',
  MASTER_SHEET: 'Master Dashboard',
  SCORING_SHEET: 'Scoring_Master',            // col M trainer, N manager, O mentor
  TRACKER_SHEET: 'T&D Performance Tracker',   // col B name, C email (display names)
  HR_SHEETS: ['HR_WFO', 'HR_WFH'],            // col A code, B name, C status, D DOJ, G location, I source, J department
  ALSO_MAPPED_SHEETS: ['Sonika Dashboard'],   // Emp IDs in column C also count as mapped
  REMOVED_SHEET: 'Removed',                   // tagged "Previously removed" in the unclaimed list
  KC_SHEET: 'KC Sheet',                       // A Date of KC, B Emp ID, C Attempt, D Obtained %, E Status
  IR_SHEET: 'Intervention Required',          // BQ projects required per trainer per month
  TIE_SHEET: 'Tenure Intervention Effectivene',
  DEPARTMENT_SHEET: 'Department List',        // optional; DEFAULT_DEPARTMENTS when the tab is missing
  TEMPLATE_SHEET: 'Trainer Templates',        // optional: Trainer Email | Trainer Name | Trainer Phone | Template Name
  TALKTIME_SHEET: 'Talktime',                 // in the dumps book; no header row: A date, C Emp ID, H talktime
  TALKTIME_COLS: { date: 1, id: 3, talk: 8 },
  OJT_TARGETS_SHEET: 'OJT Targets Across Nobroker',
  OJT_DUMPS: {
    sellerMs:      { sheet: 'Seller Servicing (MS)', email: 2, date: 5 },
    ownerMs:       { sheet: 'Owner Servicing (MS)', email: 2, date: 5 },
    sellerClosure: { sheet: 'Seller Servicing (Closure)', email: 2, date: 4, status: 3, statusIs: 'CLOSED_VIA_NOBROKER' },
    ownerClosure:  { sheet: 'Owner Servicing (Closure)', email: 2, date: 4, status: 3, statusIs: 'CLOSED_VIA_NOBROKER' },
    intracity:     { sheet: 'Intracity', email: 2, date: 4, value: 3 },
    intercity:     { sheet: 'Intercity', email: 2, date: 6, value: 5 },
    pmsRevenue:    { sheet: 'PMS Sales', email: 2, date: 4, value: 3 },
    legalRevenue:  { sheet: 'Legal', email: 2, date: 4, value: 3 },
    buyerMs:       { sheet: 'Buyer MS', email: 2, date: 4, lead: 3 },
    buyerPv:       { sheet: 'Buyer PV', email: 2, date: 6, lead: 3 }
  },

  /* ---- rules ---- */
  ATTENDANCE_CODES: ['P', 'L', 'WO', 'NCNS', 'LWD'],
  ATTENDANCE_FALLBACK_DAYS: 45,               // track this many days from DOJ while the OJT end date is unknown
  TALKTIME_MIN_SECONDS: 2,
  OJT_DAYS: 30,
  OJT_PASS_RULES: {
    'Seller Servicing': { score: 2.6 }, 'Owner Servicing': { score: 2.6 }, 'Investment Advisory': { score: 2.6 }, 'Loan': { score: 2.6 },
    'PMS Sales': { score: 3.6 }, 'CPMS Servicing': { score: 3.6 }, 'PnM Sales': { score: 3.6 },
    '*': { achievement: 0.7 }
  },
  UNCLAIMED_FROM: '2026-02-01',               // unclaimed list only shows people who joined on or after this date
  MAX_ASSIGN: 200,
  MAX_EXCLUDE: 3000,
  BATCH_MERGE_DAYS: 0,
  EMAIL_ADMINS_ON_REQUEST: true,
  OJT_REFRESH_HOUR: 6                         // the OJT refresh also runs every morning at this hour (sheet time zone)
};

/* ---- server ---- */
export const SERVER = {
  port: +(env.PORT || 8095),
  origin: env.PUBLIC_ORIGIN || 'http://localhost:' + (env.PORT || 8095),
  base: String(env.BASE_PATH || '').replace(/\/$/, ''),
  dataDir: env.DATA_DIR || './data',
  dbFile: env.DB_FILE || '',                  // default <dataDir>/trainer-desk.db
  domain: (env.ALLOWED_DOMAIN || 'nobroker.in').toLowerCase(),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
  sheetsClientId: env.SHEETS_CLIENT_ID || env.GOOGLE_CLIENT_ID || '',
  sheetsClientSecret: env.SHEETS_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '',
  sheetsAccountHint: env.SHEETS_ACCOUNT_HINT || '',
  botTokenFile: env.BOT_TOKEN_FILE || '',     // Gmail sender token (refresh_token + client); blank = no e-mail
  setupAdmins: list(env.SETUP_ADMINS),
  mailTo: (env.MAIL_TO || '').trim(),         // every e-mail goes here instead of ADMIN_EMAILS
  mailOverride: (env.MAIL_TO_OVERRIDE || '').trim(),
  refreshSeconds: Math.max(15, +(env.REFRESH_SECONDS || 60)),
  mirrorSeconds: Math.max(60, +(env.MIRROR_SECONDS || 300)),
  mirror: (env.SHEET_MIRROR || 'on').toLowerCase() !== 'off',   // copy app tabs back to the tracker for reporting
  demo: env.DEMO === '1',                     // local preview: made-up data, no Google, no sign-in
  demoUser: (env.DEMO_USER || 'priya.nair@nobroker.in').toLowerCase()
};
SERVER.dbFile = SERVER.dbFile || SERVER.dataDir.replace(/\/$/, '') + '/trainer-desk.db';

list(env.DESK_EXTRA_ADMINS).forEach(e => { if (!CONFIG.ADMIN_EMAILS.includes(e)) CONFIG.ADMIN_EMAILS.push(e); });

/* Starting Department List (used when the tracker has no "Department List" tab). */
export const DEFAULT_DEPARTMENTS = [
  ['Buyer Acquisition & Property Sales', ['ASM 1', 'Presales', 'Property RM', 'Supply RM']],
  ['Buyer Sales', ['Buyer Sales']],
  ['CDL', ['Outbound-CDL']],
  ['Commercial Sales', ['Commercial Sales - OS', 'Commercial Sales - TB']],
  ['Commercial Servicing', ['Commercial Servicing']],
  ['CPMS Sales', ['CPMS Sales']],
  ['CPMS Servicing', ['CPMS Servicing', 'CPMS Tenant Search', 'CPMS-TS', 'SS-CPMS']],
  ['CPMS Tenant Search', ['CPMS Tenant Search']],
  ['Customer Service', ['CS-Sales']],
  ['Field Monetisation', ['Owner - FRM', 'Seller - FRM', 'Tenant - FRM']],
  ['Homestore - Non Painting', ['Homestore AC Chat', 'Homestore AC Escalation', 'Homestore AC Partner Assignment', 'Homestore AC Schedule', 'Homestore Cleaning Escalation', 'Homestore Cleaning Schedule']],
  ['Homestore - Painting', ['Homestore Painting Customer Inbound', 'Homestore Painting Schedule']],
  ['Homestore - PMS', ['PMS Servicing']],
  ['Investment Advisory', ['IA - Postpaid', 'Investment Advisory', 'Post Closure', 'Postpaid', 'Postpaid - FRM', 'Prepaid']],
  ['Legal Sales', ['Legal Sales']],
  ['Legal Servicing', ['Legal Servicing', 'Legal-Calling (Servicing)']],
  ['Loan Sales', ['Loan-Calling (Sales)']],
  ['Loan Servicing', ['Loan-Calling (Servicing)']],
  ['NRI Sales', ['NRI Sales - OS', 'NRI Sales - TB']],
  ['Outbound', ['Agent', 'CDL', 'Click', 'Lead Gen', 'MISC', 'Self']],
  ['Owner Postpaid', ['Owner Postpaid']],
  ['Owner Sales', ['Owner Postpaid', 'Owner Prepaid']],
  ['Owner Servicing', ['Commercial Servicing', 'OS-Calling', 'Owner -Non Super', 'Owner Postpaid', 'Owner servicing', 'Owner Super Servicing', 'Owner-Auto Dialer']],
  ['PIA', []],
  ['Plot', ['Auto Dialer', 'Plot-Calling', 'Plot-Postpaid', 'Plot-Servicing', 'Prepaid servicing']],
  ['Plot Sales', ['Plot Sales']],
  ['PMS Sales', ['PMS Sales']],
  ['PMS Servicing', ['PMS Servicing']],
  ['PnM Sales', ['PnM Sales Inter', 'PnM Sales Intra']],
  ['PnM-Servicing', ['NPS/ Social media team', 'Order Management - Inter', 'Order Management - Intra', 'PNM Servicing - inbound', 'PnM-Servicing', 'PnM-Servicing Chat', 'PnM-Servicing Ticketing', 'PnM-Servicing-Lateral']],
  ['Postpaid', ['Owner Postpaid-Calling']],
  ['Presales August', ['Presales August']],
  ['Process Improvement & Adherence', ['PIA Conversion & Closure Team']],
  ['RA HomeStore', ['Sales - MP', 'Sales - PAN']],
  ['Seller Prepaid Legal', ['Seller Prepaid Legal']],
  ['Seller Prepaid Servicing', ['Commercial Servicing', 'Legal Servicing - Calling', 'Seller Prepaid', 'Seller Super-Auto']],
  ['Seller Sales', ['Seller Postpaid', 'Seller Power', 'Seller Prepaid']],
  ['Seller servicing', ['Commercial Servicing', 'CX-360', 'Owner Postpaid-Calling', 'Project', 'Seller Post paid ( project)', 'Seller Postpaid', 'Seller Postpaid-Calling', 'Seller Prepaid', 'Seller servicing', 'Seller Super', 'Seller Super-Auto', 'Super Seller - Auto']],
  ['Super Servicing', ['SS - Auto', 'SS-CPMS', 'SS-Owner Super', 'SS-Owner Super-Auto', 'SS-Owner Super-NRI', 'SS-Owner-Auto']],
  ['Supply RM', ['Supply RM']],
  ['Tenant Sales', ['Tenant Sales']],
  ['Tenant Servicing', ['TS/TSRP', 'TSPP']]
];
